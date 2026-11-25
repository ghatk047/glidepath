import { INDEXES } from './ddl';
import { pgTypeName } from './manual-overlay';
import type { Model, ModelIndex, ModelTable } from './model';

/**
 * Compares the full model (schema.json + manual overlay) with the catalog of a
 * database that has every migration applied. Used by the overlay drift test
 * (manual-overlay.pg.test.ts) and available to any package with a migrated DB.
 */

export interface CatalogColumn {
  name: string;
  /** `format_type()` text. */
  type: string;
  notNull: boolean;
  /** `pg_get_expr()` of the default, null when none. */
  default: string | null;
}

export interface CatalogConstraint {
  name: string;
  /** pg_constraint.contype: p, u or f. */
  type: string;
  columns: string[];
  refTable: string | null;
  refColumns: string[] | null;
  /** pg_constraint.confdeltype: a (no action), c (cascade), ... */
  deleteAction: string | null;
}

export interface CatalogIndex {
  name: string;
  unique: boolean;
  columns: string[];
  predicate: string | null;
}

export interface CatalogTable {
  columns: CatalogColumn[];
  constraints: CatalogConstraint[];
  /** Indexes that do not back a constraint. */
  indexes: CatalogIndex[];
  rlsEnabled: boolean;
  rlsForced: boolean;
}

export type Catalog = Record<string, CatalogTable>;

