import { beforeAll, describe, expect, it } from 'vitest';
import { applyChangeset, type ApplyOptions, type RecomputeInput } from '../apply';
import { ChangesetRejectedError } from '../apply-errors';
import { ChangesetDraftError, type ChangesetDraft, type JsonObject, type StructuralChange } from '../changeset';
import { revert } from '../history';
import { membersHashOf } from '../ports';
import { ACTOR, CUSTOM, T0, aaStore, sequentialIds } from '../test-support/seed-drafts';
import { loadSeedFixture, type SeedFixture } from '../test-support/seed-state';
import { SOURCING_DIMENSIONS, isSourcingDimension, sourcingRowEntries } from './sourcing';

/** SRC-02: structural changes on the data-only sourcing dimensions through applyChangeset. */

let fx: SeedFixture;
beforeAll(async () => {
  fx = await loadSeedFixture();
});

const opts = <R = undefined>(extra: Partial<ApplyOptions<R>> = {}): ApplyOptions<R> => ({
  actor: ACTOR,
  bundle: fx.bundle,
  newId: sequentialIds(),
  now: () => T0,
  ...extra,
});

const param = (value: number, extra: Record<string, unknown> = {}): JsonObject => ({
  label: 'Discount rate',
  attrs: { value, unit: '%', min: 0.04, max: 0.15, step: 0.005, group: 'business_case', ...extra } as JsonObject,
  sort: 1,
  active: true,
});

const change = (op: StructuralChange['op'], new_value: JsonObject | null, key = 'sourcing_param', member_key = 'discount_rate'): StructuralChange => ({
  target: 'structural',
  key,
  member_key,
  op,
  new_value,
});

const defaultsDraft = (base: number, ...changes: StructuralChange[]): ChangesetDraft => ({
  origin: 'api',
  scenario_id: null,
  base_scenario_version: base,
  changes,
});

async function rejection<E extends Error>(p: Promise<unknown>): Promise<E> {
  try {
    await p;
  } catch (e) {
    return e as E;
  }
  throw new Error('expected a rejection');
}

describe('sourcingRowEntries (pure)', () => {
  it('names the three sourcing dimensions; nothing else is one', () => {
    expect(SOURCING_DIMENSIONS).toEqual(['contract', 'benchmark', 'sourcing_param']);
    expect(SOURCING_DIMENSIONS.every(isSourcingDimension)).toBe(true);
    expect(isSourcingDimension('vendor')).toBe(false);
    expect(fx.bundle.dimensions.map((d) => d.id).filter(isSourcingDimension)).toEqual([]);
  });

  it('a sourcing_param inside [min, max] is clean; outside, or with bad bounds or numbers, it is a VR04 error on its cell', () => {
    expect(sourcingRowEntries('sourcing_param', 'discount_rate', param(0.09))).toEqual([]);
    expect(sourcingRowEntries('sourcing_param', 'discount_rate', param(0.04))).toEqual([]);
    expect(sourcingRowEntries('sourcing_param', 'discount_rate', param(0.2))).toEqual([
      {
        rule: 'VR04',
        severity: 'error',
        cells: ['sourcing_param[discount_rate]'],
        message: 'sourcing_param[discount_rate]: value 0.2 is outside [0.04, 0.15]',
      },
    ]);
    expect(sourcingRowEntries('sourcing_param', 'x', param(0.1, { min: 0.2, max: 0.1 }))[0]?.message).toMatch(/min 0.2 is above max 0.1/);
    expect(sourcingRowEntries('sourcing_param', 'x', param(0.1, { step: 0 }))[0]?.message).toMatch(/step 0 must be positive/);
    expect(sourcingRowEntries('sourcing_param', 'x', param(0.1, { value: 'high' }))[0]?.message).toMatch(/value must be finite numbers/);
    expect(sourcingRowEntries('sourcing_param', 'x', { label: 'x', attrs: {} })[0]?.message).toMatch(/value, min, max, step/);
    // contract and benchmark rows carry no range rule
    expect(sourcingRowEntries('contract', 'c', { label: 'c', attrs: {} })).toEqual([]);
  });
});

