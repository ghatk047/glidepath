import type { Model, ModelColumn, ModelIndex, ModelTable } from './model';
import { buildModel } from './model';
import type { SpecSchema } from './spec';

/**
 * Manual overlay (ADR-023): the columns and tables that hand-written migrations
 * in tier3-data/migrations/manual/ add on top of docs/spec/schema.json.
 *
 * The overlay feeds the typed tier-2 schema only (tier2-logic/data-access
 * scripts/gen-drizzle.ts, via `buildFullModel`). It never reaches the generated
 * SQL (`generateMigrations` uses `buildModel`): the manual SQL files stay the
 * single source of the DDL, and `manual-overlay.pg.test.ts` fails when this file
 * and that SQL disagree (columns, types, nullability, defaults, keys, indexes).
 *
 * Only structure that Drizzle models goes here: columns, primary/unique/foreign
 * keys, indexes. CHECK constraints, triggers, RLS policies and grants stay in SQL.
 */

/** Column types an overlay may use (Postgres spelling; `pgTypeName` maps them to `format_type` output). */
export const OVERLAY_TYPES = [
  'uuid',
  'text',
  'boolean',
  'integer',
  'bigint',
  'real',
  'bytea',
  'char(64)',
  'citext',
  'timestamptz',
  'text[]',
] as const;
export type OverlayType = (typeof OVERLAY_TYPES)[number];

/** Column defaults an overlay may use: the SQL text as Postgres reports it in the catalog. */
export type OverlayDefault = 'true' | 'false' | '0' | 'now()' | 'gen_random_uuid()';

export interface OverlayColumn {
  name: string;
  type: OverlayType;
  notNull: boolean;
  default?: OverlayDefault;
}

export interface OverlayFk {
  name: string;
  columns: string[];
  refTable: string;
  refColumns: string[];
  onDelete?: 'cascade';
}

/** Columns appended to a table of schema.json (in this order, after its spec columns). */
export interface OverlayAddedColumns {
  table: string;
  /** The manual migration that adds them, relative to tier3-data/migrations/. */
  source: string;
  columns: OverlayColumn[];
}

/** A table that exists only in manual migrations. */
export interface OverlayTable {
  name: string;
  source: string;
  /** `global`: no tenant_id, no RLS. `tenant`: tenant_id NOT NULL, ENABLE + FORCE RLS. */
  scope: 'global' | 'tenant';
  columns: OverlayColumn[];
  primaryKey: string[];
  uniques?: { name: string; columns: string[] }[];
  fks?: OverlayFk[];
  indexes?: ModelIndex[];
}

export interface ManualOverlay {
  addedColumns: OverlayAddedColumns[];
  tables: OverlayTable[];
}

const M1 = 'manual/0001_solver_run_progress_scenario_archived.sql';
const M2 = 'manual/0002_auth_tables.sql';
const M3 = 'manual/0003_stored_object.sql';

