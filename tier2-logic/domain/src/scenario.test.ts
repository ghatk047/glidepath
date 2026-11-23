import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { applyChangeset, summaryOf, type ApplyOptions } from './apply';
import {
  ChangesetRejectedError,
  ScenarioNotFoundError,
  ScenarioOperationError,
  ScenarioPermissionError,
} from './apply-errors';
import type { Change, ChangesetDraft, ChangesetOrigin, ScenarioId } from './changeset';
import type { ScenarioRow } from './ports';
import { resolveInputs } from './resolve';
import {
  PRESET_UNLOCK_ROLES,
  SCENARIO_EDIT_ROLES,
  TENANT_ROLES,
  blendFrom,
  createScenario,
  patchScenario,
  scenarioName,
  type CreateScenarioOptions,
  type PatchScenarioOptions,
  type TenantRole,
} from './scenario';
import type { MemoryChangesetStore } from './test-support/memory-store';
import { enumOf } from './test-support/schema-json';
import {
  ACTOR,
  CUSTOM,
  MODEL_VERSION,
  OTHER_USER,
  T0,
  aaStore,
  presetId,
  sequentialIds,
} from './test-support/seed-drafts';
import { loadSeedFixture, type SeedFixture } from './test-support/seed-state';

let fx: SeedFixture;
beforeAll(async () => {
  fx = await loadSeedFixture();
});
/** One id sequence per test, for scenarios and changesets alike. */
let newId: () => string;
beforeEach(() => {
  newId = sequentialIds('new');
});

const C = presetId('C');
const D = presetId('D');

const opts = <R = undefined>(
  extra: Partial<CreateScenarioOptions<R>> = {},
): CreateScenarioOptions<R> => ({
  actor: ACTOR,
  bundle: fx.bundle,
  newId,
  now: () => T0,
  ...extra,
});
const applyOpts = (): ApplyOptions => ({ actor: ACTOR, bundle: fx.bundle, newId, now: () => T0 });
const as = (role: TenantRole): PatchScenarioOptions => ({ actor: ACTOR, role, now: () => T0 });

const set = (key: string, member_key: string, new_value: number): Change => ({
  target: 'variable',
  key,
  member_key,
  op: 'set',
  new_value,
});
const draft = (
  origin: ChangesetOrigin,
  scenario_id: ScenarioId,
  base: number,
  ...changes: Change[]
): ChangesetDraft => ({ origin, scenario_id, base_scenario_version: base, changes });

/** The resolved inputs of a scenario in the store, as `cell -> value`. */
function resolved(store: MemoryChangesetStore, id: ScenarioId): Map<string, number> {
  const s = store.inputs(id);
  const r = resolveInputs(s.defaults, s.chain, s.overrides, {
    variables: fx.bundle.variables.map((v) => v.id),
  });
  return new Map(r.values.map((v) => [`${v.var_key}[${v.member_key}]`, v.value]));
}
/** A scenario's own scenario_value cells. */
const ownCells = (store: MemoryChangesetStore, id: ScenarioId): string[] =>
  store
    .inputs(id)
    .chain.at(-1)!
    .values.map((r) => `${r.var_key}[${r.member_key}]`)
    .sort();

async function rejection<E extends Error>(p: Promise<unknown>): Promise<E> {
  try {
    await p;
  } catch (e) {
    return e as E;
  }
  throw new Error('expected a rejection');
}

// ------------------------------------------------------------------------------------------ create

