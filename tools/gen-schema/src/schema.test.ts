import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EXTENSION_ALLOW_LIST, parseConstraints } from './model';
import { checkMigrations, generateMigrations, SCHEMA_MIGRATION } from './generate';
import { loadSchema, migrationsDir } from './spec';
import { startPgLocal, type PgLocal } from './testing/pg-local';

const schema = loadSchema();
const tableNames = Object.keys(schema.tables);
const migrationFile = resolve(migrationsDir, SCHEMA_MIGRATION);

let pg: PgLocal;
beforeAll(() => {
  pg = startPgLocal();
  // One database owned by a plain (non-superuser) role: the Neon situation.
  pg.createOwnedDatabase('gp_schema', 'gp_owner');
  pg.psql({ db: 'gp_schema', user: 'gp_owner', file: migrationFile, singleTransaction: true });
}, 120_000);
afterAll(() => pg?.stop());

const q = (sql: string) => pg.psql({ db: 'gp_schema', user: 'gp_owner', sql }).trim();

describe('DATA-01 acceptance', () => {
  it('emits CREATE TABLE for all 27 tables with columns, types, PKs, FKs, unique constraints (applies cleanly; catalog has 27 tables)', () => {
    expect(tableNames).toHaveLength(27);
    const tables = q(`select tablename from pg_tables where schemaname = 'public' order by 1`).split('\n');
    expect(tables).toHaveLength(27);
    expect(tables).toEqual([...tableNames].sort());

    for (const [name, t] of Object.entries(schema.tables)) {
      // every column present, in spec order
      const cols = q(
        `select column_name from information_schema.columns where table_schema='public' and table_name='${name}' order by ordinal_position`,
      ).split('\n');
      expect(cols, name).toEqual(t.columns.map((c) => c.name));
      // a primary key on every table
      expect(q(`select count(*) from pg_constraint where conrelid='public.${name}'::regclass and contype='p'`), name).toBe('1');
    }

    // types
    const typeOf = (t: string, c: string) =>
      q(`select format_type(atttypid, atttypmod) from pg_attribute where attrelid='public.${t}'::regclass and attname='${c}'`);
    expect(typeOf('app_user', 'email')).toBe('citext');
    expect(typeOf('tenant', 'currency')).toBe('character(3)');
    expect(typeOf('line_item', 'confidence')).toBe('character(1)');
    expect(typeOf('variable_def', 'dims')).toBe('text[]');
    expect(typeOf('export_job', 'scenario_ids')).toBe('uuid[]');
    expect(typeOf('variable_value', 'value')).toBe('numeric');
    expect(typeOf('audit_log', 'id')).toBe('bigint');
    expect(typeOf('solver_run', 'status')).toBe('solver_run_status');
    expect(q(`select enum_range(null::dimension_def_scope)::text`)).toBe('{global,tenant,system,global+tenant}');

    // primary keys named by the spec
    const pk = (t: string) =>
      q(
        `select string_agg(a.attname, ',' order by array_position(c.conkey, a.attnum)) from pg_constraint c join pg_attribute a on a.attrelid=c.conrelid and a.attnum = any(c.conkey) where c.conrelid='public.${t}'::regclass and c.contype='p'`,
      );
    expect(pk('model_version')).toBe('id');
    expect(pk('dimension_def')).toBe('model_version_id,dim_key');
    expect(pk('dimension_member')).toBe('tenant_id,dim_key,member_key');
    expect(pk('line_item')).toBe('tenant_id,member_key');
    expect(pk('scenario')).toBe('id');
    expect(pk('node_override')).toBe('tenant_id,scenario_id,node_key,member_key');
    expect(pk('audit_log')).toBe('id');

    // foreign keys
    const fk = (t: string) =>
      q(`select pg_get_constraintdef(oid) from pg_constraint where conrelid='public.${t}'::regclass and contype='f' order by conname`);
    expect(fk('tenant')).toBe('FOREIGN KEY (model_version_id) REFERENCES model_version(id)');
    expect(fk('line_item_lever')).toContain('FOREIGN KEY (tenant_id, line_key) REFERENCES line_item(tenant_id, member_key)');
    expect(fk('line_item')).toContain('FOREIGN KEY (pool_id) REFERENCES canonical_pool(id)');
    expect(fk('line_item')).toContain('FOREIGN KEY (tenant_id) REFERENCES tenant(id)');
    // every table with `fk ... RLS key` tenant_id references tenant(id)
    const tenantTables = tableNames.filter((n) => schema.tables[n]!.columns.some((c) => /RLS key/.test(c.constraints)));
    expect(tenantTables.length).toBeGreaterThan(15);
    for (const t of tenantTables) expect(fk(t), t).toContain('FOREIGN KEY (tenant_id) REFERENCES tenant(id)');

    // unique constraints
    const uq = (t: string) =>
      q(`select pg_get_constraintdef(oid) from pg_constraint where conrelid='public.${t}'::regclass and contype='u' order by conname`);
    expect(uq('model_version')).toBe('UNIQUE (semver)');
    expect(uq('app_user')).toBe('UNIQUE (email)');
    expect(uq('tenant')).toBe('UNIQUE (slug)');
    expect(uq('scenario')).toBe('UNIQUE (tenant_id, key)');

    // nullability and defaults
    const nullable = (t: string, c: string) =>
      q(`select is_nullable from information_schema.columns where table_name='${t}' and column_name='${c}'`);
    expect(nullable('variable_def', 'min')).toBe('YES');
    expect(nullable('variable_def', 'label')).toBe('NO');
    expect(nullable('source', 'tenant_id')).toBe('YES');
    expect(q(`select column_default from information_schema.columns where table_name='node_def' and column_name='overridable'`)).toBe('true');
  });

  it('creates the indexes of 04 section 1 (catalog query)', () => {
    const idx = q(
      `select i.indisunique::text || ':' || c.relname || ':' || string_agg(a.attname, ',' order by array_position(i.indkey::int2[], a.attnum))
       from pg_index i join pg_class c on c.oid = i.indrelid join pg_attribute a on a.attrelid = c.oid and a.attnum = any(i.indkey::int2[])
       where c.relnamespace = 'public'::regnamespace group by i.indexrelid, i.indisunique, c.relname`,
    ).split('\n');
    expect(idx).toContain('true:variable_value:tenant_id,var_key,member_key');
    expect(idx).toContain('true:scenario_value:tenant_id,scenario_id,var_key,member_key');
    expect(idx).toContain('false:change:tenant_id,changeset_id');
    expect(idx).toContain('true:calc_run:tenant_id,scenario_id,input_hash');
    expect(idx).toContain('false:solver_run:tenant_id,status');
  });

  it('has no superuser-only statements (grep) and applies as a non-superuser owner', () => {
    const files = readdirSync(migrationsDir, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.sql'));
    expect(files).toContain(SCHEMA_MIGRATION);
    const forbidden = [
      /\bALTER\s+SYSTEM\b/i,
      /\bCREATE\s+(ROLE|USER|GROUP)\b/i,
      /\bALTER\s+(ROLE|USER)\b/i,
      /\bCREATE\s+LANGUAGE\b/i,
      /\bCOPY\b[^;]*\b(PROGRAM|FROM\s+'|TO\s+')/i,
      /\bsession_replication_role\b/i,
      /\bCREATE\s+TABLESPACE\b/i,
      /\bCREATE\s+EVENT\s+TRIGGER\b/i,
      /\bSET\s+ROLE\b/i,
      /\bLOAD\b\s+'/i,
    ];
    for (const f of files) {
      const sql = readFileSync(resolve(migrationsDir, f), 'utf8');
      for (const re of forbidden) expect(sql, `${f} ${re}`).not.toMatch(re);
      for (const m of sql.matchAll(/CREATE\s+EXTENSION\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([a-z0-9_]+)"?/gi)) {
        expect(EXTENSION_ALLOW_LIST as readonly string[], `${f}: extension ${m[1]}`).toContain(m[1]!.toLowerCase());
      }
    }
    // beforeAll already applied the migration as gp_owner; make sure that role is not privileged.
    expect(q(`select rolsuper::text || ',' || rolcreaterole::text || ',' || rolbypassrls::text from pg_roles where rolname = current_user`)).toBe(
      'false,false,false',
    );
    expect(q(`select count(*) from pg_tables where schemaname='public' and tableowner = current_user`)).toBe('27');
  });

  it('CI regenerate-and-diff: committed migrations equal a fresh generation', () => {
    const r = checkMigrations();
    expect(r.problems).toEqual([]);
    expect(r.ok).toBe(true);

    // generation is deterministic
    const a = generateMigrations(schema);
    const b = generateMigrations(loadSchema());
    expect([...a]).toEqual([...b]);

    // a hand-edited file is caught, and so is a spec change
    const dir = mkdtempSync(join(tmpdir(), 'gp-gen-'));
    try {
      writeFileSync(join(dir, SCHEMA_MIGRATION), readFileSync(migrationFile, 'utf8') + '\n-- hand edit\n');
      expect(checkMigrations(dir).ok).toBe(false);
      expect(checkMigrations(join(dir, 'nonexistent')).problems[0]).toMatch(/missing/);
      writeFileSync(join(dir, SCHEMA_MIGRATION), readFileSync(migrationFile, 'utf8'));
      expect(checkMigrations(dir).ok).toBe(true);
      const changed = structuredClone(schema);
      changed.tables.tenant!.columns.push({ name: 'extra', type: 'text', constraints: '', description: '' });
      expect(checkMigrations(dir, changed).ok).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('constraint parsing', () => {
  it('understands every constraint string used in schema.json and rejects unknown ones', () => {
    const all = new Set(tableNames.flatMap((n) => schema.tables[n]!.columns.map((c) => c.constraints)));
    for (const c of all) expect(() => parseConstraints('x', c), c).not.toThrow();
    expect(() => parseConstraints('x', 'frobnicate')).toThrow(/unrecognised/);
  });
});