export const MANUAL_OVERLAY: ManualOverlay = {
  addedColumns: [
    {
      table: 'solver_run',
      source: M1,
      columns: [
        { name: 'progress', type: 'real', notNull: true, default: '0' },
        { name: 'progress_note', type: 'text', notNull: false },
        { name: 'cancel_requested', type: 'boolean', notNull: true, default: 'false' },
        { name: 'updated_at', type: 'timestamptz', notNull: true, default: 'now()' },
      ],
    },
    {
      table: 'scenario',
      source: M1,
      columns: [{ name: 'archived', type: 'boolean', notNull: true, default: 'false' }],
    },
  ],
  tables: [
    {
      name: 'auth_token',
      source: M2,
      scope: 'global',
      columns: [
        { name: 'id', type: 'uuid', notNull: true, default: 'gen_random_uuid()' },
        { name: 'token_hash', type: 'text', notNull: true },
        { name: 'email', type: 'citext', notNull: true },
        { name: 'user_id', type: 'uuid', notNull: false },
        { name: 'expires_at', type: 'timestamptz', notNull: true },
        { name: 'consumed_at', type: 'timestamptz', notNull: false },
        { name: 'created_at', type: 'timestamptz', notNull: true, default: 'now()' },
      ],
      primaryKey: ['id'],
      uniques: [{ name: 'auth_token_token_hash_key', columns: ['token_hash'] }],
      fks: [
        {
          name: 'auth_token_user_id_fkey',
          columns: ['user_id'],
          refTable: 'app_user',
          refColumns: ['id'],
          onDelete: 'cascade',
        },
      ],
      indexes: [{ name: 'auth_token_expires_at_idx', columns: ['expires_at'], unique: false }],
    },
    {
      name: 'auth_session',
      source: M2,
      scope: 'global',
      columns: [
        { name: 'id', type: 'uuid', notNull: true, default: 'gen_random_uuid()' },
        { name: 'user_id', type: 'uuid', notNull: true },
        { name: 'expires_at', type: 'timestamptz', notNull: true },
        { name: 'created_at', type: 'timestamptz', notNull: true, default: 'now()' },
      ],
      primaryKey: ['id'],
      fks: [
        {
          name: 'auth_session_user_id_fkey',
          columns: ['user_id'],
          refTable: 'app_user',
          refColumns: ['id'],
          onDelete: 'cascade',
        },
      ],
      indexes: [
        { name: 'auth_session_user_id_idx', columns: ['user_id'], unique: false },
        { name: 'auth_session_expires_at_idx', columns: ['expires_at'], unique: false },
      ],
    },
    {
      name: 'passkey',
      source: M2,
      scope: 'global',
      columns: [
        { name: 'credential_id', type: 'text', notNull: true },
        { name: 'user_id', type: 'uuid', notNull: true },
        { name: 'public_key', type: 'bytea', notNull: true },
        { name: 'sign_count', type: 'bigint', notNull: true, default: '0' },
        { name: 'transports', type: 'text[]', notNull: false },
        { name: 'label', type: 'text', notNull: false },
        { name: 'created_at', type: 'timestamptz', notNull: true, default: 'now()' },
        { name: 'last_used_at', type: 'timestamptz', notNull: false },
      ],
      primaryKey: ['credential_id'],
      fks: [
        {
          name: 'passkey_user_id_fkey',
          columns: ['user_id'],
          refTable: 'app_user',
          refColumns: ['id'],
          onDelete: 'cascade',
        },
      ],
      indexes: [{ name: 'passkey_user_id_idx', columns: ['user_id'], unique: false }],
    },
    {
      name: 'stored_object',
      source: M3,
      scope: 'tenant',
      columns: [
        { name: 'tenant_id', type: 'uuid', notNull: true },
        { name: 'bucket', type: 'text', notNull: true },
        { name: 'key', type: 'text', notNull: true },
        { name: 'content_type', type: 'text', notNull: true },
        { name: 'bytes', type: 'bytea', notNull: true },
        { name: 'sha256', type: 'char(64)', notNull: true },
        { name: 'size', type: 'bigint', notNull: true },
        { name: 'created_at', type: 'timestamptz', notNull: true, default: 'now()' },
        { name: 'expires_at', type: 'timestamptz', notNull: false },
      ],
      primaryKey: ['tenant_id', 'bucket', 'key'],
      fks: [{ name: 'stored_object_tenant_id_fkey', columns: ['tenant_id'], refTable: 'tenant', refColumns: ['id'] }],
      indexes: [
        { name: 'stored_object_expires_idx', columns: ['expires_at'], unique: false, where: 'expires_at IS NOT NULL' },
      ],
    },
  ],
};

const OVERLAY_DEFAULTS: readonly string[] = ['true', 'false', '0', 'now()', 'gen_random_uuid()'];

/** What `format_type()` reports for a column type of the model or the overlay. */
export function pgTypeName(sqlType: string): string {
  if (sqlType === 'timestamptz') return 'timestamp with time zone';
  if (sqlType === 'bigserial') return 'bigint';
  const ch = /^char\((\d+)\)$/.exec(sqlType);
  if (ch) return `character(${ch[1]})`;
  return sqlType;
}

