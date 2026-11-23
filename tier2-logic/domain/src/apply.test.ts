import { seedToTenantData } from '@glidepath/spec';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  BOUNDS_POLICY,
  applyChangeset,
  forkName,
  messagesOf,
  noRecompute,
  summaryOf,
  type ApplyOptions,
  type RecomputeInput,
} from './apply';
import {
  ChangesetConflictError,
  ChangesetRejectedError,
  ScenarioNotFoundError,
} from './apply-errors';
import {
  CHANGESET_ORIGINS,
  ChangesetDraftError,
  type Change,
  type ChangesetDraft,
  type ChangesetOrigin,
  type ScenarioId,
  type ValueChange,
} from './changeset';
import { resolveInputs, type ResolvedInputs } from './resolve';
import { reverse } from './reverse';
import { MemoryChangesetStore } from './test-support/memory-store';
import {
  ACTOR,
  CUSTOM,
  MODEL_VERSION,
  OTHER_USER,
  T0,
  aaStore,
  lineItemRow,
  presetId,
  presetRows,
  seedDefaultsDraft,
  seedGlobalMembers,
  seedPresetDraft,
  sequentialIds,
} from './test-support/seed-drafts';
import { loadSeedFixture, type SeedFixture } from './test-support/seed-state';

let fx: SeedFixture;
beforeAll(async () => {
  fx = await loadSeedFixture();
});

const C = presetId('C');

const opts = <R = undefined>(extra: Partial<ApplyOptions<R>> = {}): ApplyOptions<R> => ({
  actor: ACTOR,
  bundle: fx.bundle,
  newId: sequentialIds(),
  now: () => T0,
  ...extra,
});

const set = (key: string, member_key: string, new_value: number, note?: string): ValueChange => ({
  target: 'variable',
  key,
  member_key,
  op: 'set',
  new_value,
  ...(note === undefined ? {} : { note }),
});
const unset = (key: string, member_key: string): ValueChange => ({
  target: 'variable',
  key,
  member_key,
  op: 'unset',
  new_value: null,
});
const pin = (key: string, member_key: string, new_value: number, note?: string): ValueChange => ({
  ...set(key, member_key, new_value, note),
  target: 'override',
});
const draft = (
  origin: ChangesetOrigin,
  scenario_id: ScenarioId | null,
  base: number,
  ...changes: Change[]
): ChangesetDraft => ({ origin, scenario_id, base_scenario_version: base, changes });

/** The resolved inputs of a scenario in the store, as `cell -> value`. */
function resolved(store: MemoryChangesetStore, scenarioId: ScenarioId | null): Map<string, number> {
  const s = store.inputs(scenarioId);
  const r: ResolvedInputs = resolveInputs(s.defaults, s.chain, s.overrides, {
    variables: fx.bundle.variables.map((v) => v.id),
  });
  return new Map(r.values.map((v) => [`${v.var_key}[${v.member_key}]`, v.value]));
}

const WRITES = new Set([
  'createScenario',
  'insertChangeset',
  'setChangesetStatus',
  'writeValue',
  'writeMember',
  'bumpVersion',
  'upsertCalcRun',
  'appendAudit',
]);

async function rejection<E extends Error>(p: Promise<unknown>): Promise<E> {
  try {
    await p;
  } catch (e) {
    return e as E;
  }
  throw new Error('expected a rejection');
}

// ------------------------------------------------------------------------------------------ step 1

