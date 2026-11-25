// DOM-05: the Recompute hook (steps 6-7 of the write path), calc_run caching, VR05 and VR08, and
// validatePreview. Checked on the seed tenant (docs/spec/seed/aa) with the real engine.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  compileModel,
  findScenario,
  resolveInputs as engineInputs,
  type CompiledModel,
  type Evaluation,
} from '@glidepath/engine';
import { membersHash } from '@glidepath/spec';
import { beforeAll, describe, expect, it } from 'vitest';
import { applyChangeset, type ApplyOptions } from './apply';
import { ChangesetRejectedError } from './apply-errors';
import type { ChangesetDraft } from './changeset';
import { revert } from './history';
import * as domain from './index';
import { modelCacheKey } from './ports';
import {
  engineOverrides,
  engineValues,
  headlineOutputs,
  recomputeHook,
  type RecomputeOptions,
  type RecomputeResult,
} from './recompute';
import { CountingModelCache } from './test-support/model-cache';
import { repoRoot } from './test-support/schema-json';
import {
  ACTOR,
  CUSTOM,
  MODEL_VERSION,
  T0,
  aaStore,
  presetId,
  seedPresetDraft,
  sequentialIds,
} from './test-support/seed-drafts';
import { loadSeedFixture, mutate, type SeedFixture } from './test-support/seed-state';
import {
  nodeMemberKeys,
  validateInputs,
  validateOutputs,
  validatePreview,
  vr05ManagedServices,
  vr08EngineSelfTest,
  type OutputEvaluation,
} from './validation';

const TENANT = '00000000-0000-4000-8000-0000000000a1';

type GoldenScenario = Record<string, number | Record<string, Record<string, number>>>;
const golden = JSON.parse(
  readFileSync(resolve(repoRoot, 'docs/spec/reference/golden_results.json'), 'utf8'),
) as { scenarios: Record<string, GoldenScenario> };

/**
 * As the parity gate (tools/parity): golden_results.json holds round(x, 6), so the value is rounded to
 * 6 decimals, then compared within 1e-6 relative with a 1e-9 absolute floor.
 */
const closeGolden = (a: number, b: number): boolean =>
  Math.abs(Number(a.toFixed(6)) - b) <= Math.max(1e-6 * Math.abs(b), 1e-9);

let fx: SeedFixture;
let model: CompiledModel;
let evC: Evaluation;

beforeAll(async () => {
  fx = await loadSeedFixture();
  model = compileModel(fx.bundle, fx.seed.dimensionMembers);
  const { values, overrides } = engineInputs(
    fx.bundle,
    fx.seed.variableValues,
    findScenario(fx.seed.scenarios, 'C'),
  );
  evC = model.evaluate(values, overrides);
});

function setup(cache = new CountingModelCache(), extra: Partial<RecomputeOptions> = {}) {
  const recompute = recomputeHook({
    tenantId: TENANT,
    modelVersionId: MODEL_VERSION,
    bundle: fx.bundle,
    cache,
    newId: sequentialIds('run'),
    now: () => T0,
    ...extra,
  });
  const options: ApplyOptions<RecomputeResult> = {
    actor: ACTOR,
    bundle: fx.bundle,
    newId: sequentialIds('cs'),
    now: () => T0,
    recompute,
  };
  return { cache, options };
}

const edit = (
  scenarioId: string | null,
  base: number,
  key: string,
  value: number,
  origin: ChangesetDraft['origin'] = 'ui',
): ChangesetDraft => ({
  origin,
  scenario_id: scenarioId,
  base_scenario_version: base,
  changes: [{ target: 'variable', key, member_key: '', op: 'set', new_value: value }],
});

const registryMax = (id: string): number => {
  const max = fx.bundle.variables.find((v) => v.id === id)?.max;
  if (typeof max !== 'number') throw new Error(`${id} has no max`);
  return max;
};

/** An evaluation over a plain map of engine cells (unit tests of the output rules). */
const fakeEval = (
  cells: Record<string, number>,
  overrides: Record<string, number> = {},
): OutputEvaluation => ({
  get: (c) => cells[c]!,
  has: (c) => c in cells,
  overrides: new Map(Object.entries(overrides)),
});