export type Query = (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;

/** Reads the public-schema catalog (tables, columns, keys, indexes, RLS flags). */
export async function readCatalog(query: Query, ignoreTables: string[] = []): Promise<Catalog> {
  const names = (
    await query(`SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                  WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY 1`)
  ).rows
    .map((r) => r.name as string)
    .filter((n) => !ignoreTables.includes(n));
  const out: Catalog = {};
  for (const name of names) {
    const reg = `public.${name}`;
    const cols = await query(
      `SELECT a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type, a.attnotnull AS "notNull",
              pg_get_expr(d.adbin, d.adrelid) AS "default"
         FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
        WHERE a.attrelid = $1::regclass AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum`,
      [reg],
    );
    const cons = await query(
      `SELECT c.conname AS name, c.contype AS type,
              (SELECT array_agg(a.attname::text ORDER BY k.ord) FROM unnest(c.conkey) WITH ORDINALITY k(attnum, ord)
                 JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum) AS columns,
              NULLIF(c.confrelid, 0)::regclass::text AS "refTable",
              (SELECT array_agg(a.attname::text ORDER BY k.ord) FROM unnest(c.confkey) WITH ORDINALITY k(attnum, ord)
                 JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.attnum) AS "refColumns",
              CASE WHEN c.contype = 'f' THEN c.confdeltype::text END AS "deleteAction"
         FROM pg_constraint c WHERE c.conrelid = $1::regclass AND c.contype IN ('p', 'u', 'f') ORDER BY 1`,
      [reg],
    );
    const idx = await query(
      `SELECT ic.relname AS name, i.indisunique AS "unique",
              (SELECT array_agg(a.attname::text ORDER BY k.ord) FROM unnest(i.indkey::int2[]) WITH ORDINALITY k(attnum, ord)
                 JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum) AS columns,
              pg_get_expr(i.indpred, i.indrelid) AS predicate
         FROM pg_index i JOIN pg_class ic ON ic.oid = i.indexrelid
        WHERE i.indrelid = $1::regclass
          AND NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conindid = i.indexrelid) ORDER BY 1`,
      [reg],
    );
    const rls = await query(`SELECT relrowsecurity AS e, relforcerowsecurity AS f FROM pg_class WHERE oid = $1::regclass`, [reg]);
    out[name] = {
      columns: cols.rows as unknown as CatalogColumn[],
      constraints: cons.rows as unknown as CatalogConstraint[],
      indexes: idx.rows as unknown as CatalogIndex[],
      rlsEnabled: rls.rows[0]!.e as boolean,
      rlsForced: rls.rows[0]!.f as boolean,
    };
  }
  return out;
}

const list = (a: string[] | null | undefined): string => `(${(a ?? []).join(', ')})`;
const norm = (s: string | null | undefined): string => (s ?? '').replace(/[()\s]/g, '').toLowerCase();

function indexesOf(t: ModelTable): ModelIndex[] {
  return [
    ...INDEXES.filter((i) => i.table === t.name).map((i) => ({ name: i.name, columns: i.columns, unique: i.unique })),
    ...t.indexes,
  ];
}

function diffTable(t: ModelTable, c: CatalogTable): string[] {
  const p: string[] = [];
  const at = (what: string, msg: string): void => void p.push(`${t.name}${what}: ${msg}`);

  const modelNames = t.columns.map((x) => x.name);
  const dbNames = c.columns.map((x) => x.name);
  if (modelNames.join() !== dbNames.join()) {
    at('', `columns differ (model ${list(modelNames)}, database ${list(dbNames)})`);
  }
  for (const mc of t.columns) {
    const dc = c.columns.find((x) => x.name === mc.name);
    if (!dc) continue;
    const w = `.${mc.name}`;
    if (pgTypeName(mc.sqlType) !== dc.type) at(w, `type ${pgTypeName(mc.sqlType)} in the model, ${dc.type} in the database`);
    if (mc.notNull !== dc.notNull) at(w, `NOT NULL is ${mc.notNull} in the model, ${dc.notNull} in the database`);
    if (mc.sqlType !== 'bigserial' && (mc.defaultSql ?? null) !== dc.default) {
      at(w, `default ${mc.defaultSql ?? 'none'} in the model, ${dc.default ?? 'none'} in the database`);
    }
  }

  const keyOf = (type: string) => c.constraints.filter((x) => x.type === type);
  const pk = keyOf('p');
  if (pk.length !== 1 || pk[0]!.name !== `${t.name}_pkey` || list(pk[0]!.columns) !== list(t.primaryKey)) {
    at(' pk', `model ${t.name}_pkey ${list(t.primaryKey)}, database ${pk.map((x) => `${x.name} ${list(x.columns)}`).join('; ') || 'none'}`);
  }
  const sameSet = (what: string, model: string[], db: string[]): void => {
    if ([...model].sort().join('|') !== [...db].sort().join('|')) at(what, `model [${[...model].sort().join('; ')}], database [${[...db].sort().join('; ')}]`);
  };
  sameSet(' unique', t.uniques.map((u) => `${u.name} ${list(u.columns)}`), keyOf('u').map((u) => `${u.name} ${list(u.columns)}`));
  sameSet(
    ' fk',
    t.fks.map((f) => `${f.name} ${list(f.columns)} -> ${f.refTable}${list(f.refColumns)} delete ${f.onDelete === 'cascade' ? 'c' : 'a'}`),
    keyOf('f').map((f) => `${f.name} ${list(f.columns)} -> ${f.refTable}${list(f.refColumns)} delete ${f.deleteAction}`),
  );
  sameSet(
    ' indexes',
    indexesOf(t).map((i) => `${i.name} ${i.unique ? 'unique ' : ''}${list(i.columns)} where ${norm(i.where)}`),
    c.indexes.map((i) => `${i.name} ${i.unique ? 'unique ' : ''}${list(i.columns)} where ${norm(i.predicate)}`),
  );

  if (t.manualSource) {
    const tenant = t.scope === 'tenant';
    if (c.rlsEnabled !== tenant || c.rlsForced !== tenant) {
      at(' rls', `${t.scope} table: RLS enabled/forced should be ${tenant}/${tenant}, database has ${c.rlsEnabled}/${c.rlsForced}`);
    }
  }
  return p;
}

/**
 * Differences between the model and the catalog, one line each; empty when the
 * model (spec + overlay) describes the migrated database exactly.
 */
export function diffAgainstCatalog(model: Model, catalog: Catalog): string[] {
  const problems: string[] = [];
  const modelNames = model.tables.map((t) => t.name).sort();
  const dbNames = Object.keys(catalog).sort();
  for (const n of modelNames) if (!(n in catalog)) problems.push(`${n}: in the model (spec or overlay) but not in the database`);
  for (const n of dbNames) {
    if (!modelNames.includes(n)) problems.push(`${n}: in the database but neither in schema.json nor in the manual overlay`);
  }
  for (const t of model.tables) {
    const c = catalog[t.name];
    if (c) problems.push(...diffTable(t, c));
  }
  return problems;
}
