import type { SpecColumn, SpecSchema, SpecTable } from './spec';

/**
 * Resolved relational model: schema.json "constraints" strings turned into
 * explicit keys. Everything schema.json does not state is listed in
 * NATURAL_KEYS / FK_TARGETS below, each with its justification.
 */

export interface FkRef {
  columns: string[];
  refTable: string;
  refColumns: string[];
}

export interface ModelColumn {
  name: string;
  /** Postgres type text as emitted in DDL (enum columns get a named type). */
  sqlType: string;
  /** For enum columns: type name and labels. */
  enumType?: { name: string; labels: string[] };
  notNull: boolean;
  defaultSql?: string;
  description: string;
}

export interface ModelTable {
  name: string;
  scope: string;
  description: string;
  columns: ModelColumn[];
  primaryKey: string[];
  uniques: { name: string; columns: string[] }[];
  fks: (FkRef & { name: string })[];
  /** FKs named in schema.json that Postgres cannot express (discriminated target). */
  unenforcedRefs: { column: string; note: string }[];
}

export interface Model {
  specVersion: string;
  /** Tables in dependency order (referenced tables first). */
  tables: ModelTable[];
  enums: { name: string; labels: string[] }[];
  extensions: string[];
}

/**
 * Tables for which schema.json names no primary key. The key is the natural
 * key of the entity map (docs/spec/01_data_model.md section 2); tenant_id leads
 * so the key doubles as the tenant-scoped lookup index.
 */
export const NATURAL_KEYS: Record<string, string[]> = {
  tenant_membership: ['tenant_id', 'user_id'],
  line_item_lever: ['tenant_id', 'line_key', 'lever_code'],
  change: ['tenant_id', 'changeset_id', 'seq'],
};

/**
 * Bare `fk` constraints name no target in schema.json. Columns called
 * `<table>_id` resolve to <table>(id); the rest are listed here.
 */
export const FK_TARGETS: Record<string, FkRef> = {
  // composite: line_item is keyed (tenant_id, member_key)
  'line_item_lever.line_key': {
    columns: ['tenant_id', 'line_key'],
    refTable: 'line_item',
    refColumns: ['tenant_id', 'member_key'],
  },
};

/** Extensions migrations may create: trusted in Postgres 13+, so a plain DB owner can run them (Neon too). */
export const EXTENSION_ALLOW_LIST = ['citext'] as const;

const SQL_TYPES: Record<string, string> = {
  uuid: 'uuid',
  text: 'text',
  bool: 'boolean',
  int: 'integer',
  bigserial: 'bigserial',
  'char(1)': 'char(1)',
  'char(3)': 'char(3)',
  citext: 'citext',
  date: 'date',
  numeric: 'numeric',
  jsonb: 'jsonb',
  timestamptz: 'timestamptz',
  'text[]': 'text[]',
  'uuid[]': 'uuid[]',
};

interface ParsedConstraints {
  pk: 'none' | 'single' | 'part' | { with: string[] };
  unique: 'none' | 'column' | 'per_tenant';
  fk?: { table?: string; column?: string; discriminator?: string };
  nullable: boolean;
  defaultSql?: string;
}

export function parseConstraints(where: string, raw: string): ParsedConstraints {
  const out: ParsedConstraints = { pk: 'none', unique: 'none', nullable: false };
  const s = raw.trim();
  if (s === '') return out;
  if (s === 'pk') return { ...out, pk: 'single' };
  if (s === 'pk part') return { ...out, pk: 'part' };
  const withMatch = /^pk with (.+)$/.exec(s);
  if (withMatch) return { ...out, pk: { with: withMatch[1]!.split(',').map((x) => x.trim()) } };
  for (const part of s.split(',').map((x) => x.trim())) {
    let m: RegExpExecArray | null;
    if (part === 'unique') out.unique = 'column';
    else if (part === 'unique per tenant') out.unique = 'per_tenant';
    else if (part === 'nullable') out.nullable = true;
    else if (part === 'not null' || part === 'RLS key') continue;
    else if ((m = /^default (true|false)$/.exec(part))) out.defaultSql = m[1]!;
    else if ((m = /^(nullable )?fk$/.exec(part))) {
      out.fk = {};
      if (m[1]) out.nullable = true;
    } else if ((m = /^(nullable )?fk ([a-z_]+)\.([a-z_]+)$/.exec(part))) {
      out.fk = { table: m[2]!, column: m[3]! };
      if (m[1]) out.nullable = true;
    } else if ((m = /^(nullable )?fk ([a-z_]+)\(([a-z_]+)\)$/.exec(part))) {
      out.fk = { table: m[2]!, discriminator: m[3]! };
      if (m[1]) out.nullable = true;
    } else if ((m = /^nullable fk ([a-z_]+)$/.exec(part))) {
      out.fk = { table: m[1]! };
      out.nullable = true;
    } else throw new Error(`${where}: unrecognised constraint "${part}" in "${raw}"`);
  }
  return out;
}

