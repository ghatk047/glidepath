import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { membersHash } from '@glidepath/spec';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { TENANT_COLUMN } from './changeset';
import {
  SCENARIO_KINDS,
  modelCacheKey,
  type AuditEntry,
  type CalcRunRow,
  type ChangesetStore,
  type ChangesetTx,
  type ModelCache,
  type ModelCacheKey,
  type ScenarioRow,
  type ScenarioStore,
  type ScenarioTx,
} from './ports';
import { columnsOf, enumOf, repoRoot } from './test-support/schema-json';

const scenarioRow: ScenarioRow = {
  id: '00000000-0000-4000-8000-0000000000a1',
  key: 'C',
  label: 'C',
  kind: 'preset',
  parent_id: null,
  model_version_id: '00000000-0000-4000-8000-0000000000f1',
  version: 1,
  locked: true,
  created_by: '00000000-0000-4000-8000-0000000000e1',
  created_at: '2026-11-23T10:00:00.000Z',
};
const calcRun: CalcRunRow = {
  id: '00000000-0000-4000-8000-0000000000d1',
  scenario_id: scenarioRow.id,
  scenario_version: 1,
  model_version_id: scenarioRow.model_version_id,
  input_hash: 'abc',
  ms: 4,
  outputs: { 'res.net': 1 },
  created_at: '2026-11-23T10:00:00.000Z',
};
const audit: AuditEntry = {
  actor: scenarioRow.created_by,
  action: 'changeset.apply',
  entity: 'changeset',
  entity_key: 'cs-1',
  before: null,
  after: {},
  at: '2026-11-23T10:00:00.000Z',
};

describe('ports.ts declares ChangesetStore and ModelCache interfaces', () => {
  it('every ChangesetTx method is async (IO lives behind the port)', () => {
    type Results = { [K in keyof ChangesetTx]: ReturnType<ChangesetTx[K]> }[keyof ChangesetTx];
    expectTypeOf<Results>().toMatchTypeOf<Promise<unknown>>();
  });

  it('ChangesetStore.transaction hands fn a ChangesetTx and returns what fn returns', async () => {
    const tx = {} as ChangesetTx;
    const store: ChangesetStore = { transaction: (fn) => fn(tx) };
    await expect(store.transaction(async (t) => (t === tx ? 'same tx' : 'other'))).resolves.toBe(
      'same tx',
    );
  });

  it('ScenarioTx adds an async updateScenario; a ScenarioStore is a ChangesetStore', () => {
    type Results = { [K in keyof ScenarioTx]: ReturnType<ScenarioTx[K]> }[keyof ScenarioTx];
    expectTypeOf<Results>().toMatchTypeOf<Promise<unknown>>();
    expectTypeOf<ScenarioStore>().toMatchTypeOf<ChangesetStore>();
    // scenario.archived is no schema.json column: manual migration 0001 adds it (ADR-023).
    expect(columnsOf('scenario')).not.toContain('archived');
    const sql = readFileSync(
      resolve(
        repoRoot,
        'tier3-data/migrations/manual/0001_solver_run_progress_scenario_archived.sql',
      ),
      'utf8',
    );
    expect(sql).toMatch(/ALTER TABLE scenario ADD COLUMN archived boolean NOT NULL DEFAULT false/);
  });

  it('the port rows mirror schema.json (scenario, calc_run, audit_log), tenant_id from the store', () => {
    expect([TENANT_COLUMN, ...Object.keys(scenarioRow)].sort()).toEqual(
      columnsOf('scenario').sort(),
    );
    expect([...SCENARIO_KINDS]).toEqual(enumOf('scenario', 'kind'));
    expect([TENANT_COLUMN, ...Object.keys(calcRun)].sort()).toEqual(columnsOf('calc_run').sort());
    // audit_log.id is a bigserial the database assigns
    expect([TENANT_COLUMN, 'id', ...Object.keys(audit)].sort()).toEqual(
      columnsOf('audit_log').sort(),
    );
  });

  it('ModelCache is keyed by (tenant, model_version, members_hash)', () => {
    const members = { vp: [{ id: 'vp_a', label: 'A' }] };
    const key = modelCacheKey('t1', 'mv1', members);
    expect(key).toEqual<ModelCacheKey>({
      tenant_id: 't1',
      model_version_id: 'mv1',
      members_hash: membersHash(members),
    });

    // a trivial implementation satisfies the port
    const compiled = new Map<string, { n: number }>();
    let compiles = 0;
    const cache: ModelCache<{ n: number }> = {
      getOrCompile(k, compile) {
        const id = `${k.tenant_id}/${k.model_version_id}/${k.members_hash}`;
        let m = compiled.get(id);
        if (!m) compiled.set(id, (m = compile()));
        return m;
      },
    };
    const a = cache.getOrCompile(key, () => ({ n: ++compiles }));
    const b = cache.getOrCompile(
      modelCacheKey('t1', 'mv1', { vp: [{ label: 'A', id: 'vp_a' }] }),
      () => ({ n: ++compiles }),
    );
    expect(b).toBe(a);
    expect(compiles).toBe(1);
  });
});
