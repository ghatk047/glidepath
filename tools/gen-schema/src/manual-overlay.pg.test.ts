import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';
import { clientConfig } from '@glidepath/pg-local';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { diffAgainstCatalog, readCatalog, type Catalog } from './catalog-diff';
import { generateMigrations } from './generate';
import { buildFullModel, MANUAL_OVERLAY, type ManualOverlay } from './manual-overlay';
import { buildModel } from './model';
import { loadSchema, migrationsDir } from './spec';
import { startTestCluster, type TestCluster } from './testing/db';

const schema = loadSchema();
const manualFiles = readdirSync(resolve(migrationsDir, 'manual'))
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => `manual/${f}`);

let db: TestCluster;
let catalog: Catalog;
beforeAll(async () => {
  db = await startTestCluster('gp_overlay');
  // As `migrate()` does: generated files in name order, then manual files in name order, as the owner.
  await db.migrate([...generateMigrations(schema).keys(), ...manualFiles], { role: 'glidepath_owner' });
  // A typed client (db.withSession returns every value as text): arrays and booleans are read as such.
  const c = new pg.Client(clientConfig(db.url(db.database, 'glidepath_owner')));
  await c.connect();
  try {
    catalog = await readCatalog((sql, params) => c.query(sql, params));
  } finally {
    await c.end();
  }
}, 120_000);
afterAll(() => db?.stop());

const tweak = (fn: (o: ManualOverlay) => void): string[] => {
  const o = structuredClone(MANUAL_OVERLAY);
  fn(o);
  return diffAgainstCatalog(buildFullModel(schema, o), catalog);
};
const col = (o: ManualOverlay, table: string, name: string) =>
  [...o.addedColumns.filter((a) => a.table === table).flatMap((a) => a.columns), ...(o.tables.find((t) => t.name === table)?.columns ?? [])].find(
    (c) => c.name === name,
  )!;
const overlayTable = (o: ManualOverlay, name: string) => o.tables.find((t) => t.name === name)!;

describe('manual overlay (ADR-023) vs tier3-data/migrations/manual', () => {
  it('has overlay entries for every manual migration that changes the schema', () => {
    const sources = new Set([
      ...MANUAL_OVERLAY.addedColumns.map((a) => a.source),
      ...MANUAL_OVERLAY.tables.map((t) => t.source),
      ...(MANUAL_OVERLAY.addedKeys ?? []).map((k) => k.source),
    ]);
    expect([...sources].sort()).toEqual(manualFiles);
  });

  it('spec model + overlay describes the fully migrated database exactly (columns, types, nullability, defaults, keys, indexes, RLS)', () => {
    expect(diffAgainstCatalog(buildFullModel(schema), catalog)).toEqual([]);
  });

  it('the overlay never reaches the generated SQL: migrations are built from the spec model alone', () => {
    const generated = [...generateMigrations(schema).values()].join('\n');
    for (const t of MANUAL_OVERLAY.tables) expect(generated).not.toContain(t.name);
    expect(buildModel(schema).tables.map((t) => t.name)).not.toContain('stored_object');
  });

  describe('fails on drift between overlay and manual SQL', () => {
    it('a column type changed', () => {
      expect(tweak((o) => (col(o, 'solver_run', 'progress').type = 'text'))).toEqual([
        'solver_run.progress: type text in the model, real in the database',
      ]);
    });

    it('nullability changed', () => {
      expect(tweak((o) => (col(o, 'passkey', 'label').notNull = true))).toEqual([
        'passkey.label: NOT NULL is true in the model, false in the database',
      ]);
    });

    it('a default changed', () => {
      expect(tweak((o) => (col(o, 'scenario', 'archived').default = 'true'))).toEqual([
        'scenario.archived: default true in the model, false in the database',
      ]);
    });

    it('a column added by SQL is missing from the overlay', () => {
      const p = tweak((o) => {
        o.addedColumns.find((a) => a.table === 'solver_run')!.columns.pop();
      });
      expect(p.join('\n')).toMatch(/^solver_run: columns differ/);
    });

    it('a column only in the overlay', () => {
      const p = tweak((o) => {
        overlayTable(o, 'passkey').columns.push({ name: 'extra', type: 'text', notNull: false });
      });
      expect(p.join('\n')).toMatch(/^passkey: columns differ/);
    });

    it('a table created by SQL is missing from the overlay, and a table only in the overlay', () => {
      expect(tweak((o) => void (o.tables = o.tables.filter((t) => t.name !== 'stored_object')))).toEqual([
        'stored_object: in the database but neither in schema.json nor in the manual overlay',
      ]);
      const p = tweak((o) => {
        o.tables.push({ name: 'ghost', source: 'manual/none.sql', scope: 'global', columns: [{ name: 'id', type: 'uuid', notNull: true }], primaryKey: ['id'] });
      });
      expect(p).toEqual(['ghost: in the model (spec or overlay) but not in the database']);
    });

    it('a primary key, foreign key or index differs', () => {
      expect(tweak((o) => (overlayTable(o, 'stored_object').primaryKey = ['tenant_id', 'key', 'bucket'])).join('\n')).toMatch(/^stored_object pk: /);
      expect(tweak((o) => delete overlayTable(o, 'passkey').fks![0]!.onDelete).join('\n')).toMatch(/^passkey fk: /);
      expect(tweak((o) => (overlayTable(o, 'auth_session').indexes = [])).join('\n')).toMatch(/^auth_session indexes: /);
      expect(tweak((o) => delete overlayTable(o, 'stored_object').indexes![0]!.where).join('\n')).toMatch(/^stored_object indexes: /);
    });

    it('a same-tenant key added by SQL (DATA-12) is missing from the overlay, or differs', () => {
      const keys = (o: ManualOverlay, table: string) => o.addedKeys!.find((k) => k.table === table)!;
      const sr = (c: string): string => `solver_run_${c}_fkey (tenant_id, ${c}) -> scenario(tenant_id, id) delete a`;
      const tenantFk = 'solver_run_tenant_id_fkey (tenant_id) -> tenant(id) delete a';
      expect(tweak((o) => (keys(o, 'solver_run').fks = keys(o, 'solver_run').fks!.slice(1)))).toEqual([
        `solver_run fk: model [${sr('result_scenario_id')}; ${tenantFk}], database [${sr('result_scenario_id')}; ${sr('scenario_id')}; ${tenantFk}]`,
      ]);
      expect(tweak((o) => (keys(o, 'calc_run').fks![0]!.columns = ['scenario_id', 'tenant_id'])).join('\n')).toMatch(/^calc_run fk: /);
      expect(() => tweak((o) => (keys(o, 'scenario').uniques = []))).toThrow(/not a primary or unique key/);
      expect(() => tweak((o) => (keys(o, 'node_override').fks![0]!.refTable = 'nowhere'))).toThrow(/unknown table "nowhere"/);
    });

    it('a tenant overlay table without FORCE RLS in the database', () => {
      const weak: Catalog = { ...catalog, stored_object: { ...catalog.stored_object!, rlsForced: false } };
      expect(diffAgainstCatalog(buildFullModel(schema), weak).join('\n')).toMatch(/^stored_object rls: /);
    });
  });
});