describe('applyChangeset on the sourcing dimensions', () => {
  it('a structural change on a sourcing_param member commits, is audited and reverts; the engine members are untouched', async () => {
    const store = aaStore(fx.seed);
    const seen: RecomputeInput[] = [];
    const recompute = async (input: RecomputeInput): Promise<undefined> => {
      seen.push(input);
      return undefined;
    };
    const stored = store.members();
    const newId = sequentialIds();

    const inserted = await applyChangeset(store, defaultsDraft(0, change('insert', param(0.09))), opts({ recompute, newId }));
    expect(inserted.changeset.status).toBe('applied');
    expect(store.tables.dimensionMembers.get('sourcing_param')?.get('discount_rate')).toEqual(param(0.09));

    const edited = await applyChangeset(
      store,
      defaultsDraft(1, { ...change('set', { attrs: (param(0.1).attrs as JsonObject) }), old_value: param(0.09) }),
      opts({ recompute, newId }),
    );
    expect(store.tables.dimensionMembers.get('sourcing_param')?.get('discount_rate')?.attrs).toEqual(param(0.1).attrs);
    expect(edited.changeset.changes).toMatchObject([
      { target: 'dimension_member', key: 'sourcing_param', member_key: 'discount_rate', op: 'update', old_value: param(0.09) },
    ]);
    // audited: one entry per changeset
    expect(store.tables.audit.map((a) => a.entity_key)).toEqual([inserted.changesetId, edited.changesetId]);

    // the rules and the recompute hook never see the sourcing members, nor a new members object
    expect(seen).toHaveLength(2);
    for (const s of seen) {
      expect(Object.keys(s.state.members).filter(isSourcingDimension)).toEqual([]);
      expect(membersHashOf(s.state.members)).toBe(membersHashOf(stored));
    }

    const undone = await revert(store, edited.changesetId, opts({ newId }));
    expect(undone.changeset.reverts_id).toBe(edited.changesetId);
    expect(store.tables.dimensionMembers.get('sourcing_param')?.get('discount_rate')).toEqual(param(0.09));
    expect(store.tables.changesets.get(edited.changesetId)?.status).toBe('reverted');
  });

  it('a sourcing_param value outside [min, max] is rejected with a violation, writing nothing (also for the seed origin)', async () => {
    const store = aaStore(fx.seed);
    await applyChangeset(store, defaultsDraft(0, change('insert', param(0.09))), opts());
    const before = structuredClone(store.tables);

    const err = await rejection<ChangesetRejectedError>(
      applyChangeset(store, defaultsDraft(1, change('set', param(0.25))), opts()),
    );
    expect(err).toBeInstanceOf(ChangesetRejectedError);
    expect(err.violations).toEqual([
      expect.objectContaining({ rule: 'VR04', severity: 'error', cells: ['sourcing_param[discount_rate]'] }),
    ]);
    expect(store.tables).toEqual(before);

    // a partial set is checked against the row as stored: new bounds that exclude the kept value fail
    const narrowed = await rejection<ChangesetRejectedError>(
      applyChangeset(store, defaultsDraft(1, change('set', { attrs: { ...(param(0.09).attrs as JsonObject), max: 0.05 } })), opts()),
    );
    expect(narrowed.violations[0]?.message).toMatch(/value 0.09 is outside \[0.04, 0.05\]/);

    const seed = await rejection<ChangesetRejectedError>(
      applyChangeset(store, { ...defaultsDraft(1, change('insert', param(-1), 'sourcing_param', 'other')), origin: 'seed' }, opts()),
    );
    expect(seed).toBeInstanceOf(ChangesetRejectedError);
    expect(store.tables).toEqual(before);
  });

  it('contract and benchmark members insert and change on a scenario draft too; the usual structural checks apply', async () => {
    const store = aaStore(fx.seed);
    const contract = { label: 'Acme MSA', attrs: { vendor_name: 'Acme', lines: ['it_097'], renewal_month: '2027-09' }, sort: 1, active: true };
    await applyChangeset(
      store,
      { origin: 'ui', scenario_id: CUSTOM.id, base_scenario_version: 0, changes: [change('insert', contract, 'contract', 'c_acme')] },
      opts(),
    );
    expect(store.tables.dimensionMembers.get('contract')?.get('c_acme')).toEqual(contract);
    const twice = await rejection<ChangesetDraftError>(
      applyChangeset(
        store,
        { origin: 'ui', scenario_id: CUSTOM.id, base_scenario_version: 1, changes: [change('insert', contract, 'contract', 'c_acme')] },
        opts(),
      ),
    );
    expect(twice.issues).toEqual([{ index: 0, message: 'contract[c_acme]: the member exists; set it instead' }]);
    const ghost = await rejection<ChangesetDraftError>(
      applyChangeset(store, defaultsDraft(0, change('set', { label: 'x' }, 'benchmark', 'b_none')), opts()),
    );
    expect(ghost.issues).toEqual([{ index: 0, message: 'benchmark[b_none]: the member does not exist; insert it first' }]);
    // an unknown dimension is still refused
    const unknown = await rejection<ChangesetDraftError>(
      applyChangeset(store, defaultsDraft(0, change('insert', { label: 'x' }, 'supplier', 's1')), opts()),
    );
    expect(unknown.issues).toEqual([{ index: 0, message: 'supplier[s1]: supplier is not a tenant dimension' }]);
  });
});