describe('baseVersion ≠ scenario.version → Conflict with server version and changes since', () => {
  it('a stale base gets ChangesetConflictError with the server version and the changesets since; nothing is written', async () => {
    const store = aaStore(fx.seed);
    const o = opts();
    const a = await applyChangeset(
      store,
      draft('ui', CUSTOM.id, 0, set('g.target_net', '', 110)),
      o,
    );
    const b = await applyChangeset(store, draft('ui', CUSTOM.id, 1, set('g.head_start', '', 2)), o);
    store.calls.length = 0;
    const before = structuredClone(store.tables);

    const err = await rejection<ChangesetConflictError>(
      applyChangeset(store, draft('ui', CUSTOM.id, 0, set('g.target_net', '', 120)), o),
    );
    expect(err).toBeInstanceOf(ChangesetConflictError);
    expect(err.serverVersion).toBe(2);
    expect(err.changesSince.map((c) => c.id)).toEqual([a.changesetId, b.changesetId]);
    expect(err.changesSince[0]!.changes[0]).toMatchObject({
      target: 'scenario_value',
      key: 'g.target_net',
      old_value: 100,
      new_value: 110,
    });
    expect(err.stale).toEqual([]);
    expect(err.message).toBe(
      'The scenario is at version 2, not 0 (2 changesets since); re-send your edits on version 2.',
    );
    expect(store.tables).toEqual(before);
    expect(store.calls).toEqual(['begin', 'loadScenarioForUpdate', 'changesSince', 'rollback']);

    // A base ahead of the server conflicts too, with nothing since.
    const ahead = await rejection<ChangesetConflictError>(
      applyChangeset(store, draft('ui', CUSTOM.id, 5, set('g.target_net', '', 120)), o),
    );
    expect([ahead.serverVersion, ahead.changesSince]).toEqual([2, []]);
  });

  it('tenant defaults: the version is the count of their changesets; a draft behind or ahead conflicts', async () => {
    const store = aaStore(fx.seed);
    const o = opts();
    const first = await applyChangeset(
      store,
      draft('api', null, 0, set('g.target_net', '', 110)),
      o,
    );
    expect([first.scenarioId, first.version]).toEqual([null, 1]);
    const second = await applyChangeset(
      store,
      draft('api', null, 1, set('g.target_net', '', 115)),
      o,
    );
    expect(second.version).toBe(2);
    expect(store.calls.filter((c) => c === 'lockTenantDefaults')).toHaveLength(2);
    expect(store.methods()).not.toContain('bumpVersion');

    const behind = await rejection<ChangesetConflictError>(
      applyChangeset(store, draft('api', null, 1, set('g.target_net', '', 120)), o),
    );
    expect(behind.serverVersion).toBe(2);
    expect(behind.changesSince.map((c) => c.id)).toEqual([second.changesetId]);
    const ahead = await rejection<ChangesetConflictError>(
      applyChangeset(store, draft('api', null, 7, set('g.target_net', '', 120)), o),
    );
    expect([ahead.serverVersion, ahead.changesSince]).toEqual([2, []]);
  });

  it('a stale old_value conflicts at the current version and names the stale cells', async () => {
    const store = aaStore(fx.seed);
    const err = await rejection<ChangesetConflictError>(
      applyChangeset(
        store,
        draft(
          'excel_import',
          CUSTOM.id,
          0,
          { ...set('g.target_net', '', 120), old_value: 90 },
          {
            target: 'structural',
            key: 'vendor',
            member_key: 'acme',
            op: 'insert',
            old_value: { label: 'Acme' },
            new_value: { label: 'Acme' },
          },
        ),
        opts(),
      ),
    );
    expect(err).toBeInstanceOf(ChangesetConflictError);
    expect(err.serverVersion).toBe(0);
    expect(err.changesSince).toEqual([]);
    expect(err.stale).toEqual([
      { index: 0, cell: 'g.target_net[]', expected: 90, actual: 100 },
      { index: 1, cell: 'vendor[acme]', expected: { label: 'Acme' }, actual: null },
    ]);
    expect(err.message).toBe('g.target_net[] is 100, not 90 (and 1 more); reload and edit again.');
    expect(store.methods().filter((m) => WRITES.has(m))).toEqual([]);
  });

  it('an unknown scenario is ScenarioNotFoundError', async () => {
    const err = await rejection(
      applyChangeset(
        aaStore(fx.seed),
        draft('ui', 'sc-gone', 0, set('g.target_net', '', 1)),
        opts(),
      ),
    );
    expect(err).toBeInstanceOf(ScenarioNotFoundError);
    expect((err as ScenarioNotFoundError).scenarioId).toBe('sc-gone');
  });
});

// ------------------------------------------------------------------------------------------ step 2

