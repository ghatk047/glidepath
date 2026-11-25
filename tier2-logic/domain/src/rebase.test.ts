import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { applyChangeset, type ApplyOptions } from './apply';
import { ChangesetConflictError } from './apply-errors';
import type {
  Change,
  Changeset,
  ChangesetDraft,
  ChangesetOrigin,
  JsonObject,
  ScenarioId,
  StructuralChange,
} from './changeset';
import { revert } from './history';
import { rebase, type RebaseConflict } from './rebase';
import { resolveInputs } from './resolve';
import type { MemoryChangesetStore } from './test-support/memory-store';
import { ACTOR, CUSTOM, OTHER_USER, T0, aaStore, sequentialIds } from './test-support/seed-drafts';
import { loadSeedFixture, type SeedFixture } from './test-support/seed-state';

let fx: SeedFixture;
beforeAll(async () => {
  fx = await loadSeedFixture();
});
let newId: () => string;
beforeEach(() => {
  newId = sequentialIds('cs');
});

/** Ana commits first; Ben's pending edits started from the same version. */
const ana = (): ApplyOptions => ({ actor: OTHER_USER, bundle: fx.bundle, newId, now: () => T0 });
const ben = (): ApplyOptions => ({ actor: ACTOR, bundle: fx.bundle, newId, now: () => T0 });

const set = (key: string, member_key: string, new_value: number, old_value?: number): Change => ({
  target: 'variable',
  key,
  member_key,
  op: 'set',
  new_value,
  ...(old_value === undefined ? {} : { old_value }),
});
const unset = (key: string, member_key: string): Change => ({
  target: 'variable',
  key,
  member_key,
  op: 'unset',
  new_value: null,
});
const vendor = (
  op: StructuralChange['op'],
  new_value: JsonObject | null,
  old_value?: JsonObject | null,
): StructuralChange => ({
  target: 'structural',
  key: 'vendor',
  member_key: 'acme',
  op,
  new_value,
  ...(old_value === undefined ? {} : { old_value }),
});
const draft = (
  origin: ChangesetOrigin,
  scenario_id: ScenarioId | null,
  base: number,
  ...changes: Change[]
): ChangesetDraft => ({ origin, scenario_id, base_scenario_version: base, changes });

function resolved(store: MemoryChangesetStore, id: ScenarioId): Map<string, number> {
  const s = store.inputs(id);
  const r = resolveInputs(s.defaults, s.chain, s.overrides, {
    variables: fx.bundle.variables.map((v) => v.id),
  });
  return new Map(r.values.map((v) => [`${v.var_key}[${v.member_key}]`, v.value]));
}

/** The conflict a commit of `pending` gets, with the changesets since its base. */
async function conflictOf(
  store: MemoryChangesetStore,
  pending: ChangesetDraft,
): Promise<ChangesetConflictError> {
  try {
    await applyChangeset(store, pending, ben());
  } catch (e) {
    if (e instanceof ChangesetConflictError) return e;
    throw e;
  }
  throw new Error('expected a version conflict');
}

