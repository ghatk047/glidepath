import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { UNDO_BOUNDS_POLICY, applyChangeset, type ApplyOptions } from './apply';
import { ChangesetConflictError, ChangesetNotFoundError } from './apply-errors';
import {
  ChangesetDraftError,
  type Change,
  type Changeset,
  type ChangesetDraft,
  type ChangesetOrigin,
  type ScenarioId,
} from './changeset';
import { revert, undoRedo, type UndoRedo } from './history';
import { resolveInputs } from './resolve';
import { createScenario } from './scenario';
import { reverse } from './reverse';
import type { MemoryChangesetStore } from './test-support/memory-store';
import { ACTOR, CUSTOM, T0, aaStore, presetId, sequentialIds } from './test-support/seed-drafts';
import { loadSeedFixture, type SeedFixture } from './test-support/seed-state';

let fx: SeedFixture;
beforeAll(async () => {
  fx = await loadSeedFixture();
});
let newId: () => string;
beforeEach(() => {
  newId = sequentialIds('cs');
});

const C = presetId('C');
const opts = (extra: Partial<ApplyOptions> = {}): ApplyOptions => ({
  actor: ACTOR,
  bundle: fx.bundle,
  newId,
  now: () => T0,
  ...extra,
});
const set = (key: string, member_key: string, new_value: number): Change => ({
  target: 'variable',
  key,
  member_key,
  op: 'set',
  new_value,
});
const draft = (
  origin: ChangesetOrigin,
  scenario_id: ScenarioId | null,
  base: number,
  ...changes: Change[]
): ChangesetDraft => ({ origin, scenario_id, base_scenario_version: base, changes });

function resolved(store: MemoryChangesetStore, id: ScenarioId | null): Map<string, number> {
  const s = store.inputs(id);
  const r = resolveInputs(s.defaults, s.chain, s.overrides, {
    variables: fx.bundle.variables.map((v) => v.id),
  });
  return new Map(r.values.map((v) => [`${v.var_key}[${v.member_key}]`, v.value]));
}
const history = (
  store: MemoryChangesetStore,
  id: ScenarioId | null,
): Promise<readonly Changeset[]> => store.transaction((tx) => tx.changesSince(id, 0));

async function rejection<E extends Error>(p: Promise<unknown>): Promise<E> {
  try {
    await p;
  } catch (e) {
    return e as E;
  }
  throw new Error('expected a rejection');
}