describe("locked preset → fork 'Custom (from X)' and retarget the draft; result carries forkedFrom", () => {
  it('the first ui edit on preset C forks Custom (from C) and lands there; the preset is untouched', async () => {
    const store = aaStore(fx.seed);
    const presetBefore = store.tables.scenarios.get(C);
    const valuesOfC = resolved(store, C);
    const r = await applyChangeset(store, draft('ui', C, 1, set('g.target_net', '', 120)), opts());

    expect(r.forkedFrom).toBe(C);
    expect(r.scenarioId).not.toBe(C);
    expect(r).toMatchObject({ version: 1, editsCount: 1, replayed: false });
    expect(store.tables.scenarios.get(r.scenarioId!)).toEqual({
      id: r.scenarioId,
      key: 'custom-C',
      label: 'Custom (from C)',
      kind: 'user',
      parent_id: C,
      model_version_id: MODEL_VERSION,
      version: 1,
      locked: false,
      created_by: ACTOR,
      created_at: T0,
    });
    expect(r.changeset).toMatchObject({
      scenario_id: r.scenarioId,
      base_scenario_version: 0,
      summary: { changes: 1, edits: 1, edits_count: 1, forked_from: C },
    });
    // retargeted: the old value is what the fork inherits from C, the row is the fork's
    expect(r.changeset.changes).toMatchObject([
      { target: 'scenario_value', op: 'insert', old_value: 100, new_value: 120 },
    ]);
    expect(store.tables.scenarios.get(C)).toEqual(presetBefore);
    expect(resolved(store, C)).toEqual(valuesOfC);
    expect(resolved(store, r.scenarioId)).toEqual(new Map([...valuesOfC, ['g.target_net[]', 120]]));
    expect(store.tables.audit.map((a) => [a.action, a.entity_key])).toEqual([
      ['scenario.fork', r.scenarioId],
      ['changeset.apply', r.changesetId],
    ]);
    expect(store.methods()).toEqual([
      'loadScenarioForUpdate',
      'changesSince',
      'loadScenarios',
      'createScenario',
      'appendAudit',
      'loadInputs',
      'loadInputs',
      'loadMembers',
      'insertChangeset',
      'writeValue',
      'bumpVersion',
      'appendAudit',
    ]);
  });

  it('a second fork of C takes the next free name; edits on a fork do not fork again', async () => {
    const store = aaStore(fx.seed);
    const o = opts();
    const first = await applyChangeset(store, draft('ui', C, 1, set('g.target_net', '', 120)), o);
    const again = await applyChangeset(
      store,
      draft('api', first.scenarioId, 1, set('g.head_start', '', 2)),
      o,
    );
    expect(again.scenarioId).toBe(first.scenarioId);
    expect(again.forkedFrom).toBeUndefined();
    expect(again).toMatchObject({ version: 2, editsCount: 2 });

    const second = await applyChangeset(store, draft('ui', C, 1, set('g.target_net', '', 130)), o);
    expect(store.tables.scenarios.get(second.scenarioId!)).toMatchObject({
      key: 'custom-C-2',
      label: 'Custom (from C) 2',
      parent_id: C,
    });
    expect(forkName({ key: 'rates' }, 3)).toEqual({
      key: 'custom-rates-3',
      label: 'Custom (from rates) 3',
    });
  });

  it("the preset's pins are copied to the fork in a changeset of their own, which undoing the first edit keeps", async () => {
    const store = aaStore(fx.seed, { pins: true });
    const o = opts();
    const r = await applyChangeset(store, draft('ui', C, 1, set('g.target_net', '', 120)), o);
    const fork = r.scenarioId!;
    expect(r).toMatchObject({ version: 2, editsCount: 1, forkedFrom: C });
    expect(r.changeset.base_scenario_version).toBe(1);
    const copy = [...store.tables.changesets.values()].find(
      (c) => c.scenario_id === fork && c.base_scenario_version === 0,
    )!;
    expect(copy).toMatchObject({
      origin: 'ui',
      summary: { changes: 1, edits: 0, edits_count: 0, forked_from: C },
      changes: [
        {
          target: 'node_override',
          key: 'res.net',
          op: 'insert',
          old_value: null,
          new_value: 118,
          messages: { note: 'finance view' },
        },
      ],
    });
    expect(store.inputs(fork).overrides).toEqual([
      { node_key: 'res.net', member_key: '', value: 118, reason: 'finance view' },
    ]);

    const undo = await applyChangeset(store, reverse(r.changeset), o);
    expect(undo).toMatchObject({ scenarioId: fork, version: 3, editsCount: 0 });
    expect(store.inputs(fork).overrides).toHaveLength(1);
    expect(resolved(store, fork)).toEqual(resolved(store, C));
  });

  it('only the seed writes a locked preset in place; an undo on a locked preset is refused', async () => {
    const store = aaStore(fx.seed);
    const o = opts();
    const seeded = await applyChangeset(
      store,
      draft('seed', C, 1, set('g.target_net', '', 120)),
      o,
    );
    expect(seeded).toMatchObject({ scenarioId: C, version: 2, editsCount: 0 });
    expect(seeded.forkedFrom).toBeUndefined();
    expect(store.tables.scenarios.get(C)).toMatchObject({ locked: true, version: 2 });

    const undo = await rejection<ChangesetDraftError>(
      applyChangeset(store, { ...reverse(seeded.changeset), origin: 'ui' }, o),
    );
    expect(undo).toBeInstanceOf(ChangesetDraftError);
    expect(undo.message).toMatch(/scenario C is locked; its changesets cannot be undone/);
  });
});

// ------------------------------------------------------------------------------------------ step 3