describe('rebase(pending, changesSince) retargets pending edits to the new version and reports same-cell conflicts', () => {
  it('the pending edits move to the server version; another cell passes through; the same cell is a conflict the pending value wins', async () => {
    const store = aaStore(fx.seed);
    const start = resolved(store, CUSTOM.id);
    const target = start.get('g.target_net[]')!;
    const head = start.get('g.head_start[]')!;
    const first = await applyChangeset(
      store,
      draft('ui', CUSTOM.id, 0, set('g.target_net', '', 120)),
      ana(),
    );

    const pending = draft(
      'ui',
      CUSTOM.id,
      0,
      set('g.target_net', '', 130, target),
      set('g.head_start', '', head + 1, head),
    );
    const err = await conflictOf(store, pending);
    expect(err.serverVersion).toBe(1);

    const r = rebase(pending, err.changesSince);
    expect(r.version).toBe(1);
    expect(r.draft).toEqual({
      ...pending,
      base_scenario_version: 1,
      // The kept change now starts from Ana's value; the other one is unchanged.
      changes: [set('g.target_net', '', 130, 120), pending.changes[1]],
    });
    expect(r.conflicts).toEqual<RebaseConflict[]>([
      {
        index: 0,
        cell: 'g.target_net[]',
        target: 'variable',
        change: pending.changes[0]!,
        theirs: [
          {
            changeset_id: first.changesetId,
            origin: 'ui',
            created_by: OTHER_USER,
            created_at: T0,
            op: 'insert',
            old_value: target,
            new_value: 120,
          },
        ],
        resolution: 'mine',
      },
    ]);

    const applied = await applyChangeset(store, r.draft!, ben());
    expect(applied).toMatchObject({ version: 2, editsCount: 3 });
    expect(resolved(store, CUSTOM.id).get('g.target_net[]')).toBe(130);
    expect(resolved(store, CUSTOM.id).get('g.head_start[]')).toBe(head + 1);
  });

  it('a change already in effect is dropped (same); a cell changed and changed back is no conflict; nothing left is no draft', async () => {
    const store = aaStore(fx.seed);
    const start = resolved(store, CUSTOM.id);
    const e1 = await applyChangeset(
      store,
      draft('ui', CUSTOM.id, 0, set('g.target_net', '', 120), set('g.head_start', '', 2)),
      ana(),
    );
    await revert(store, e1.changesetId, ana());
    await applyChangeset(store, draft('ui', CUSTOM.id, 2, set('g.head_start', '', 3)), ana());

    const pending = draft(
      'ui',
      CUSTOM.id,
      0,
      set('g.target_net', '', 130, start.get('g.target_net[]')),
      set('g.head_start', '', 3),
    );
    const err = await conflictOf(store, pending);
    const r = rebase(pending, err.changesSince);
    expect(r.version).toBe(3);
    // g.target_net went to 120 and back: its old_value still holds, so it passes through.
    expect(r.draft?.changes).toEqual([pending.changes[0]]);
    expect(r.conflicts.map((c) => [c.index, c.cell, c.resolution, c.theirs.length])).toEqual([
      [1, 'g.head_start[]', 'same', 3],
    ]);
    expect(rebase({ ...pending, changes: [set('g.head_start', '', 3)] }, err.changesSince)).toEqual(
      {
        draft: null,
        version: 3,
        conflicts: [expect.objectContaining({ resolution: 'same' })],
      },
    );

    // An unset of a row they already removed is in effect too; a set of it has no old value to give.
    const own = await applyChangeset(
      store,
      draft('ui', CUSTOM.id, 3, unset('g.head_start', '')),
      ana(),
    );
    const late = rebase(
      draft('ui', CUSTOM.id, 3, unset('g.head_start', ''), set('g.head_start', '', 4, 3)),
      [own.changeset],
    );
    expect(late.draft?.changes).toEqual([set('g.head_start', '', 4)]);
    expect(late.conflicts.map((c) => c.resolution)).toEqual(['same', 'mine']);
    expect((await applyChangeset(store, late.draft!, ben())).version).toBe(5);
  });

  it('structural rows: an insert of a member they added becomes a set of their row; a delete of one they deleted is dropped', async () => {
    const store = aaStore(fx.seed);
    const theirs = { label: 'Acme', attrs: { preferred: 1 }, sort: 7, active: true };
    const mine = { label: 'Acme Corp', attrs: { preferred: 0 }, sort: 7, active: true };
    const added = await applyChangeset(
      store,
      draft('ui', CUSTOM.id, 0, vendor('insert', theirs)),
      ana(),
    );
    const pending = draft('ui', CUSTOM.id, 0, vendor('insert', mine, null));
    const r = rebase(pending, [added.changeset]);
    expect(r.draft?.changes).toEqual([vendor('set', mine, theirs)]);
    expect(r.conflicts).toMatchObject([{ index: 0, cell: 'vendor[acme]', target: 'structural' }]);
    await applyChangeset(store, r.draft!, ben());
    expect(store.tables.dimensionMembers.get('vendor')?.get('acme')).toEqual(mine);

    // Ana deletes it while Ben's delete is pending: already in effect. A set of it becomes an insert.
    const gone = await applyChangeset(
      store,
      draft('ui', CUSTOM.id, 2, vendor('delete', null)),
      ana(),
    );
    expect(
      rebase(draft('ui', CUSTOM.id, 2, vendor('delete', null)), [gone.changeset]),
    ).toMatchObject({
      draft: null,
      conflicts: [{ resolution: 'same' }],
    });
    const back = rebase(draft('ui', CUSTOM.id, 2, vendor('set', theirs, mine)), [gone.changeset]);
    expect(back.draft?.changes).toEqual([vendor('insert', theirs, null)]);
    expect((await applyChangeset(store, back.draft!, ben())).version).toBe(4);
  });

  it('pins: the pending pin wins over theirs and starts from their value; rejected rows of theirs are ignored', () => {
    const pin = (new_value: number | null, old_value?: number | null): Change => ({
      target: 'override',
      key: 'res.net',
      member_key: '',
      op: new_value === null ? 'unset' : 'set',
      new_value,
      ...(old_value === undefined ? {} : { old_value }),
    });
    const cs = (id: string, base: number, rows: Changeset['changes']): Changeset => ({
      id,
      origin: 'excel_import',
      scenario_id: CUSTOM.id,
      base_scenario_version: base,
      status: 'applied',
      summary: {},
      created_by: OTHER_USER,
      created_at: T0,
      reverts_id: null,
      changes: rows,
    });
    const row = (
      changeset_id: string,
      op: 'insert' | 'update' | 'delete',
      old_value: number | null,
      new_value: number | null,
      status: 'clean' | 'rejected' = 'clean',
    ): Changeset['changes'][number] => ({
      changeset_id,
      seq: 0,
      target: 'node_override',
      key: 'res.net',
      member_key: '',
      op,
      old_value,
      new_value,
      export_value: null,
      status,
      messages: {},
    });
    const since = [
      cs('a', 4, [row('a', 'insert', null, 118)]),
      cs('b', 5, [row('b', 'update', 118, 90, 'rejected')]),
    ];
    const r = rebase(draft('ui', CUSTOM.id, 4, pin(120, null)), since);
    expect(r.version).toBe(6);
    expect(r.draft?.changes).toEqual([pin(120, 118)]);
    expect(r.conflicts[0]?.theirs.map((t) => t.changeset_id)).toEqual(['a']);
    // Their pin removed: the pending one starts from no pin (null), which an override can say.
    const removed = [cs('c', 4, [row('c', 'delete', 118, null)])];
    expect(rebase(draft('ui', CUSTOM.id, 4, pin(120, 118)), removed).draft?.changes).toEqual([
      pin(120, null),
    ]);
  });

  it('refuses a history that is not the one since the pending base of its scenario', () => {
    const at = (id: string, scenario_id: ScenarioId | null, base: number): Changeset => ({
      id,
      origin: 'ui',
      scenario_id,
      base_scenario_version: base,
      status: 'applied',
      summary: {},
      created_by: OTHER_USER,
      created_at: T0,
      reverts_id: null,
      changes: [],
    });
    const pending = draft('ui', CUSTOM.id, 2, set('g.target_net', '', 130));
    expect(rebase(pending, [])).toEqual({ draft: pending, version: 2, conflicts: [] });
    expect(rebase(pending, [at('x', CUSTOM.id, 2), at('y', CUSTOM.id, 3)]).version).toBe(4);
    expect(() => rebase(pending, [at('x', 'sc-other', 2)])).toThrow(/changeset x is not/);
    expect(() => rebase(pending, [at('x', CUSTOM.id, 3)])).toThrow(/from version 2 on/);
    expect(() => rebase(pending, [at('y', CUSTOM.id, 3), at('x', CUSTOM.id, 2)])).toThrow(
      /oldest first/,
    );
  });
});
