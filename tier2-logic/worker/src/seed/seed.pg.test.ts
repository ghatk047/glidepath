import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createChangesetStore, createDb, loadMembers, loadResolvedInputs, loadSourcingMembers, schema, sql, withTenant, type DbHandle } from '@glidepath/data-access';
import { SOURCING_DIMENSIONS, applyChangeset, ChangesetRejectedError } from '@glidepath/domain';
import { start, stop, type PgLocalInstance } from '@glidepath/pg-local';
import { seedToTenantData } from '@glidepath/spec';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cellsOf } from './drafts';
import { findTier3Data, readSeedInputs, type SeedInputs } from './files';
import { seedIds } from './ids';
import { runMigrate, type MigrateRunReport } from './run';

/**
 * DATA-08 on pg-local: the migrate entry against a fresh cluster bootstrapped like compose
 * (tier3-data/postgres/init: roles glidepath_owner and glidepath_app). Tests run in order and share
 * the database: first run, then reruns. Reads go through glidepath_app (RLS applies).
 */

const DEMO_EMAIL = 'demo@example.com';
const tier3Data = findTier3Data();

let instance: PgLocalInstance;
let stateFile: string;
let ownerUrl: string;
let inputs: SeedInputs;
let app: DbHandle;
let first: MigrateRunReport;

const asRole = (url: string, role: string): string => {
  const u = new URL(url);
  u.username = role;
  return u.toString();
};

const run = (extra: { demoUserEmail?: string } = { demoUserEmail: DEMO_EMAIL }) =>
  runMigrate({ databaseUrl: ownerUrl, seed: 'aa', tier3Data, ...extra });

const tenantId = seedIds.tenant('aa');
const SYSTEM_USER = seedIds.seedActor();
const inTenant = <T>(fn: Parameters<typeof withTenant<T>>[3]) => withTenant(app.db, tenantId, SYSTEM_USER, fn);

async function count(table: string): Promise<number> {
  return inTenant(async (tx) => {
    const r = await tx.execute<{ n: number }>(sql`select count(*)::int as n from ${sql.identifier(table)}`);
    return r.rows[0]!.n;
  });
}

const TENANT_TABLES = [
  'tenant', 'dimension_member', 'line_item', 'line_item_lever', 'source', 'variable_value', 'scenario',
  'scenario_value', 'node_override', 'changeset', 'change', 'tenant_membership',
] as const;
const GLOBAL_TABLES = [
  'model_version', 'dimension_def', 'variable_def', 'node_def', 'lever_template', 'canonical_pool', 'addr_tag',
  'app_user',
] as const;

async function snapshot(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of [...TENANT_TABLES, ...GLOBAL_TABLES]) out[t] = await count(t);
  return out;
}

beforeAll(async () => {
  stateFile = join(tmpdir(), `gp-worker-seed-${process.pid}.json`);
  instance = await start({ stateFile, init: resolve(tier3Data, 'postgres/init') });
  ownerUrl = asRole(instance.url, 'glidepath_owner');
  app = createDb(asRole(instance.url, 'glidepath_app'));
  inputs = await readSeedInputs(tier3Data, 'aa');
  first = await run();
}, 240_000);

afterAll(async () => {
  await app?.close();
  if (instance) stop({ instance, stateFile });
});