describe('DOM-05 recompute hook', () => {
  it('after write, the scenario is compiled via the ModelCache port and evaluated; result {scenarioId, version, inputHash, outputs: headline nodes}; on the seed tenant preset C outputs equal golden C within 1e-6 (test)', async () => {
    const store = aaStore(fx.seed);
    const { cache, options } = setup();
    // The seed rewrites preset C in place with its own values: the state is preset C.
    const r = await applyChangeset(store, seedPresetDraft(fx.seed, 'C', 1), options);
    const out = r.recomputed!;

    expect(cache.keys).toEqual([modelCacheKey(TENANT, MODEL_VERSION, fx.seed.dimensionMembers)]);
    expect(cache.keys[0]!.members_hash).toBe(membersHash(fx.seed.dimensionMembers));
    expect([cache.compiles, cache.evaluations]).toEqual([1, 1]);
    expect(out.scenarioId).toBe(presetId('C'));
    expect(out.version).toBe(2);
    expect(out.version).toBe(r.version);
    expect(out.cached).toBe(false);
    expect(out.inputHash).toBe(model.inputHash(evC.values, evC.overrides));

    // Outputs: every cell of every `output: true` node, by contract CellKey.
    const outputNodes = fx.bundle.nodes.filter((n) => n.output);
    const expected = outputNodes.flatMap((n) =>
      nodeMemberKeys(n, fx.seed.dimensionMembers).map((k) => `${n.id}[${k}]`),
    );
    expect(Object.keys(out.outputs)).toEqual(expected);
    expect(out.outputs).toEqual(headlineOutputs(fx.bundle, fx.seed.dimensionMembers, evC));

    // Golden C, within 1e-6: flat cells, then levers and VPs by their output nodes.
    const g = golden.scenarios.C!;
    const isOutput = (id: string) => outputNodes.some((n) => n.id === id);
    let compared = 0;
    const check = (cell: string, want: number) => {
      expect(out.outputs[cell], cell).toBeDefined();
      expect(closeGolden(out.outputs[cell]!, want), `${cell} ${out.outputs[cell]} vs ${want}`).toBe(
        true,
      );
      compared++;
    };
    for (const [key, v] of Object.entries(g)) {
      if (typeof v === 'number') check(key.includes('[') ? key : `${key}[]`, v);
    }
    for (const [group, prefix] of [
      ['levers', 'lev'],
      ['vp', 'vp'],
    ] as const) {
      for (const [member, fields] of Object.entries(
        g[group] as Record<string, Record<string, number>>,
      )) {
        for (const [field, want] of Object.entries(fields)) {
          const id = `${prefix}.${field}`;
          if (isOutput(id)) check(`${id}[${member}]`, want);
          else expect(out.outputs[`${id}[${member}]`]).toBeUndefined(); // e.g. lev.cx: not an output node
        }
      }
    }
    expect(compared).toBeGreaterThan(100);

    // calc_run: keyed (scenario, input_hash), output nodes only, stored before the commit.
    expect(store.tables.calcRuns).toEqual([
      {
        id: 'run-1',
        scenario_id: presetId('C'),
        scenario_version: 2,
        model_version_id: MODEL_VERSION,
        input_hash: out.inputHash,
        ms: expect.any(Number) as number,
        outputs: out.outputs,
        created_at: T0,
      },
    ]);
    expect(out.calcRunId).toBe('run-1');
    expect(store.calls.slice(-5)).toEqual([
      'bumpVersion',
      'appendAudit',
      'findCalcRun',
      'upsertCalcRun',
      'commit',
    ]);
  });

  it('calc_run payload keyed (scenario, input_hash); unchanged inputs → cache hit without evaluation (test)', async () => {
    const store = aaStore(fx.seed);
    const { cache, options } = setup();
    const x = await applyChangeset(store, edit(CUSTOM.id, 0, 'hc.ctr', 900), options);
    expect(x.recomputed!.cached).toBe(false);
    expect(cache.evaluations).toBe(1);

    // Undo: back to C's inputs, never computed on this scenario: a miss.
    const undo = await revert(store, x.changesetId, options);
    expect(undo.recomputed!.cached).toBe(false);
    expect(undo.recomputed!.inputHash).not.toBe(x.recomputed!.inputHash);
    expect(cache.evaluations).toBe(2);

    // Redo: the inputs of `x` again, so its calc_run answers and nothing is evaluated.
    const redo = await revert(store, undo.changesetId, options);
    const hit = redo.recomputed!;
    expect(cache.evaluations).toBe(2);
    expect(cache.compiles).toBe(1);
    expect(hit).toEqual({
      scenarioId: CUSTOM.id,
      version: 3,
      inputHash: x.recomputed!.inputHash,
      outputs: x.recomputed!.outputs,
      cached: true,
      calcRunId: x.recomputed!.calcRunId,
    });
    // One row per (scenario, input_hash); the hit is re-stamped with the scenario's new version.
    expect(
      store.tables.calcRuns.map((r) => [r.scenario_id, r.input_hash, r.scenario_version]),
    ).toEqual([
      [CUSTOM.id, undo.recomputed!.inputHash, 2],
      [CUSTOM.id, x.recomputed!.inputHash, 3],
    ]);
    // The same inputs on another scenario are another key: preset C's run is not CUSTOM's.
    const c = await applyChangeset(store, seedPresetDraft(fx.seed, 'C', 1), options);
    expect(c.recomputed!.inputHash).toBe(undo.recomputed!.inputHash);
    expect(c.recomputed!.cached).toBe(false);
    expect(cache.evaluations).toBe(3);
    expect(store.tables.calcRuns).toHaveLength(3);
  });

  it('VR05 lv.ms0 ≥ 0 is evaluated on the post-change state before commit; violation → reject, nothing persisted (test with constructed violation)', async () => {
    const store = aaStore(fx.seed);
    const { cache, options } = setup();
    const before = structuredClone(store.tables);
    // Twice the registry max of contractors: T&M cost exceeds the SI pool. The solver origin writes
    // past the bound (VR04 a warning), so only the output rule stops it.
    const draft = edit(CUSTOM.id, 0, 'hc.ctr', 2 * registryMax('hc.ctr'), 'solver');
    const err = await applyChangeset(store, draft, options).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ChangesetRejectedError);
    const violations = (err as ChangesetRejectedError).violations;
    expect(violations.map((v) => [v.rule, v.severity, v.cells])).toEqual([
      ['VR05', 'error', ['lv.ms0[]']],
    ]);
    expect(violations[0]!.message).toMatch(/contractor T&M cost exceeds the SI pool/);
    // Evaluated after the writes and the bump, inside the transaction, then rolled back.
    expect(cache.evaluations).toBe(1);
    const calls = store.calls;
    expect(calls.indexOf('writeValue')).toBeLessThan(calls.indexOf('bumpVersion'));
    expect(calls.indexOf('bumpVersion')).toBeLessThan(calls.indexOf('findCalcRun'));
    expect(calls.at(-1)).toBe('rollback');
    expect(calls).not.toContain('upsertCalcRun');
    expect(store.tables).toEqual(before);
  });

  it('VR08 lev.rr_check = 0 and vp.check = 0 are evaluated before commit; violation → reject, nothing persisted (test with constructed violation)', async () => {
    // A faulty engine: the self-test cells are off 0 (lev.rr_check[L03], vp.check).
    const faulty = (ev: Evaluation): Evaluation => {
      const broken = new Map([
        ['lev.rr_check[L03]', 0.25],
        ['vp.check', -1.5],
      ]);
      return {
        values: ev.values,
        overrides: ev.overrides,
        has: (c) => ev.has(c),
        get: (c) => broken.get(c) ?? ev.get(c),
      };
    };
    const store = aaStore(fx.seed);
    const { options } = setup(new CountingModelCache(faulty));
    const before = structuredClone(store.tables);
    const err = await applyChangeset(store, edit(CUSTOM.id, 0, 'hc.ctr', 900), options).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ChangesetRejectedError);
    expect((err as ChangesetRejectedError).violations.map((v) => [v.rule, v.cells])).toEqual([
      ['VR08', ['lev.rr_check[L03]']],
      ['VR08', ['vp.check[]']],
    ]);
    expect(store.calls.at(-1)).toBe('rollback');
    expect(store.tables).toEqual(before);
  });

  it('VR08 skips checks a pin feeds: pinning the SI pool (spec 01) commits, though it moves vp.check off 0', async () => {
    const store = aaStore(fx.seed);
    const { options } = setup();
    const pool = 'base.pool_outlay[si_contingent]';
    const pinned = evC.get(pool) * 0.9;
    const r = await applyChangeset(
      store,
      {
        origin: 'ui',
        scenario_id: CUSTOM.id,
        base_scenario_version: 0,
        changes: [
          {
            target: 'override',
            key: 'base.pool_outlay',
            member_key: 'si_contingent',
            op: 'set',
            new_value: pinned,
            note: 'finance view',
          },
        ],
      },
      options,
    );
    expect(r.recomputed!.outputs['base.pool_outlay[si_contingent]']).toBe(pinned);
    expect(store.tables.calcRuns).toHaveLength(1);

    const ev = model.evaluate(evC.values, new Map([[pool, pinned]]));
    expect(Math.abs(ev.get('vp.check'))).toBeGreaterThan(1e-3);
    const state = { bundle: fx.bundle, members: fx.seed.dimensionMembers, evaluation: ev };
    // Without the dependency graph every check is made; with it the pinned path is exempt.
    expect(validateOutputs(state).map((e) => [e.rule, e.cells])).toEqual([
      ['VR08', ['vp.check[]']],
    ]);
    expect(validateOutputs({ ...state, upstream: (c) => model.upstream(c) })).toEqual([]);
  });

  it('tenant defaults: evaluated and checked, no calc_run (no scenario to key it)', async () => {
    const store = aaStore(fx.seed);
    const { options } = setup();
    const r = await applyChangeset(store, edit(null, 0, 'hc.ctr', 900), options);
    expect(r.recomputed).toMatchObject({
      scenarioId: null,
      version: 1,
      cached: false,
      calcRunId: null,
    });
    expect(r.recomputed!.outputs['res.net[]']).toEqual(expect.any(Number));
    expect(store.calls).not.toContain('findCalcRun');
    expect(store.tables.calcRuns).toEqual([]);

    const bad = edit(null, 1, 'hc.ctr', 2 * registryMax('hc.ctr'), 'solver');
    await expect(applyChangeset(store, bad, options)).rejects.toBeInstanceOf(
      ChangesetRejectedError,
    );
  });

  it('a scenario of another model version is an error, and the default compile is the engine', async () => {
    const store = aaStore(fx.seed);
    const { options } = setup(new CountingModelCache(), { modelVersionId: 'other-version' });
    await expect(applyChangeset(store, edit(CUSTOM.id, 0, 'hc.ctr', 900), options)).rejects.toThrow(
      /model version/,
    );
    expect(store.calls.at(-1)).toBe('rollback');

    // Defaults: engine compile, random ids, the clock.
    const plain = recomputeHook({
      tenantId: TENANT,
      modelVersionId: MODEL_VERSION,
      bundle: fx.bundle,
      cache: { getOrCompile: (_key, compile) => compile() },
    });
    const r = await applyChangeset(store, edit(CUSTOM.id, 0, 'hc.ctr', 900), {
      actor: ACTOR,
      bundle: fx.bundle,
      recompute: plain,
    });
    const run = store.tables.calcRuns[0]!;
    expect(run.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(Number.isInteger(run.ms) && run.ms >= 0).toBe(true);
    expect(r.recomputed!.calcRunId).toBe(run.id);
  });

  it('engineValues / engineOverrides map stored rows to engine cell keys', () => {
    expect([
      ...engineValues([
        { var_key: 'hc.ctr', member_key: '', value: 800 },
        { var_key: 'corp.asm_g', member_key: 'fy27', value: 0.1 },
      ]),
    ]).toEqual([
      ['hc.ctr', 800],
      ['corp.asm_g[fy27]', 0.1],
    ]);
    expect([
      ...engineOverrides([{ node_key: 'res.net', member_key: '', value: 1, reason: '' }]),
    ]).toEqual([['res.net', 1]]);
  });
});