describe('origin ui clamps to registry min/max; excel_import, ai_reconfig and API origins reject with a VR04 entry', () => {
  it('ui clamps a value past a bound to that bound, writes it, and reports the clamp', async () => {
    const store = aaStore(fx.seed);
    const r = await applyChangeset(
      store,
      draft('ui', CUSTOM.id, 0, set('g.target_net', '', 175), set('g.head_start', '', -2)),
      opts(),
    );
    expect(r.clamped).toEqual([
      { index: 0, cell: 'g.target_net[]', requested: 175, value: 150 },
      { index: 1, cell: 'g.head_start[]', requested: -2, value: 0 },
    ]);
    expect(r.changeset.changes.map((c) => c.new_value)).toEqual([150, 0]);
    expect(resolved(store, CUSTOM.id).get('g.target_net[]')).toBe(150);
    expect(r.warnings.flatMap((w) => w.cells)).not.toContain('g.target_net[]');
  });

  it.each(['excel_import', 'ai_reconfig', 'api'] as const)(
    '%s rejects a value past a bound with that cell’s VR04 entry as an error; nothing is written',
    async (origin) => {
      const store = aaStore(fx.seed);
      const before = structuredClone(store.tables);
      const err = await rejection<ChangesetRejectedError>(
        applyChangeset(store, draft(origin, CUSTOM.id, 0, set('g.target_net', '', 175)), opts()),
      );
      expect(err).toBeInstanceOf(ChangesetRejectedError);
      // Only the draft's own cell: C's lev.L15.pct, already past its max, stays a warning.
      expect(err.violations).toEqual([
        {
          rule: 'VR04',
          severity: 'error',
          cells: ['g.target_net[]'],
          message: expect.stringMatching(
            /is 175, above the maximum 150; keep it within 50 to 150\.$/,
          ),
        },
      ]);
      expect(store.tables).toEqual(before);
      expect(store.methods().filter((m) => WRITES.has(m))).toEqual([]);
    },
  );

  it.each(['seed', 'solver', 'market_refresh'] as const)(
    '%s writes the value as given and keeps VR04 a warning, on the result and the change row',
    async (origin) => {
      const store = aaStore(fx.seed);
      const r = await applyChangeset(
        store,
        draft(origin, CUSTOM.id, 0, set('g.target_net', '', 175)),
        opts(),
      );
      expect(r.clamped).toEqual([]);
      expect(resolved(store, CUSTOM.id).get('g.target_net[]')).toBe(175);
      expect(r.warnings.map((w) => [w.rule, w.severity, w.cells])).toEqual([
        ['VR04', 'warning', ['g.target_net[]']],
        ['VR04', 'warning', ['lev.L15.pct[]']],
      ]);
      expect(messagesOf(r.changeset.changes[0]!).warnings).toEqual([r.warnings[0]]);
    },
  );

  it('every origin has a policy', () => {
    expect(Object.keys(BOUNDS_POLICY).sort()).toEqual([...CHANGESET_ORIGINS].sort());
  });
});

// ------------------------------------------------------------------------------------------ step 4

describe('input rules run on the post-change resolved state; any error → nothing written', () => {
  const share = (vp: string, value: number) =>
    set('org.dom_share', `commercial_applications,${vp}`, value);

  it('a change that breaks VR01 is rejected with the rule entry; no write reaches the store', async () => {
    const store = aaStore(fx.seed);
    const before = structuredClone(store.tables);
    const err = await rejection<ChangesetRejectedError>(
      applyChangeset(store, draft('ui', CUSTOM.id, 0, share('vp_commercial', 0.9)), opts()),
    );
    expect(err).toBeInstanceOf(ChangesetRejectedError);
    expect(err.violations).toEqual([
      expect.objectContaining({
        rule: 'VR01',
        severity: 'error',
        message:
          'Commercial applications ownership sums to 90%; its VP shares must add up to 100%.',
      }),
    ]);
    expect(err.message).toBe(err.violations[0]!.message);
    expect(store.tables).toEqual(before);
    expect(store.calls.at(-1)).toBe('rollback');
    expect(store.methods().filter((m) => WRITES.has(m))).toEqual([]);
  });

  it('rules see the whole post-change state, inherited cells included: moving a share between two VPs passes', async () => {
    const store = aaStore(fx.seed);
    const r = await applyChangeset(
      store,
      draft('ui', CUSTOM.id, 0, share('vp_commercial', 0.6), share('vp_operations', 0.4)),
      opts(),
    );
    expect(r.version).toBe(1);
    expect(
      resolved(store, CUSTOM.id).get('org.dom_share[commercial_applications,vp_operations]'),
    ).toBe(0.4);
  });

  it('rules see structural changes: a new line with an unknown pool breaks VR09; with a known pool it is written', async () => {
    const line = (pool_id: string): Change => ({
      target: 'structural',
      key: 'line',
      member_key: 'it_999',
      op: 'insert',
      new_value: { name: 'New line', pool_id, domain_key: 'commercial_applications', active: true },
    });
    const store = aaStore(fx.seed);
    const err = await rejection<ChangesetRejectedError>(
      applyChangeset(store, draft('excel_import', CUSTOM.id, 0, line('nowhere')), opts()),
    );
    expect(err.violations.map((v) => [v.rule, v.cells])).toEqual([['VR09', ['line[it_999]']]]);
    expect(store.tables.lineItems.size).toBe(0);

    const ok = await applyChangeset(
      store,
      draft('excel_import', CUSTOM.id, 0, line('software')),
      opts(),
    );
    expect(ok.changeset.changes).toMatchObject([
      { target: 'line_item', key: 'line', member_key: 'it_999', op: 'insert', old_value: null },
    ]);
    expect(store.tables.lineItems.get('it_999')).toMatchObject({ pool_id: 'software' });
  });

  it('VR09 checks the vendor key of a line as the database serves it (vendor = vendor_key)', async () => {
    // A copy of a seed line as a line_item row: vendor_text keeps the seed's free text.
    const line = (vendor_key: string): Change => ({
      target: 'structural',
      key: 'line',
      member_key: 'it_999',
      op: 'insert',
      new_value: { ...lineItemRow(fx.seed.dimensionMembers.line![0]!), vendor_key },
    });
    const store = aaStore(fx.seed);
    const err = await rejection<ChangesetRejectedError>(
      applyChangeset(store, draft('ui', CUSTOM.id, 0, line('acme')), opts()),
    );
    expect(err.violations.map((v) => [v.rule, v.cells, v.message])).toEqual([
      [
        'VR09',
        ['line[it_999]'],
        "Line it_999 names vendor 'acme', which does not exist; pick an existing vendor.",
      ],
    ]);
    const ok = await applyChangeset(store, draft('ui', CUSTOM.id, 0, line('ibm')), opts());
    expect(ok.changeset.changes[0]).toMatchObject({ target: 'line_item', op: 'insert' });
  });

  it('values must fit the stored state: known variables, nodes, tenant dims and members; rows to unset or change must exist', async () => {
    const store = aaStore(fx.seed);
    const err = await rejection<ChangesetDraftError>(
      applyChangeset(
        store,
        draft(
          'api',
          CUSTOM.id,
          0,
          set('g.nope', '', 1),
          pin('res.nope', '', 1),
          set('g.target_net', 'x', 1),
          set('org.dom_share', 'commercial_applications,vp_moon', 0),
          unset('g.target_net', ''),
          { ...unset('res.net', ''), target: 'override' },
          { target: 'structural', key: 'pool', member_key: 'p', op: 'insert', new_value: {} },
          { target: 'structural', key: 'vendor', member_key: 'ghost', op: 'set', new_value: {} },
        ),
        opts(),
      ),
    );
    expect(err).toBeInstanceOf(ChangesetDraftError);
    expect(err.issues).toEqual([
      { index: 0, message: 'g.nope[]: the model has no variable g.nope' },
      { index: 1, message: 'res.nope[]: the model has no node res.nope' },
      {
        index: 2,
        message: "g.target_net[x]: g.target_net is scalar; its member key is '' (got 'x')",
      },
      {
        index: 3,
        message: "org.dom_share[commercial_applications,vp_moon]: no vp member 'vp_moon'",
      },
      { index: 4, message: 'g.target_net[]: the scenario sets no value of its own to unset' },
      { index: 5, message: 'res.net[]: the scenario has no pin to remove' },
      { index: 6, message: 'pool[p]: pool is not a tenant dimension' },
      { index: 7, message: 'vendor[ghost]: the member does not exist; insert it first' },
    ]);
    expect(store.methods().filter((m) => WRITES.has(m))).toEqual([]);

    const vendor = { target: 'structural', key: 'vendor', member_key: 'acme' } as const;
    await applyChangeset(
      store,
      draft('api', CUSTOM.id, 0, { ...vendor, op: 'insert', new_value: { label: 'Acme' } }),
      opts(),
    );
    const twice = await rejection<ChangesetDraftError>(
      applyChangeset(
        store,
        draft('api', CUSTOM.id, 1, { ...vendor, op: 'insert', new_value: { label: 'Acme' } }),
        opts(),
      ),
    );
    expect(twice.issues).toEqual([
      { index: 0, message: 'vendor[acme]: the member exists; set it instead' },
    ]);
    await expect(applyChangeset(store, draft('api', CUSTOM.id, 1), opts())).rejects.toThrow(
      'draft: a changeset needs at least one change',
    );
  });
});