function overlayColumn(c: OverlayColumn, where: string, source?: string): ModelColumn {
  if (!(OVERLAY_TYPES as readonly string[]).includes(c.type)) throw new Error(`${where}: unsupported overlay type "${c.type}"`);
  if (c.default !== undefined && !OVERLAY_DEFAULTS.includes(c.default)) throw new Error(`${where}: unsupported overlay default "${c.default}"`);
  const col: ModelColumn = { name: c.name, sqlType: c.type, notNull: c.notNull, description: '' };
  if (source) col.manualSource = source;
  if (c.default !== undefined) col.defaultSql = c.default;
  return col;
}

function assertColumns(where: string, have: ModelColumn[], names: string[]): void {
  for (const n of names) if (!have.some((c) => c.name === n)) throw new Error(`${where}: column "${n}" does not exist`);
}

/**
 * schema.json model plus the manual overlay: the shape of the database after
 * every migration (generated and manual). Pure. Fails on any overlay entry that
 * clashes with schema.json or refers to something that does not exist.
 */
export function buildFullModel(schema: SpecSchema, overlay: ManualOverlay = MANUAL_OVERLAY): Model {
  const base = buildModel(schema);
  const tables: ModelTable[] = base.tables.map((t) => ({ ...t, columns: [...t.columns] }));
  const byName = new Map(tables.map((t) => [t.name, t]));

  for (const add of overlay.addedColumns) {
    const t = byName.get(add.table);
    if (!t) throw new Error(`overlay: columns added to unknown table "${add.table}"`);
    for (const c of add.columns) {
      if (t.columns.some((x) => x.name === c.name)) throw new Error(`overlay: ${add.table}.${c.name} already exists`);
      t.columns.push(overlayColumn(c, `${add.table}.${c.name}`, add.source));
    }
  }

  for (const o of overlay.tables) {
    if (byName.has(o.name)) throw new Error(`overlay: table "${o.name}" already exists`);
    const columns = o.columns.map((c) => overlayColumn(c, `${o.name}.${c.name}`));
    const names = columns.map((c) => c.name);
    if (new Set(names).size !== names.length) throw new Error(`overlay: ${o.name} has duplicate columns`);
    assertColumns(`overlay: ${o.name} pk`, columns, o.primaryKey);
    for (const k of o.primaryKey) {
      if (!columns.find((c) => c.name === k)!.notNull) throw new Error(`overlay: ${o.name} pk column "${k}" is nullable`);
    }
    if (o.scope === 'tenant') {
      const tid = columns.find((c) => c.name === 'tenant_id');
      if (!tid || tid.sqlType !== 'uuid' || !tid.notNull) throw new Error(`overlay: tenant table ${o.name} needs tenant_id uuid NOT NULL`);
    } else if (names.includes('tenant_id')) {
      throw new Error(`overlay: global table ${o.name} must not have tenant_id`);
    }
    const uniques = o.uniques ?? [];
    for (const u of uniques) assertColumns(`overlay: ${o.name} unique ${u.name}`, columns, u.columns);
    const indexes = o.indexes ?? [];
    for (const i of indexes) assertColumns(`overlay: ${o.name} index ${i.name}`, columns, i.columns);
    const fks = (o.fks ?? []).map((f) => {
      assertColumns(`overlay: ${o.name} fk ${f.name}`, columns, f.columns);
      const target = byName.get(f.refTable);
      if (!target) throw new Error(`overlay: ${o.name} fk ${f.name} targets unknown table "${f.refTable}" (overlay tables must follow their targets)`);
      assertColumns(`overlay: ${o.name} fk ${f.name} target ${f.refTable}`, target.columns, f.refColumns);
      const ref = { name: f.name, columns: f.columns, refTable: f.refTable, refColumns: f.refColumns };
      return f.onDelete ? { ...ref, onDelete: f.onDelete } : ref;
    });
    const t: ModelTable = {
      name: o.name,
      scope: o.scope,
      description: '',
      columns,
      primaryKey: o.primaryKey,
      uniques,
      fks,
      indexes,
      manualSource: o.source,
      unenforcedRefs: [],
    };
    tables.push(t);
    byName.set(t.name, t);
  }

  return { ...base, tables };
}