describe('undo = applyChangeset(reverse(cs)) keeping origin with reverts link; redo = revert of the revert', () => {
  it('revert(cs) is applyChangeset(reverse(cs)) at the current version: same origin, reverts_id, cs reverted, values back', async () => {
    const edit = draft(
      'excel_import',
      CUSTOM.id,
      0,
      set('g.target_net', '', 120),
      set('g.head_start', '', 2),
    );
    const store = aaStore(fx.seed);
    const twin = aaStore(fx.seed);
    const before = resolved(store, CUSTOM.id);
    const e = await applyChangeset(store, edit, opts());
    const after = resolved(store, CUSTOM.id);
    expect(e.editsCount).toBe(2);

    const undo = await revert(store, e.changesetId, opts());
    // The same changeset applyChangeset(reverse(cs)) writes (ids from the same sequence).
    const twinIds = sequentialIds('cs');
    const te = await applyChangeset(twin, edit, opts({ newId: twinIds }));
    const twinUndo = await applyChangeset(twin, reverse(te.changeset), opts({ newId: twinIds }));
    expect(undo).toEqual(twinUndo);
    expect(undo.changeset).toMatchObject({
      origin: 'excel_import',
      reverts_id: e.changesetId,
      base_scenario_version: 1,
      summary: { edits: -2, edits_count: 0 },
    });
    expect(undo.changeset.changes.map((c) => [c.key, c.op])).toEqual([
      ['g.head_start', 'delete'],
      ['g.target_net', 'delete'],
    ]);
    expect(undo).toMatchObject({ version: 2, editsCount: 0 });
    expect(store.tables.changesets.get(e.changesetId)?.status).toBe('reverted');
    expect(resolved(store, CUSTOM.id)).toEqual(before);
    expect(store.tables.audit.at(-1)).toMatchObject({
      action: 'changeset.revert',
      entity_key: e.changesetId,
      after: { status: 'reverted', reverted_by: undo.changesetId },
    });

    // Redo is the revert of the undo: the edit's values and edits come back.
    const redo = await revert(store, undo.changesetId, opts());
    expect(redo.changeset).toMatchObject({ origin: 'excel_import', reverts_id: undo.changesetId });
    expect(redo).toMatchObject({ version: 3, editsCount: 2 });
    expect(store.tables.changesets.get(undo.changesetId)?.status).toBe('reverted');
    expect(resolved(store, CUSTOM.id)).toEqual(after);

    // And the redo undoes like any edit.
    const again = await revert(store, redo.changesetId, opts());
    expect(again).toMatchObject({ version: 4, editsCount: 0 });
    expect(resolved(store, CUSTOM.id)).toEqual(before);
  });

  it('undoRedo gives the tray its count and targets: an edit is pushed, undo moves it to redo, redo back; a new edit clears redo', async () => {
    const store = aaStore(fx.seed);
    const state = async (): Promise<UndoRedo> => undoRedo(await history(store, CUSTOM.id));
    expect(await state()).toEqual({
      editsCount: 0,
      canUndo: false,
      canRedo: false,
      undo: null,
      redo: null,
    });
    const e1 = await applyChangeset(
      store,
      draft('ui', CUSTOM.id, 0, set('g.target_net', '', 120)),
      opts(),
    );
    const e2 = await applyChangeset(
      store,
      draft('ui', CUSTOM.id, 1, set('g.head_start', '', 2), set('g.target_net', '', 125)),
      opts(),
    );
    expect(await state()).toEqual({
      editsCount: 3,
      canUndo: true,
      canRedo: false,
      undo: e2.changesetId,
      redo: null,
    });

    const u2 = await revert(store, (await state()).undo!, opts());
    expect(await state()).toMatchObject({
      editsCount: 1,
      undo: e1.changesetId,
      redo: u2.changesetId,
    });
    const u1 = await revert(store, (await state()).undo!, opts());
    expect(await state()).toEqual({
      editsCount: 0,
      canUndo: false,
      canRedo: true,
      undo: null,
      redo: u1.changesetId,
    });
    const r1 = await revert(store, (await state()).redo!, opts());
    expect(r1.changeset.reverts_id).toBe(u1.changesetId);
    expect(await state()).toMatchObject({
      editsCount: 1,
      undo: r1.changesetId,
      redo: u2.changesetId,
    });
    expect(resolved(store, CUSTOM.id).get('g.target_net[]')).toBe(120);

    const e3 = await applyChangeset(
      store,
      draft('ui', CUSTOM.id, 5, set('g.head_start', '', 3)),
      opts(),
    );
    expect(await state()).toEqual({
      editsCount: 2,
      canUndo: true,
      canRedo: false,
      undo: e3.changesetId,
      redo: null,
    });
    // Changesets that were never applied are not history.
    expect(
      undoRedo([
        ...(await history(store, CUSTOM.id)),
        { ...e3.changeset, id: 'x', status: 'rejected' },
      ]),
    ).toEqual(await state());
  });

  it("a fork's copy of the preset's pins and a new scenario's first values are no edits to undo", async () => {
    const store = aaStore(fx.seed, { pins: true });
    const edit = await applyChangeset(
      store,
      draft('ui', C, 1, set('g.target_net', '', 120)),
      opts(),
    );
    const fork = edit.scenarioId!;
    expect((await history(store, fork)).map((c) => c.base_scenario_version)).toEqual([0, 1]);
    expect(undoRedo(await history(store, fork))).toMatchObject({
      editsCount: 1,
      undo: edit.changesetId,
    });
    const undo = await revert(store, edit.changesetId, opts());
    expect(undoRedo(await history(store, fork))).toEqual({
      editsCount: 0,
      canUndo: false,
      canRedo: true,
      undo: null,
      redo: undo.changesetId,
    });
    expect(store.inputs(fork).overrides).toHaveLength(1);

    const copy = await createScenario(store, { mode: 'copy', from: fork }, opts());
    expect(copy.applied?.changeset.changes).toHaveLength(1);
    expect(undoRedo(await history(store, copy.scenario.id))).toEqual({
      editsCount: 0,
      canUndo: false,
      canRedo: false,
      undo: null,
      redo: null,
    });
  });

  it('an undo restores a value as it was, also past a registry bound (UNDO_BOUNDS_POLICY), whatever its origin', async () => {
    expect(UNDO_BOUNDS_POLICY).toBe('warn');
    const store = aaStore(fx.seed);
    const max = fx.bundle.variables.find((v) => v.id === 'lev.L15.pct')!.max!;
    const past = max * 1.25;
    await applyChangeset(
      store,
      draft('solver', CUSTOM.id, 0, set('lev.L15.pct', '', past)),
      opts(),
    );
    const edit = await applyChangeset(
      store,
      draft('api', CUSTOM.id, 1, set('lev.L15.pct', '', max / 2)),
      opts(),
    );
    // An api undo would reject the value and a ui undo would clamp it; the undo restores it.
    const undo = await revert(store, edit.changesetId, opts());
    expect(undo.changeset.origin).toBe('api');
    expect(undo.clamped).toEqual([]);
    expect(resolved(store, CUSTOM.id).get('lev.L15.pct[]')).toBe(past);
    expect(undo.warnings.map((w) => [w.rule, w.cells])).toContainEqual(['VR04', ['lev.L15.pct[]']]);
  });

  it('tenant defaults undo at their changeset count', async () => {
    const store = aaStore(fx.seed);
    const before = resolved(store, null).get('g.target_net[]');
    const e = await applyChangeset(
      store,
      draft('api', null, 0, set('g.target_net', '', 110)),
      opts(),
    );
    const undo = await revert(store, e.changesetId, opts());
    expect(undo).toMatchObject({
      scenarioId: null,
      version: 2,
      changeset: { base_scenario_version: 1 },
    });
    expect(resolved(store, null).get('g.target_net[]')).toBe(before);
  });

  it('revert refuses what cannot be undone, and a retried request replays the first undo', async () => {
    const store = aaStore(fx.seed);
    const e1 = await applyChangeset(
      store,
      draft('ui', CUSTOM.id, 0, set('g.target_net', '', 120)),
      opts(),
    );
    const e2 = await applyChangeset(
      store,
      draft('ui', CUSTOM.id, 1, set('g.target_net', '', 125)),
      opts(),
    );

    await expect(revert(store, 'cs-gone', opts())).rejects.toBeInstanceOf(ChangesetNotFoundError);
    // A later changeset changed the cell the undo would restore: a conflict naming the stale cell.
    const stale = await rejection<ChangesetConflictError>(revert(store, e1.changesetId, opts()));
    expect(stale).toBeInstanceOf(ChangesetConflictError);
    expect(stale.stale).toEqual([{ index: 0, cell: 'g.target_net[]', expected: 120, actual: 125 }]);

    const o = opts({ clientRequestId: 'rq-undo' });
    const undo = await revert(store, e2.changesetId, o);
    const retry = await revert(store, e2.changesetId, o);
    expect(retry).toMatchObject({ replayed: true, changesetId: undo.changesetId, version: 3 });
    await expect(revert(store, e1.changesetId, o)).rejects.toThrow(
      /clientRequestId rq-undo was used for changeset .*, which does not revert/,
    );
    const again = await rejection<ChangesetDraftError>(revert(store, e2.changesetId, opts()));
    expect(again).toBeInstanceOf(ChangesetDraftError);
    expect(again.message).toMatch(
      /is reverted, not applied; only an applied changeset can be undone/,
    );

    // A seed changeset on a locked preset is no user's to undo.
    const seeded = await applyChangeset(
      store,
      draft('seed', C, 1, set('g.target_net', '', 130)),
      opts(),
    );
    await expect(revert(store, seeded.changesetId, opts())).rejects.toThrow(/is locked/);
    // Nor is a changeset whose scenario is gone.
    store.tables.scenarios.delete(CUSTOM.id);
    await expect(revert(store, e1.changesetId, opts())).rejects.toThrow(/does not exist/);
  });
});