// ------------------------------------------------------------------------------------------ step 5

describe('writes changeset + change rows (old, new, var, member, origin, user, note) and upserts through the store inside store.transaction', () => {
  it('in order: changeset with change rows, each row in draft order, version bump, audit, recompute; then commit', async () => {
    const store = aaStore(fx.seed);
    const o = opts<undefined>();
    await applyChangeset(
      store,
      draft(
        'ui',
        CUSTOM.id,
        0,
        set('g.head_start', '', 2),
        pin('res.net', '', 118, 'finance view'),
      ),
      o,
    );
    store.calls.length = 0;
    const recompute = async (): Promise<undefined> => {
      store.calls.push('recompute');
      return undefined;
    };
    const r = await applyChangeset(
      store,
      draft(
        'ui',
        CUSTOM.id,
        1,
        set('g.target_net', '', 120, 'board ask'),
        set('g.head_start', '', 3),
        unset('g.head_start', ''),
        pin('res.net', '', 125),
        {
          target: 'structural',
          key: 'vendor',
          member_key: 'acme',
          op: 'insert',
          new_value: { label: 'Acme', attrs: { preferred: 0 }, sort: 7, active: true },
          note: 'new SI',
        },
      ),
      { ...o, recompute },
    );

    expect(store.calls).toEqual([
      'begin',
      'loadScenarioForUpdate',
      'changesSince',
      'loadInputs',
      'loadMembers',
      'loadMemberRows',
      'insertChangeset',
      'writeValue',
      'writeValue',
      'writeValue',
      'writeValue',
      'writeMember',
      'bumpVersion',
      'appendAudit',
      'recompute',
      'commit',
    ]);
    const id = r.changesetId;
    const row = (seq: number, target: string, key: string, member_key: string) => ({
      changeset_id: id,
      seq,
      target,
      key,
      member_key,
      export_value: null,
      status: 'clean',
    });
    const headStartOfC = resolved(store, C).get('g.head_start[]');
    expect(r.changeset).toEqual({
      id,
      origin: 'ui',
      scenario_id: CUSTOM.id,
      base_scenario_version: 1,
      status: 'applied',
      summary: { changes: 5, edits: 5, edits_count: 7 },
      created_by: ACTOR,
      created_at: T0,
      reverts_id: null,
      changes: [
        {
          ...row(0, 'scenario_value', 'g.target_net', ''),
          op: 'insert',
          old_value: 100,
          new_value: 120,
          messages: { note: 'board ask' },
        },
        {
          ...row(1, 'scenario_value', 'g.head_start', ''),
          op: 'update',
          old_value: 2,
          new_value: 3,
          messages: {},
        },
        {
          ...row(2, 'scenario_value', 'g.head_start', ''),
          op: 'delete',
          old_value: 3,
          new_value: null,
          messages: {},
        },
        {
          ...row(3, 'node_override', 'res.net', ''),
          op: 'update',
          old_value: 118,
          new_value: 125,
          messages: {},
        },
        {
          ...row(4, 'dimension_member', 'vendor', 'acme'),
          op: 'insert',
          old_value: null,
          new_value: { label: 'Acme', attrs: { preferred: 0 }, sort: 7, active: true },
          messages: { note: 'new SI' },
        },
      ],
    });
    expect(store.tables.changesets.get(id)).toEqual(r.changeset);
    expect(store.tables.scenarioValues.get(CUSTOM.id)?.get('g.target_net[]')).toEqual({
      var_key: 'g.target_net',
      member_key: '',
      value: 120,
      changeset_id: id,
    });
    // unset: the scenario's row is gone, the cell inherits C's value again
    expect(store.tables.scenarioValues.get(CUSTOM.id)?.has('g.head_start[]')).toBe(false);
    expect(resolved(store, CUSTOM.id).get('g.head_start[]')).toBe(headStartOfC);
    // an override without a new note keeps the pin's reason
    expect(store.inputs(CUSTOM.id).overrides).toEqual([
      { node_key: 'res.net', member_key: '', value: 125, reason: 'finance view' },
    ]);
    expect(store.members().vendor?.at(-1)).toEqual({ id: 'acme', label: 'Acme', preferred: 0 });
    expect(store.tables.scenarios.get(CUSTOM.id)?.version).toBe(2);
    expect(r).toMatchObject({ scenarioId: CUSTOM.id, version: 2, editsCount: 7 });
    expect(store.tables.audit.at(-1)).toEqual({
      actor: ACTOR,
      action: 'changeset.apply',
      entity: 'changeset',
      entity_key: id,
      before: null,
      after: {
        origin: 'ui',
        scenario_id: CUSTOM.id,
        base_scenario_version: 1,
        version: 2,
        reverts_id: null,
        summary: r.changeset.summary,
      },
      at: T0,
    });
  });

  it('tenant defaults are variable_value rows that keep the note; the actor is the one passed in', async () => {
    const store = aaStore(fx.seed);
    const r = await applyChangeset(
      store,
      draft('market_refresh', null, 0, set('g.target_net', '', 120, 'board target')),
      opts({ actor: OTHER_USER }),
    );
    expect(r.changeset).toMatchObject({
      scenario_id: null,
      created_by: OTHER_USER,
      changes: [
        {
          target: 'variable_value',
          op: 'update',
          old_value: 100,
          new_value: 120,
          messages: { note: 'board target' },
        },
      ],
    });
    expect(store.tables.variableValues.get('g.target_net[]')).toEqual({
      var_key: 'g.target_net',
      member_key: '',
      value: 120,
      note: 'board target',
      changeset_id: r.changesetId,
    });
    expect(store.tables.audit.map((a) => a.actor)).toEqual([OTHER_USER]);
    // every scenario that does not set the cell sees the new default
    expect(resolved(store, C).get('g.target_net[]')).toBe(120);
  });

  it('defaults for ids and times: a uuid and the current time', async () => {
    const store = aaStore(fx.seed);
    const r = await applyChangeset(store, draft('ui', CUSTOM.id, 0, set('g.target_net', '', 120)), {
      actor: ACTOR,
      bundle: fx.bundle,
    });
    expect(r.changesetId).toMatch(/^[0-9a-f-]{36}$/);
    expect(Number.isNaN(Date.parse(r.changeset.created_at))).toBe(false);
  });
});