describe('create copy, empty child and blend-from(A, B, λ) drafts', () => {
  it("copy: an unlocked user scenario with the source's parent, own values and pins, written as one changeset that is no edit", async () => {
    const store = aaStore(fx.seed, { pins: true });
    const r = await createScenario(store, { mode: 'copy', from: C }, opts());

    const preset = store.tables.scenarios.get(C)!;
    expect(r.scenario).toEqual<ScenarioRow>({
      id: 'new-1',
      key: 'copy-C',
      label: `Copy of ${preset.label}`,
      kind: 'user',
      parent_id: null,
      model_version_id: MODEL_VERSION,
      version: 1,
      locked: false,
      created_by: ACTOR,
      created_at: T0,
    });
    expect(store.tables.scenarios.get('new-1')).toEqual(r.scenario);
    expect(resolved(store, 'new-1')).toEqual(resolved(store, C));
    expect(store.inputs('new-1').overrides).toEqual(store.inputs(C).overrides);
    expect(ownCells(store, 'new-1')).toEqual(ownCells(store, C));
    expect(preset.version).toBe(1);

    // The values are a changeset of the copy (origin ui by default) that counts no edit.
    expect(r.applied).toMatchObject({
      scenarioId: 'new-1',
      version: 1,
      editsCount: 0,
      replayed: false,
      changeset: { origin: 'ui', base_scenario_version: 0, reverts_id: null },
    });
    const changes = r.applied!.changeset.changes;
    expect(changes).toHaveLength(ownCells(store, C).length + 1);
    expect(changes.at(-1)).toMatchObject({
      target: 'node_override',
      key: 'res.net',
      op: 'insert',
      new_value: 118,
      messages: { note: 'finance view' },
    });
    expect(summaryOf(r.applied!.changeset)).toMatchObject({ edits: 0, edits_count: 0 });
    expect(r.unblended).toEqual([]);
    expect(store.tables.audit.map((a) => a.action)).toEqual(['scenario.create', 'changeset.apply']);
    expect(store.tables.audit[0]).toMatchObject({
      actor: ACTOR,
      entity: 'scenario',
      entity_key: 'new-1',
      before: null,
      after: { key: 'copy-C', mode: 'copy', from: [C] },
    });

    // A second copy takes the next free name.
    const again = await createScenario(store, { mode: 'copy', from: C }, opts());
    expect(again.scenario).toMatchObject({ key: 'copy-C-2', label: `Copy of ${preset.label} 2` });
  });

  it('copy of a child keeps its parent and copies only its own rows, values past a bound included', async () => {
    const store = aaStore(fx.seed);
    const l15 = fx.bundle.variables.find((v) => v.id === 'lev.L15.pct')!;
    const past = l15.max! * 1.25;
    // A solver result keeps a value past its registry max (BOUNDS_POLICY warn).
    await applyChangeset(
      store,
      draft('solver', CUSTOM.id, 0, set('g.target_net', '', 120), set('lev.L15.pct', '', past)),
      applyOpts(),
    );
    const r = await createScenario(
      store,
      { mode: 'copy', from: CUSTOM.id, label: ' Plan ' },
      opts(),
    );
    expect(r.scenario).toMatchObject({ key: 'copy-mine', label: 'Plan', parent_id: C, version: 1 });
    expect(ownCells(store, r.scenario.id)).toEqual(['g.target_net[]', 'lev.L15.pct[]']);
    expect(resolved(store, r.scenario.id)).toEqual(resolved(store, CUSTOM.id));
    // Not clamped, though the changeset's origin is ui: CREATE_BOUNDS_POLICY; VR04 stays a warning.
    expect(resolved(store, r.scenario.id).get('lev.L15.pct[]')).toBe(past);
    expect(r.applied!.clamped).toEqual([]);
    expect(r.applied!.warnings.flatMap((w) => w.cells)).toContain('lev.L15.pct[]');
  });

  it('empty child: inherits every value of its parent, no pins, no changeset; named as the fork of a preset is', async () => {
    const store = aaStore(fx.seed, { pins: true });
    const r = await createScenario(store, { mode: 'child', parent_id: C }, opts());
    expect(r).toEqual({
      scenario: {
        id: 'new-1',
        key: 'custom-C',
        label: 'Custom (from C)',
        kind: 'user',
        parent_id: C,
        model_version_id: MODEL_VERSION,
        version: 0,
        locked: false,
        created_by: ACTOR,
        created_at: T0,
      },
      applied: null,
      unblended: [],
    });
    expect(resolved(store, 'new-1')).toEqual(resolved(store, C));
    expect(store.inputs('new-1').overrides).toEqual([]);
    expect(ownCells(store, 'new-1')).toEqual([]);
    expect(store.methods()).toEqual(['loadScenarios', 'createScenario', 'appendAudit']);

    // Forks and children share the names: the first edit of C now forks Custom (from C) 2.
    const edit = await applyChangeset(
      store,
      draft('ui', C, 1, set('g.target_net', '', 120)),
      applyOpts(),
    );
    expect(store.tables.scenarios.get(edit.scenarioId!)).toMatchObject({
      key: 'custom-C-2',
      label: 'Custom (from C) 2',
    });
    // An edit on the child lands on it: it is not locked.
    const own = await applyChangeset(
      store,
      draft('ui', 'new-1', 0, set('g.target_net', '', 125)),
      applyOpts(),
    );
    expect(own).toMatchObject({ scenarioId: 'new-1', version: 1, editsCount: 1 });
  });

  it('blend-from(C, D, λ): every cell C or D sets is C + λ(D − C); cells both inherit stay inherited', async () => {
    const store = aaStore(fx.seed);
    const lambda = 0.25;
    expect(blendFrom(C, D, lambda)).toEqual({
      mode: 'blend',
      parts: [
        { scenario_id: C, weight: 1 - lambda },
        { scenario_id: D, weight: lambda },
      ],
    });
    const r = await createScenario(store, blendFrom(C, D, lambda), opts());
    expect(r.scenario).toMatchObject({
      key: 'blend-C-D',
      label: 'Blend of C and D',
      kind: 'blend',
      parent_id: null,
      locked: false,
      version: 1,
    });
    const c = resolved(store, C);
    const d = resolved(store, D);
    const blend = resolved(store, r.scenario.id);
    expect([...blend.keys()]).toEqual([...c.keys()]);
    for (const [cell, x] of c) expect(blend.get(cell), cell).toBe(x + lambda * (d.get(cell)! - x));
    expect(ownCells(store, r.scenario.id)).toEqual(
      [...new Set([...ownCells(store, C), ...ownCells(store, D)])].sort(),
    );
    expect(r.applied).toMatchObject({ editsCount: 0, changeset: { origin: 'ui' } });
    expect(store.tables.audit[0]).toMatchObject({
      action: 'scenario.create',
      after: { mode: 'blend', from: [C, D], weights: [1 - lambda, lambda] },
    });

    // λ = 0 is C and λ = 1 is D, exactly; weights 2 : 2 are λ = 0.5.
    const at0 = await createScenario(store, blendFrom(C, D, 0, 'At C'), opts());
    const at1 = await createScenario(store, blendFrom(C, D, 1), opts());
    expect(at0.scenario).toMatchObject({ key: 'blend-C-D-2', label: 'At C' });
    expect(resolved(store, at0.scenario.id)).toEqual(c);
    expect(resolved(store, at1.scenario.id)).toEqual(d);
    const half = await createScenario(store, blendFrom(C, D, 0.5), opts());
    const even = await createScenario(
      store,
      {
        mode: 'blend',
        parts: [
          { scenario_id: C, weight: 2 },
          { scenario_id: D, weight: 2 },
        ],
      },
      opts(),
    );
    expect(resolved(store, even.scenario.id)).toEqual(resolved(store, half.scenario.id));
  });

  it("a blend's parent is the deepest scenario its parts share; pins blend only where every weighted part has one", async () => {
    const store = aaStore(fx.seed, { pins: true });
    await applyChangeset(
      store,
      draft('ui', CUSTOM.id, 0, set('g.target_net', '', 120)),
      applyOpts(),
    );
    const target = resolved(store, C).get('g.target_net[]')!;
    const r = await createScenario(store, blendFrom(C, CUSTOM.id, 0.5), opts());
    expect(r.scenario).toMatchObject({ parent_id: C, label: 'Blend of C and mine' });
    // Only the cell the child sets varies; the rest is inherited from C.
    expect(ownCells(store, r.scenario.id)).toEqual(['g.target_net[]']);
    expect(resolved(store, r.scenario.id).get('g.target_net[]')).toBe(
      target + 0.5 * (120 - target),
    );
    // C pins res.net; the child has no pin there, so the blend cannot carry it.
    expect(r.unblended).toEqual(['res.net[]']);
    expect(store.inputs(r.scenario.id).overrides).toEqual([]);

    // With weight 0 on D, C's pin is the only weighted one: kept, with its reason.
    const onlyC = await createScenario(store, blendFrom(C, D, 0), opts());
    expect(onlyC.unblended).toEqual([]);
    expect(store.inputs(onlyC.scenario.id).overrides).toEqual([
      { node_key: 'res.net', member_key: '', value: 118, reason: 'finance view' },
    ]);
  });

  it('a blend that breaks an input rule is rejected and leaves no scenario; bad specs write nothing', async () => {
    const store = aaStore(fx.seed);
    // The child moves the shared-services owner; halfway, no VP is the owner (VR02).
    await applyChangeset(
      store,
      draft(
        'ui',
        CUSTOM.id,
        0,
        set('org.ss_flag', 'vp_infra', 0),
        set('org.ss_flag', 'vp_operations', 1),
      ),
      applyOpts(),
    );
    const before = structuredClone(store.tables);
    const err = await rejection<ChangesetRejectedError>(
      createScenario(store, blendFrom(C, CUSTOM.id, 0.5), opts()),
    );
    expect(err).toBeInstanceOf(ChangesetRejectedError);
    expect(err.violations.map((v) => v.rule)).toEqual(['VR02']);
    expect(store.tables).toEqual(before);
    expect(store.calls.at(-1)).toBe('rollback');

    store.tables.scenarios.set('sc-old', {
      ...CUSTOM,
      id: 'sc-old',
      key: 'old',
      model_version_id: 'another-model',
    });
    const bad: [() => Promise<unknown>, new (...a: never[]) => Error, RegExp][] = [
      [
        () =>
          createScenario(store, { mode: 'blend', parts: [{ scenario_id: C, weight: 1 }] }, opts()),
        ScenarioOperationError,
        /at least two scenarios, not 1/,
      ],
      [
        () =>
          createScenario(
            store,
            {
              mode: 'blend',
              parts: [
                { scenario_id: C, weight: -1 },
                { scenario_id: D, weight: 2 },
              ],
            },
            opts(),
          ),
        ScenarioOperationError,
        /weight -1 of scenario .* is not a number of 0 or more/,
      ],
      [
        () =>
          createScenario(
            store,
            {
              mode: 'blend',
              parts: [
                { scenario_id: C, weight: 0 },
                { scenario_id: D, weight: 0 },
              ],
            },
            opts(),
          ),
        ScenarioOperationError,
        /weights sum to 0/,
      ],
      [
        () => createScenario(store, blendFrom(C, 'sc-old', 0.5), opts()),
        ScenarioOperationError,
        /different model versions/,
      ],
      [
        () => createScenario(store, blendFrom(C, 'sc-gone', 0.5), opts()),
        ScenarioNotFoundError,
        /sc-gone/,
      ],
      [
        () => createScenario(store, { mode: 'copy', from: 'sc-gone' }, opts()),
        ScenarioNotFoundError,
        /sc-gone/,
      ],
      [
        () => createScenario(store, { mode: 'child', parent_id: C, label: '  ' }, opts()),
        ScenarioOperationError,
        /needs a label/,
      ],
    ];
    for (const [p, E, message] of bad) {
      const e = await rejection(p());
      expect(e).toBeInstanceOf(E);
      expect(e.message).toMatch(message);
    }
    expect(() => blendFrom(C, D, 1.5)).toThrow(ScenarioOperationError);
    expect(() => blendFrom(C, D, Number.NaN)).toThrow(/λ from 0 to 1/);
    expect([...store.tables.scenarios.keys()]).toEqual([...before.scenarios.keys(), 'sc-old']);
  });

  it('kind, origin and the Recompute hook come from the options; names follow scenarioName', async () => {
    const store = aaStore(fx.seed);
    const seen: string[] = [];
    const r = await createScenario(
      store,
      { mode: 'copy', from: C, kind: 'solver' },
      opts({
        origin: 'solver',
        recompute: async ({ scenario }) => {
          seen.push(`${scenario?.key} v${scenario?.version}`);
          return 'computed';
        },
      }),
    );
    expect(r.scenario.kind).toBe('solver');
    expect(r.applied).toMatchObject({ changeset: { origin: 'solver' }, recomputed: 'computed' });
    expect(seen).toEqual(['copy-C v1']);

    // Without newId and now: uuids and the current time, for the scenario, its changeset and audit.
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    const plain = await createScenario(
      store,
      { mode: 'copy', from: C },
      { actor: ACTOR, bundle: fx.bundle },
    );
    expect(plain.scenario.id).toMatch(uuid);
    expect(plain.applied?.changesetId).toMatch(uuid);
    expect(Date.parse(plain.scenario.created_at)).not.toBeNaN();
    await patchScenario(
      store,
      plain.scenario.id,
      { archived: true },
      { actor: ACTOR, role: 'owner' },
    );
    expect(Date.parse(store.tables.audit.at(-1)!.at)).not.toBeNaN();
    expect(
      scenarioName(
        'blend',
        [
          { key: 'A', label: '' },
          { key: 'B', label: '' },
          { key: 'C', label: '' },
        ],
        3,
      ),
    ).toEqual({
      key: 'blend-A-B-C-3',
      label: 'Blend of A, B and C 3',
    });
  });
});