function sqlTypeOf(where: string, table: string, col: SpecColumn): { name: string; labels: string[] } | string {
  const em = /^enum\((.+)\)$/.exec(col.type);
  if (em) return { name: `${table}_${col.name}`, labels: em[1]!.split(',').map((x) => x.trim()) };
  const t = SQL_TYPES[col.type];
  if (!t) throw new Error(`${where}: unsupported type "${col.type}"`);
  return t;
}

function buildTable(name: string, t: SpecTable, allNames: Set<string>): ModelTable {
  const columns: ModelColumn[] = [];
  const parsed = new Map<string, ParsedConstraints>();
  const pkSingle: string[] = [];
  const pkPart: string[] = [];
  const pkWith: { col: string; with: string[] }[] = [];
  const uniques: ModelTable['uniques'] = [];
  const fks: ModelTable['fks'] = [];
  const unenforcedRefs: ModelTable['unenforcedRefs'] = [];

  for (const c of t.columns) {
    const where = `${name}.${c.name}`;
    const p = parseConstraints(where, c.constraints);
    parsed.set(c.name, p);
    const ty = sqlTypeOf(where, name, c);
    const col: ModelColumn = {
      name: c.name,
      sqlType: typeof ty === 'string' ? ty : ty.name,
      notNull: !p.nullable,
      description: c.description,
    };
    if (typeof ty !== 'string') col.enumType = ty;
    if (p.defaultSql) col.defaultSql = p.defaultSql;
    columns.push(col);
    if (p.pk === 'single') pkSingle.push(c.name);
    else if (p.pk === 'part') pkPart.push(c.name);
    else if (p.pk !== 'none') pkWith.push({ col: c.name, with: p.pk.with });
  }
  const hasTenantId = columns.some((c) => c.name === 'tenant_id' && c.notNull);

  // Primary key.
  let primaryKey: string[];
  if (pkSingle.length && (pkPart.length || pkWith.length)) {
    throw new Error(`${name}: mixes "pk" with composite pk markers`);
  }
  if (pkSingle.length) {
    if (pkSingle.length > 1) throw new Error(`${name}: several single-column pks`);
    primaryKey = pkSingle;
  } else if (pkPart.length || pkWith.length) {
    primaryKey = [];
    for (const w of pkWith) for (const x of w.with) if (!primaryKey.includes(x)) primaryKey.push(x);
    if (!pkWith.length && hasTenantId) primaryKey.push('tenant_id');
    for (const w of pkWith) primaryKey.push(w.col);
    primaryKey.push(...pkPart);
  } else {
    const nk = NATURAL_KEYS[name];
    if (!nk) throw new Error(`${name}: schema.json names no primary key and NATURAL_KEYS has no entry`);
    primaryKey = nk;
  }
  if (NATURAL_KEYS[name] && (pkSingle.length || pkPart.length || pkWith.length)) {
    throw new Error(`${name}: NATURAL_KEYS entry is stale (schema.json now names a pk)`);
  }
  for (const k of primaryKey) {
    if (!columns.some((c) => c.name === k)) throw new Error(`${name}: pk column "${k}" does not exist`);
    if (columns.find((c) => c.name === k)!.notNull === false) throw new Error(`${name}: pk column "${k}" is nullable`);
  }

  // Unique constraints and foreign keys.
  for (const c of t.columns) {
    const where = `${name}.${c.name}`;
    const p = parsed.get(c.name)!;
    if (p.unique === 'column') uniques.push({ name: `${name}_${c.name}_key`, columns: [c.name] });
    if (p.unique === 'per_tenant') {
      if (!hasTenantId) throw new Error(`${where}: "unique per tenant" without tenant_id`);
      uniques.push({ name: `${name}_tenant_id_${c.name}_key`, columns: ['tenant_id', c.name] });
    }
    if (!p.fk) continue;
    if (p.fk.discriminator) {
      unenforcedRefs.push({
        column: c.name,
        note: `references ${p.fk.table}(${p.fk.discriminator}) members; a discriminated target cannot be a Postgres FK. Enforced by VR09 in tier 2.`,
      });
      continue;
    }
    let ref: FkRef;
    if (p.fk.table && p.fk.column) {
      ref = { columns: [c.name], refTable: p.fk.table, refColumns: [p.fk.column] };
    } else if (p.fk.table) {
      ref = { columns: [c.name], refTable: p.fk.table, refColumns: ['id'] };
    } else {
      const explicit = FK_TARGETS[where];
      if (explicit) ref = explicit;
      else {
        const m = /^(.+)_id$/.exec(c.name);
        if (!m || !allNames.has(m[1]!)) throw new Error(`${where}: bare "fk" with no resolvable target (add to FK_TARGETS)`);
        ref = { columns: [c.name], refTable: m[1]!, refColumns: ['id'] };
      }
    }
    if (!allNames.has(ref.refTable)) throw new Error(`${where}: fk target table "${ref.refTable}" not in schema.json`);
    fks.push({ ...ref, name: `${name}_${c.name}_fkey` });
  }

  return {
    name,
    scope: t.scope,
    description: t.description ?? '',
    columns,
    primaryKey,
    uniques,
    fks,
    unenforcedRefs,
  };
}