describe('migrate entry on pg-local', () => {
  it('runs data-access migrate() and loads the global defs from the spec JSON copied to tier3-data/seed', async () => {
    expect(first.migrations.applied.length).toBeGreaterThan(0);
    const { bundle } = inputs.global;
    const n = await snapshot();
    expect(n.model_version).toBe(1);
    expect(n.dimension_def).toBe(bundle.dimensions.length);
    expect(n.variable_def).toBe(bundle.variables.length);
    expect(n.node_def).toBe(bundle.nodes.length);
    expect(n.lever_template).toBe(inputs.tenant.dimensionMembers.lever!.length);
    expect(n.canonical_pool).toBe(inputs.tenant.dimensionMembers.pool!.length);
    expect(n.addr_tag).toBe(inputs.tenant.dimensionMembers.addr_tag!.length);

    await inTenant(async (tx) => {
      const mv = await tx.select().from(schema.model_version);
      expect(mv[0]).toMatchObject({ id: first.modelDefs!.modelVersionId, semver: bundle.specVersion, status: 'published' });
      const levers = await tx.select().from(schema.lever_template);
      const l05 = levers.find((l) => l.code === 'L05')!;
      expect(l05.var_keys).toContain('lev.L05.nb');
      expect(l05.node_keys).toContain('lev.L05.us_saving');
      expect(l05.library).toHaveProperty('hypothesis');
      const pinned = await tx.select({ m: schema.tenant.model_version_id }).from(schema.tenant);
      expect(pinned).toEqual([{ m: mv[0]!.id }]);
    });
  });

  it('does not seed pool, addr_tag or system dims into dimension_member (v_dimension_members renders them)', async () => {
    await inTenant(async (tx) => {
      const r = await tx.execute<{ dim_key: string }>(
        sql`select distinct dim_key from dimension_member order by dim_key`,
      );
      // SRC-02: plus the sourcing dimensions of sourcing.json
      expect(r.rows.map((x) => x.dim_key)).toEqual(['benchmark', 'contract', 'domain', 'lever', 'lgroup', 'sourcing_param', 'vendor', 'vp']);
      const v = await tx.execute<{ dim_key: string }>(
        sql`select distinct dim_key from v_dimension_members where tenant_id is null order by dim_key`,
      );
      expect(v.rows.map((x) => x.dim_key)).toEqual(['addr_tag', 'akey', 'iyear', 'pool', 'year']);
    });
  });

  it('loads tier3-data/seed/aa through applyChangeset with origin seed: members, lines, sources, defaults, presets and their values', async () => {
    const { dimensionMembers } = inputs.tenant;
    expect(await count('line_item')).toBe(dimensionMembers.line!.length);
    const nMembers =
      ['domain', 'vp', 'vendor', 'lgroup', 'lever'].reduce((a, d) => a + dimensionMembers[d]!.length, 0) +
      SOURCING_DIMENSIONS.reduce((a, d) => a + inputs.sourcing!.dimensions[d].length, 0);
    expect(await count('dimension_member')).toBe(nMembers);
    expect(await count('line_item_lever')).toBe(
      dimensionMembers.line!.reduce((a, m) => a + (m.lever_ids as unknown[]).length, 0),
    );
    expect(await count('source')).toBeGreaterThan(0);
    expect(await count('variable_value')).toBe(cellsOf(inputs.tenant.variableValues).length);
    expect(await count('scenario')).toBe(5);
    expect(await count('scenario_value')).toBe(
      inputs.tenant.scenarios.scenarios.reduce((a, s) => a + cellsOf(s.values).length, 0),
    );

    await inTenant(async (tx) => {
      const sets = await tx.select().from(schema.changeset);
      expect(sets).toHaveLength(1 + 5);
      expect(new Set(sets.map((c) => c.origin))).toEqual(new Set(['seed']));
      expect(new Set(sets.map((c) => c.status))).toEqual(new Set(['applied']));
      // line members read back through the view with their lever ids and source code
      const line = await tx.execute<{ attrs: Record<string, unknown> }>(
        sql`select attrs from v_dimension_members where dim_key = 'line' and member_key = 'it_001'`,
      );
      expect(line.rows[0]!.attrs).toMatchObject({ pool: 'internal_labour', lever_ids: ['L05'], legacy_id: 'IT-001' });
      // the spec's out-of-bounds default is kept and flagged (VR04 is a warning for the seed)
      const msgs = await tx.execute<{ n: number }>(
        sql`select count(*)::int as n from change where messages ? 'warnings'`,
      );
      expect(msgs.rows[0]!.n).toBeGreaterThan(0);
    });
  });

  it('SRC-02: loads sourcing.json in the tenant-defaults changeset; loadSourcingMembers serves it, loadMembers (the engine) does not', async () => {
    await inTenant(async (tx) => {
      const read = await loadSourcingMembers(tx);
      for (const dim of SOURCING_DIMENSIONS) {
        expect(read.members[dim]!.map((m) => m.id), dim).toEqual(inputs.sourcing!.dimensions[dim].map((m) => m.id));
      }
      const rate = read.members.sourcing_param!.find((m) => m.id === 'discount_rate')!;
      expect(rate).toMatchObject({ label: 'Discount rate', group: 'business_case', unit: '%' });
      const c = read.members.contract![0]!;
      expect(c).toEqual(inputs.sourcing!.dimensions.contract[0]);
      const snap = await loadMembers(tx);
      expect(Object.keys(snap.members).filter((d) => (SOURCING_DIMENSIONS as readonly string[]).includes(d))).toEqual([]);
    });
  });

  it('SRC-02: a sourcing_param edit through applyChangeset commits and leaves the members hash and the preset calc_runs as they are; out of range is rejected', async () => {
    const { bundle } = inputs.global;
    const before = await inTenant(async (tx) => ({
      hash: (await loadMembers(tx)).membersHash,
      runs: (await tx.select({ id: schema.calc_run.scenario_id, h: schema.calc_run.input_hash }).from(schema.calc_run)).sort((a, b) => a.id.localeCompare(b.id)),
    }));
    const edit = (value: number) =>
      inTenant(async (tx) => {
        const store = createChangesetStore(tx);
        const version = await store.transaction(async (t) => (await t.changesSince(null, 0)).length);
        const row = await store.transaction(async (t) => (await t.loadMemberRows('sourcing_param', ['discount_rate'])).get('discount_rate')!);
        const attrs = { ...(row.attrs as Record<string, number>), value };
        return applyChangeset(
          store,
          { origin: 'api', scenario_id: null, base_scenario_version: version, changes: [{ target: 'structural', key: 'sourcing_param', member_key: 'discount_rate', op: 'set', new_value: { attrs } }] },
          { actor: SYSTEM_USER, bundle },
        );
      });
    const applied = await edit(0.1);
    expect(applied.changeset.status).toBe('applied');
    await expect(edit(0.5)).rejects.toBeInstanceOf(ChangesetRejectedError);
    await inTenant(async (tx) => {
      expect((await loadSourcingMembers(tx)).members.sourcing_param!.find((m) => m.id === 'discount_rate')!.value).toBe(0.1);
      expect((await loadMembers(tx)).membersHash).toBe(before.hash);
      const runs = (await tx.select({ id: schema.calc_run.scenario_id, h: schema.calc_run.input_hash }).from(schema.calc_run)).sort((a, b) => a.id.localeCompare(b.id));
      expect(runs).toEqual(before.runs);
    });
    // a rerun does not reset the edited member (users own it); put it back for the tests below
    expect((await run()).tenant!.written).toEqual({});
    await edit(inputs.sourcing!.dimensions.sourcing_param.find((m) => m.id === 'discount_rate')!.value as number);
  });

  it('marks only the seed default_scenario as is_default (WEB-12)', async () => {
    await inTenant(async (tx) => {
      const rows = await tx.select().from(schema.scenario);
      expect(rows.filter((r) => r.is_default).map((r) => r.key)).toEqual([inputs.tenant.scenarios.default_scenario]);
    });
  });

  it('sets scenario.sort_order to the position in scenarios.json (DATA-14), also on a re-run', async () => {
    const order = inputs.tenant.scenarios.scenarios.map((s) => s.id);
    expect(order[0]).toBe('rates');
    await inTenant(async (tx) => {
      const rows = await tx.select().from(schema.scenario);
      expect(Object.fromEntries(rows.map((r) => [r.key, r.sort_order]))).toEqual(Object.fromEntries(order.map((k, i) => [k, i])));
    });
  });

  it('creates the five presets locked, and the default scenario is C', async () => {
    const { scenarios } = inputs.tenant;
    expect(scenarios.default_scenario).toBe('C');
    await inTenant(async (tx) => {
      const rows = await tx.select().from(schema.scenario);
      expect(rows.map((r) => r.key).sort()).toEqual(scenarios.scenarios.map((s) => s.id).sort());
      expect(rows.every((r) => r.locked && r.kind === 'preset' && r.parent_id === null)).toBe(true);
      expect(rows.every((r) => r.version === 1)).toBe(true);
      const c = rows.find((r) => r.key === scenarios.default_scenario)!;
      expect(c.id).toBe(first.tenant!.presets.C);
      expect(first.tenant!.defaultScenario).toBe('C');
    });
  });

  it('recomputes each preset changeset: every preset has a calc_run of its version, so GET calc serves it [INT-02]', async () => {
    await inTenant(async (tx) => {
      const scenarios = await tx.select().from(schema.scenario);
      const runs = await tx.select().from(schema.calc_run);
      expect(runs).toHaveLength(scenarios.length);
      for (const s of scenarios) {
        const run = runs.find((r) => r.scenario_id === s.id);
        expect(run, s.key).toMatchObject({ scenario_version: s.version, model_version_id: s.model_version_id });
        expect(Object.keys(run!.outputs as Record<string, number>), s.key).toContain('res.net[]');
      }
    });
  });

  it('creates a fictitious demo user with an owner membership from DEMO_USER_EMAIL', async () => {
    expect(first.tenant!.demoUserId).toBe(seedIds.user(DEMO_EMAIL));
    await inTenant(async (tx) => {
      const m = await tx.select().from(schema.tenant_membership);
      expect(m).toEqual([{ tenant_id: tenantId, user_id: seedIds.user(DEMO_EMAIL), role: 'owner' }]);
      const u = await tx.select().from(schema.app_user);
      expect(u.map((x) => x.email).sort()).toEqual([DEMO_EMAIL, 'seed-loader@glidepath.invalid']);
    });
  });

  it('after seed, resolved inputs equal seedToTenantData cell for cell (C, the other presets and the tenant defaults)', async () => {
    const cells = (rows: readonly { var_key: string; member_key: string; value: number }[]) =>
      new Map(rows.map((r) => [r.member_key === '' ? r.var_key : `${r.var_key}[${r.member_key}]`, r.value]));
    const { bundle } = inputs.global;
    await inTenant(async (tx) => {
      const keys: (string | null)[] = [null, ...inputs.tenant.scenarios.scenarios.map((s) => s.id)];
      for (const key of keys) {
        const resolved = await loadResolvedInputs(tx, key === null ? null : first.tenant!.presets[key]!);
        const expected = seedToTenantData(inputs.tenant, key ?? undefined, bundle);
        expect(cells(resolved!.values), String(key)).toEqual(expected.values);
        expect(resolved!.overrides, String(key)).toHaveLength(expected.overrides.size);
      }
    });
  });

  it('is idempotent: a second run makes 0 changes', async () => {
    const before = await snapshot();
    const versions = await inTenant(async (tx) => (await tx.select({ k: schema.scenario.key, v: schema.scenario.version }).from(schema.scenario)).sort((a, b) => a.k.localeCompare(b.k)));
    const second = await run();
    expect(second.changes).toBe(0);
    expect(second.migrations.applied).toEqual([]);
    expect(second.modelDefs!.total).toBe(0);
    expect(second.tenant!.written).toEqual({});
    expect(await snapshot()).toEqual(before);
    const after = await inTenant(async (tx) => (await tx.select({ k: schema.scenario.key, v: schema.scenario.version }).from(schema.scenario)).sort((a, b) => a.k.localeCompare(b.k)));
    expect(after).toEqual(versions);
    // the same without a demo user changes nothing either
    expect((await run({})).changes).toBe(0);
  });

  it('a rerun restores what was lost but never resets what a user changed', async () => {
    await inTenant(async (tx) => {
      await tx.execute(sql`delete from variable_value where var_key = 'g.target_net'`);
      await tx.execute(sql`update variable_value set value = 77 where var_key = 'g.target_pct'`);
      await tx.execute(sql`update scenario_value set value = 1234 where scenario_id = ${first.tenant!.presets.A} and var_key = 'g.head_start'`);
    });
    const r = await run();
    expect(r.tenant!.written).toMatchObject({ 'changeset (tenant defaults)': 1, 'changes (tenant defaults)': 1, 'changeset (preset)': 1, 'changes (preset)': 1 });
    await inTenant(async (tx) => {
      const rows = await tx.execute<{ var_key: string; value: string }>(
        sql`select var_key, value from variable_value where var_key in ('g.target_net', 'g.target_pct')`,
      );
      const byKey = Object.fromEntries(rows.rows.map((x) => [x.var_key, Number(x.value)]));
      expect(byKey).toEqual({ 'g.target_net': inputs.tenant.variableValues['g.target_net'], 'g.target_pct': 77 });
      const resolved = await loadResolvedInputs(tx, first.tenant!.presets.A!);
      const head = resolved!.values.find((v) => v.var_key === 'g.head_start')!;
      expect(head.value).toBe(seedToTenantData(inputs.tenant, 'A', inputs.global.bundle).values.get('g.head_start'));
    });
    expect((await run()).changes).toBe(0);
  });

  it('refuses to load definitions that differ from the published model_version of the same semver', async () => {
    await expect(
      runMigrate({ databaseUrl: ownerUrl, seed: 'aa', tier3Data: changedSeedDir() }),
    ).rejects.toThrow(/frozen/);
  });
});

/** A copy of tier3-data whose variables.json differs (one trailing space: the content hash changes). */
function changedSeedDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'gp-seed-changed-'));
  cpSync(join(tier3Data, 'seed'), join(dir, 'seed'), { recursive: true });
  cpSync(join(tier3Data, 'migrations'), join(dir, 'migrations'), { recursive: true });
  const p = join(dir, 'seed/variables.json');
  writeFileSync(p, readFileSync(p, 'utf8') + ' ');
  return dir;
}