// ------------------------------------------------------------------------------------------ patch

describe('rename, lock, archive; editors cannot unlock presets', () => {
  it('an editor renames, locks, unlocks and archives a user scenario; the key stays; each change is audited', async () => {
    const store = aaStore(fx.seed);
    const renamed = await patchScenario(store, CUSTOM.id, { label: ' Plan B ' }, as('editor'));
    expect(renamed).toMatchObject({ id: CUSTOM.id, key: 'mine', label: 'Plan B', locked: false });
    expect(store.tables.scenarios.get(CUSTOM.id)).toMatchObject({ key: 'mine', label: 'Plan B' });
    expect(store.methods()).toEqual(['loadScenarioForUpdate', 'updateScenario', 'appendAudit']);
    expect(store.tables.audit.at(-1)).toEqual({
      actor: ACTOR,
      action: 'scenario.update',
      entity: 'scenario',
      entity_key: CUSTOM.id,
      before: { label: 'Mine' },
      after: { label: 'Plan B' },
      at: T0,
    });

    // Locked, its next edit forks it, as a preset's does; it keeps its name while locked.
    expect(await patchScenario(store, CUSTOM.id, { locked: true }, as('editor'))).toMatchObject({
      locked: true,
    });
    const edit = await applyChangeset(
      store,
      draft('ui', CUSTOM.id, 0, set('g.target_net', '', 120)),
      applyOpts(),
    );
    expect(edit.forkedFrom).toBe(CUSTOM.id);
    await expect(
      patchScenario(store, CUSTOM.id, { label: 'Plan C' }, as('editor')),
    ).rejects.toThrow(ScenarioOperationError);
    // Unlocking it in the same patch allows the rename; an editor may unlock a user scenario.
    expect(
      await patchScenario(store, CUSTOM.id, { label: 'Plan C', locked: false }, as('editor')),
    ).toMatchObject({ label: 'Plan C', locked: false });

    expect(await patchScenario(store, CUSTOM.id, { archived: true }, as('editor'))).toMatchObject({
      archived: true,
    });
    expect(store.tables.scenarios.get(CUSTOM.id)?.archived).toBe(true);
    expect(store.tables.audit.at(-1)).toMatchObject({
      before: { archived: false },
      after: { archived: true },
    });
    await patchScenario(store, CUSTOM.id, { archived: false }, as('owner'));
    expect(store.tables.scenarios.get(CUSTOM.id)?.archived).toBe(false);

    // A patch that changes nothing writes nothing.
    store.calls.length = 0;
    const same = await patchScenario(
      store,
      CUSTOM.id,
      { label: 'Plan C', archived: false },
      as('editor'),
    );
    expect(same).toEqual(store.tables.scenarios.get(CUSTOM.id));
    expect(store.methods()).toEqual(['loadScenarioForUpdate']);
  });

  it('editors cannot unlock presets, or rename them; owners can; editors may lock and archive them', async () => {
    const store = aaStore(fx.seed);
    const before = structuredClone(store.tables);
    const err = await rejection(patchScenario(store, C, { locked: false }, as('editor')));
    expect(err).toBeInstanceOf(ScenarioPermissionError);
    expect(err.message).toBe(
      'Preset C stays locked: only an owner can unlock a preset. Copy it to change it.',
    );
    await expect(
      patchScenario(store, C, { locked: false, label: 'Mine now' }, as('editor')),
    ).rejects.toThrow(ScenarioPermissionError);
    await expect(patchScenario(store, C, { label: 'Renamed' }, as('editor'))).rejects.toThrow(
      /is locked; unlock it or copy it/,
    );
    expect(store.tables).toEqual(before);

    // An owner unlocks (and renames) the preset; an editor locks it again.
    expect(PRESET_UNLOCK_ROLES).toEqual(['owner']);
    expect(
      await patchScenario(store, C, { locked: false, label: 'C. Ours' }, as('owner')),
    ).toMatchObject({ key: 'C', label: 'C. Ours', locked: false, kind: 'preset' });
    expect(store.tables.audit.at(-1)).toMatchObject({
      before: { label: fx.seed.scenarios.scenarios.find((s) => s.id === 'C')!.label, locked: true },
      after: { label: 'C. Ours', locked: false },
    });
    expect(await patchScenario(store, C, { locked: true }, as('editor'))).toMatchObject({
      locked: true,
    });
    expect(await patchScenario(store, D, { archived: true }, as('editor'))).toMatchObject({
      archived: true,
      locked: true,
    });
  });

  it('viewers and advisors change no scenario; empty patches, empty labels and unknown scenarios are refused', async () => {
    expect([...TENANT_ROLES]).toEqual(enumOf('tenant_membership', 'role'));
    expect(SCENARIO_EDIT_ROLES).toEqual(['owner', 'editor']);
    const store = aaStore(fx.seed);
    for (const role of ['viewer', 'advisor'] as const) {
      await expect(patchScenario(store, CUSTOM.id, { label: 'X' }, as(role))).rejects.toThrow(
        ScenarioPermissionError,
      );
    }
    await expect(patchScenario(store, CUSTOM.id, {}, as('owner'))).rejects.toThrow(
      /Nothing to change/,
    );
    await expect(patchScenario(store, CUSTOM.id, { label: ' ' }, as('owner'))).rejects.toThrow(
      ScenarioOperationError,
    );
    await expect(
      patchScenario(store, 'sc-gone', { locked: true }, { actor: OTHER_USER, role: 'owner' }),
    ).rejects.toThrow(ScenarioNotFoundError);
    expect(store.tables.audit).toEqual([]);
  });
});