describe('DOM-05 output rules', () => {
  const members = () => fx.seed.dimensionMembers;
  const zeros = () =>
    Object.fromEntries([
      ['lv.ms0', 1],
      ['vp.check', 0],
      ...(members().lever ?? []).map((l) => [`lev.rr_check[${l.id}]`, 0]),
    ]) as Record<string, number>;

  it('the seed tenant presets pass VR05 and VR08', () => {
    for (const sid of fx.presets) {
      const { values, overrides } = engineInputs(
        fx.bundle,
        fx.seed.variableValues,
        findScenario(fx.seed.scenarios, sid),
      );
      const ev = model.evaluate(values, overrides);
      expect(
        validateOutputs({ bundle: fx.bundle, members: members(), evaluation: ev }),
        sid,
      ).toEqual([]);
    }
  });

  it('VR05 flags lv.ms0 below 0 (and NaN), within RULE_TOLERANCE', () => {
    const state = (ms0: number) => ({
      bundle: fx.bundle,
      members: members(),
      evaluation: fakeEval({ ...zeros(), 'lv.ms0': ms0 }),
    });
    expect(vr05ManagedServices(state(0))).toEqual([]);
    expect(vr05ManagedServices(state(-1e-12))).toEqual([]);
    expect(vr05ManagedServices(state(-3.5))[0]).toMatchObject({
      rule: 'VR05',
      severity: 'error',
      cells: ['lv.ms0[]'],
    });
    expect(vr05ManagedServices(state(Number.NaN))).toHaveLength(1);
    // A model without the node, or an evaluation without the cell: nothing to check.
    expect(vr05ManagedServices({ ...state(-1), bundle: { nodes: [] } })).toEqual([]);
    expect(
      vr05ManagedServices({ bundle: fx.bundle, members: members(), evaluation: fakeEval({}) }),
    ).toEqual([]);
  });

  it('VR08 lists failing self-test cells per node; a pinned check cell is skipped', () => {
    const cells = {
      ...zeros(),
      'lev.rr_check[L01]': 2,
      'lev.rr_check[L02]': -3,
      'vp.check': 1e-12,
    };
    const state = { bundle: fx.bundle, members: members(), evaluation: fakeEval(cells) };
    const [entry, ...rest] = vr08EngineSelfTest(state);
    expect(rest).toEqual([]);
    expect(entry).toMatchObject({
      rule: 'VR08',
      severity: 'error',
      cells: ['lev.rr_check[L01]', 'lev.rr_check[L02]'],
    });
    expect(entry!.message).toMatch(/-3/);
    expect(
      vr08EngineSelfTest({
        ...state,
        evaluation: fakeEval(cells, { 'lev.rr_check[L01]': 2, 'lev.rr_check[L02]': -3 }),
      }),
    ).toEqual([]);
  });

  it('nodeMemberKeys expands dims in order, over a node`s members subset when listed', () => {
    const m = { a: [{ id: 'x' }, { id: 'y' }], b: [{ id: '1' }, { id: '2' }] };
    expect(nodeMemberKeys({ dims: [] }, m)).toEqual(['']);
    expect(nodeMemberKeys({ dims: ['a', 'b'] }, m)).toEqual(['x,1', 'x,2', 'y,1', 'y,2']);
    expect(nodeMemberKeys({ dims: ['a', 'b'], members: { b: ['2'] } }, m)).toEqual(['x,2', 'y,2']);
    expect(nodeMemberKeys({ dims: ['c'] }, m)).toEqual([]);
  });
});