// ------------------------------------------------------------------------------------------ seed

describe('origin seed loads a full tenant seed', () => {
  it('the seed of docs/spec/seed/aa loads through applyChangeset: members, lines, tenant defaults and the five locked presets, cell for cell', async () => {
    const store = new MemoryChangesetStore({
      globalMembers: seedGlobalMembers(fx.seed, fx.bundle),
    });
    // The preset rows exist (scenario creation is DOM-04); their values come through applyChangeset.
    await store.transaction(async (tx) => {
      for (const row of presetRows(fx.seed, 0)) await tx.createScenario(row);
    });
    const o = opts();
    const defaults = await applyChangeset(store, seedDefaultsDraft(fx.seed, fx.bundle), o);
    expect(defaults).toMatchObject({ scenarioId: null, version: 1, editsCount: 0, clamped: [] });
    // The spec's tenant default for lev.L15.pct is past its registry max: kept, flagged.
    expect(defaults.warnings.flatMap((w) => w.cells)).toEqual(['lev.L15.pct[]']);

    for (const preset of fx.presets) {
      const r = await applyChangeset(store, seedPresetDraft(fx.seed, preset), o);
      expect(r, preset).toMatchObject({ scenarioId: presetId(preset), version: 1, editsCount: 0 });
      expect(r.forkedFrom).toBeUndefined();
      const expected = seedToTenantData(fx.seed, preset, fx.bundle).values;
      const got = new Map(
        [...resolved(store, presetId(preset))].map(([cell, v]) => [cell.replace(/\[\]$/, ''), v]),
      );
      expect(got, preset).toEqual(expected);
    }

    expect([...store.tables.scenarios.values()].map((s) => [s.key, s.locked, s.version])).toEqual(
      fx.presets.map((p) => [p, true, 1]),
    );
    expect([...store.tables.changesets.values()].map((c) => [c.origin, c.scenario_id])).toEqual([
      ['seed', null],
      ...fx.presets.map((p) => ['seed', presetId(p)]),
    ]);

    const members = store.members();
    for (const dim of ['domain', 'vp', 'lever', 'vendor', 'lgroup', 'pool', 'year']) {
      expect(members[dim], dim).toEqual(fx.seed.dimensionMembers[dim]);
    }
    const lines = fx.seed.dimensionMembers.line!;
    expect(members.line).toHaveLength(lines.length);
    expect(members.line![0]).toEqual({
      id: lines[0]!.id,
      label: lines[0]!.name,
      pool: lines[0]!.pool,
      domain: lines[0]!.domain,
      addr: lines[0]!.addr,
      drv: lines[0]!.drv,
      l2: lines[0]!.l2,
      name: lines[0]!.name,
      vendor: null,
      nature: lines[0]!.nature,
      accounting: lines[0]!.accounting,
      in_scope: lines[0]!.in_scope,
      memo: lines[0]!.memo,
      confidence: lines[0]!.confidence,
      legacy_id: lines[0]!.legacy_id,
    });

    // Seeding again on the same versions conflicts instead of duplicating the seed.
    await expect(applyChangeset(store, seedPresetDraft(fx.seed, 'C'), o)).rejects.toBeInstanceOf(
      ChangesetConflictError,
    );
  });
});