function sameCols(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

export function buildModel(schema: SpecSchema): Model {
  const names = Object.keys(schema.tables);
  const nameSet = new Set(names);
  const built = names.map((n) => buildTable(n, schema.tables[n]!, nameSet));

  // Every FK must point at a pk or unique key of the referenced table.
  const byName = new Map(built.map((t) => [t.name, t]));
  for (const t of built) {
    for (const fk of t.fks) {
      const target = byName.get(fk.refTable)!;
      for (const rc of fk.refColumns) {
        if (!target.columns.some((c) => c.name === rc)) throw new Error(`${t.name}: fk to ${fk.refTable}.${rc}, no such column`);
      }
      const isKey =
        sameCols(target.primaryKey, fk.refColumns) || target.uniques.some((u) => sameCols(u.columns, fk.refColumns));
      if (!isKey) throw new Error(`${t.name}: fk to ${fk.refTable}(${fk.refColumns.join(',')}) is not a pk/unique key`);
    }
  }

  // Topological order, ties broken by schema.json order.
  const ordered: ModelTable[] = [];
  const done = new Set<string>();
  const remaining = [...built];
  while (remaining.length) {
    const idx = remaining.findIndex((t) => t.fks.every((f) => f.refTable === t.name || done.has(f.refTable)));
    if (idx < 0) throw new Error(`foreign key cycle among: ${remaining.map((t) => t.name).join(', ')}`);
    const [t] = remaining.splice(idx, 1);
    ordered.push(t!);
    done.add(t!.name);
  }

  const enums: Model['enums'] = [];
  const extensions = new Set<string>();
  for (const t of ordered) {
    for (const c of t.columns) {
      if (c.enumType) enums.push(c.enumType);
      if (c.sqlType === 'citext') extensions.add('citext');
    }
  }
  for (const e of extensions) {
    if (!(EXTENSION_ALLOW_LIST as readonly string[]).includes(e)) throw new Error(`extension ${e} is not allow-listed`);
  }
  return { specVersion: schema.spec_version, tables: ordered, enums, extensions: [...extensions] };
}