describe('DOM-05 validatePreview', () => {
  it('validatePreview(state) returns rule warnings without writing (used by API-07) (test)', () => {
    const max = registryMax('hc.ctr');
    // Scratch state: too many contractors (VR04 warning, VR05 error) and a retirement split over 100% (VR06).
    const scratch = mutate(fx.stateFor('C'), {
      set: [
        ['hc.ctr', '', 2 * max],
        ['lev.L09.split_sw', '', 0.7],
        ['lev.L09.split_cloud', '', 0.6],
      ],
    });
    const frozen = structuredClone(scratch);
    const evaluation = model.evaluate(engineValues(scratch.values), new Map());
    const entries = validatePreview({ ...scratch, evaluation, upstream: (c) => model.upstream(c) });
    // Input and output rules, merged in rule order; warnings and errors alike (the WS `warnings`).
    // Preset C itself carries VR04 warnings (seed values past a registry max), and no other entry.
    const baseline = validateInputs(fx.stateFor('C'));
    expect(baseline.every((e) => e.rule === 'VR04' && e.severity === 'warning')).toBe(true);
    const order = Object.keys(domain.VALIDATION_RULES);
    const ranks = entries.map((e) => order.indexOf(e.rule));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(
      entries.filter((e) => e.rule !== 'VR04').map((e) => [e.rule, e.severity, e.cells]),
    ).toEqual([
      ['VR05', 'error', ['lv.ms0[]']],
      ['VR06', 'error', ['lev.L09.split_sw[]', 'lev.L09.split_cloud[]']],
    ]);
    expect(entries.some((e) => e.rule === 'VR04' && e.cells.includes('hc.ctr[]'))).toBe(true);
    // Pure: the state is read, not changed, and there is no store to write to.
    expect(scratch).toEqual(frozen);
    // Without an evaluation only the input rules run; preset C adds no output entry.
    expect(validatePreview(scratch)).toEqual(validateInputs(scratch));
    expect(validatePreview({ ...fx.stateFor('C'), evaluation: evC })).toEqual(baseline);
  });

  it('the package exports the DOM-05 contract: the Recompute hook and validateOutputs()', () => {
    for (const fn of [
      'recomputeHook',
      'validateOutputs',
      'validatePreview',
      'headlineOutputs',
      'engineValues',
      'engineOverrides',
      'vr05ManagedServices',
      'vr08EngineSelfTest',
      'nodeMemberKeys',
    ] as const) {
      expect(typeof domain[fn]).toBe('function');
    }
    expect(domain.OUTPUT_RULE_IDS).toEqual(['VR05', 'VR08']);
    expect([...domain.INPUT_RULE_IDS, ...domain.OUTPUT_RULE_IDS].sort()).toEqual(
      Object.keys(domain.VALIDATION_RULES),
    );
  });
});