// ------------------------------------------------------------------------------------------ step 6

describe('a Recompute hook is called inside the transaction before commit; default no-op until DOM-05', () => {
  it('the hook gets the transaction, the changeset, the bumped scenario and the post-change state; its result is returned', async () => {
    const store = aaStore(fx.seed);
    let seen: RecomputeInput | undefined;
    const r = await applyChangeset(
      store,
      draft('ui', CUSTOM.id, 0, set('g.target_net', '', 120), pin('res.net', '', 99, 'pinned')),
      opts({
        recompute: async (input) => {
          seen = input;
          store.calls.push('recompute');
          await input.tx.upsertCalcRun({
            id: 'run-1',
            scenario_id: input.scenario!.id,
            scenario_version: input.scenario!.version,
            model_version_id: input.scenario!.model_version_id,
            input_hash: 'h',
            ms: 1,
            outputs: {},
            created_at: T0,
          });
          return { inputHash: 'h' };
        },
      }),
    );
    expect(r.recomputed).toEqual({ inputHash: 'h' });
    expect(seen?.changeset).toBe(r.changeset);
    expect(seen?.scenario).toMatchObject({ id: CUSTOM.id, version: 1 });
    expect(seen?.state.values).toContainEqual({
      var_key: 'g.target_net',
      member_key: '',
      value: 120,
      scenario_id: CUSTOM.id,
    });
    expect(seen?.overrides).toEqual([
      { node_key: 'res.net', member_key: '', value: 99, reason: 'pinned' },
    ]);
    expect(store.calls.slice(-5)).toEqual([
      'bumpVersion',
      'appendAudit',
      'recompute',
      'upsertCalcRun',
      'commit',
    ]);
    expect(store.tables.calcRuns).toHaveLength(1);
  });

  it('a hook that throws rolls the whole changeset back', async () => {
    const store = aaStore(fx.seed);
    const before = structuredClone(store.tables);
    const veto = new ChangesetRejectedError([
      { rule: 'VR08', severity: 'error', cells: ['vp.check[]'], message: 'VP nets do not add up.' },
    ]);
    await expect(
      applyChangeset(
        store,
        draft('ui', CUSTOM.id, 0, set('g.target_net', '', 120)),
        opts({
          recompute: () => Promise.reject(veto),
        }),
      ),
    ).rejects.toBe(veto);
    expect(store.calls.slice(-2)).toEqual(['appendAudit', 'rollback']);
    expect(store.tables).toEqual(before);
  });

  it('without a hook, noRecompute runs: nothing happens and recomputed is undefined', async () => {
    const store = aaStore(fx.seed);
    const r = await applyChangeset(
      store,
      draft('ui', CUSTOM.id, 0, set('g.target_net', '', 120)),
      opts(),
    );
    expect(r.recomputed).toBeUndefined();
    expect(store.calls.slice(-3)).toEqual(['bumpVersion', 'appendAudit', 'commit']);
    await expect(noRecompute({} as RecomputeInput)).resolves.toBeUndefined();
  });
});

// ------------------------------------------------------------------------------------------ contract

describe('what tier 2 needs for the contract: clientRequestId, editsCount, forkedFrom', () => {
  it('a retried clientRequestId replays the first result (also after a fork) and applies nothing', async () => {
    const store = aaStore(fx.seed);
    const o = opts({ clientRequestId: 'rq-9' });
    const first = await applyChangeset(store, draft('ui', C, 1, set('g.target_net', '', 120)), o);
    expect(summaryOf(first.changeset).client_request_id).toBe('rq-9');
    store.calls.length = 0;

    const retry = await applyChangeset(store, draft('ui', C, 1, set('g.target_net', '', 120)), o);
    expect(retry).toEqual({
      ...first,
      warnings: retry.warnings,
      clamped: [],
      replayed: true,
      recomputed: undefined,
    });
    expect(store.methods()).toEqual(['loadScenarioForUpdate', 'findChangesetByClientRequest']);
    expect(store.tables.changesets.size).toBe(1);

    // Another user's request with the same id is a new commit (on a new fork).
    const other = await applyChangeset(store, draft('ui', C, 1, set('g.target_net', '', 120)), {
      ...o,
      actor: OTHER_USER,
    });
    expect(other.replayed).toBe(false);
    expect(other.scenarioId).not.toBe(first.scenarioId);
    // The same id on another scenario is refused.
    await expect(
      applyChangeset(store, draft('ui', CUSTOM.id, 0, set('g.target_net', '', 120)), o),
    ).rejects.toThrow(/clientRequestId rq-9 was used for changeset .* on another scenario/);
  });

  it('a replay returns the warnings recorded on the change rows', async () => {
    const store = aaStore(fx.seed);
    const o = opts({ clientRequestId: 'rq-1' });
    const first = await applyChangeset(
      store,
      draft('solver', CUSTOM.id, 0, set('g.target_net', '', 175), set('lev.L15.pct', '', 0.09)),
      o,
    );
    const retry = await applyChangeset(
      store,
      draft('solver', CUSTOM.id, 0, set('g.target_net', '', 175)),
      o,
    );
    expect(retry.warnings).toEqual(first.warnings);
  });

  it('the edits counter counts changes; an undo takes its changeset’s back, a redo adds them again; the seed counts none', async () => {
    const store = aaStore(fx.seed);
    const o = opts();
    const a = await applyChangeset(
      store,
      draft('ui', CUSTOM.id, 0, set('g.target_net', '', 120)),
      o,
    );
    const b = await applyChangeset(
      store,
      draft('ui', CUSTOM.id, 1, set('g.head_start', '', 2), set('g.target_net', '', 125)),
      o,
    );
    expect([a.editsCount, b.editsCount]).toEqual([1, 3]);

    const undo = await applyChangeset(store, reverse(b.changeset), o);
    expect(undo).toMatchObject({ version: 3, editsCount: 1 });
    expect(undo.changeset).toMatchObject({
      reverts_id: b.changesetId,
      summary: { edits: -2, edits_count: 1 },
    });
    expect(store.tables.changesets.get(b.changesetId)?.status).toBe('reverted');
    expect(store.tables.audit.at(-1)).toMatchObject({
      action: 'changeset.revert',
      entity_key: b.changesetId,
      before: { status: 'applied' },
      after: { status: 'reverted', reverted_by: undo.changesetId },
    });
    expect(resolved(store, CUSTOM.id).get('g.target_net[]')).toBe(120);

    const redo = await applyChangeset(store, reverse(undo.changeset), o);
    expect(redo).toMatchObject({ version: 4, editsCount: 3 });
    expect(resolved(store, CUSTOM.id).get('g.target_net[]')).toBe(125);

    const seeded = await applyChangeset(
      store,
      draft('seed', CUSTOM.id, 4, set('g.target_net', '', 130)),
      o,
    );
    expect(seeded.editsCount).toBe(3);
  });

  it('an undo must name an applied changeset of the same scenario', async () => {
    const store = aaStore(fx.seed);
    const o = opts();
    const a = await applyChangeset(
      store,
      draft('ui', CUSTOM.id, 0, set('g.target_net', '', 120)),
      o,
    );
    await applyChangeset(store, reverse(a.changeset), o);
    const cases: [ChangesetDraft, RegExp][] = [
      [{ ...reverse(a.changeset, 2) }, /the changeset is reverted, not applied/],
      [{ ...reverse(a.changeset, 1), scenario_id: C }, /belongs to another scenario/],
      [
        { ...reverse(a.changeset, 2), reverts_id: 'cs-gone' },
        /reverts_id cs-gone: no such changeset/,
      ],
    ];
    for (const [d, message] of cases) {
      await expect(applyChangeset(store, d, o)).rejects.toThrow(message);
    }
  });
});
