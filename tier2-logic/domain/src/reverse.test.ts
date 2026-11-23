import { describe, expect, it } from 'vitest';
import {
  changeRowTarget,
  type Change,
  type ChangeRow,
  type ChangeRowOp,
  type Changeset,
  type ChangesetDraft,
  type JsonValue,
} from './changeset';
import { reverse } from './reverse';

const SCENARIO = '00000000-0000-4000-8000-0000000000a2';
const USER = '00000000-0000-4000-8000-0000000000e1';

function row(
  seq: number,
  partial: Pick<ChangeRow, 'target' | 'key' | 'member_key' | 'op' | 'old_value' | 'new_value'> &
    Partial<ChangeRow>,
): ChangeRow {
  return {
    changeset_id: 'cs-1',
    seq,
    export_value: null,
    status: 'clean',
    messages: [],
    ...partial,
  };
}

const applied: Changeset = {
  id: 'cs-1',
  origin: 'excel_import',
  scenario_id: SCENARIO,
  base_scenario_version: 7,
  status: 'applied',
  summary: { changes: 7 },
  created_by: USER,
  created_at: '2026-11-23T10:00:00.000Z',
  reverts_id: null,
  // seq order is deliberately not array order
  changes: [
    // first edit of an inherited cell: old_value is the inherited value, the row is inserted
    row(2, {
      target: 'scenario_value',
      key: 'lev.L05.nb',
      member_key: '',
      op: 'insert',
      old_value: 0.3,
      new_value: 0.4,
    }),
    row(1, {
      target: 'dimension_member',
      key: 'vp',
      member_key: 'vp_new',
      op: 'insert',
      old_value: null,
      new_value: { label: 'New VP', sort: 5 },
    }),
    row(3, {
      target: 'scenario_value',
      key: 'corp.lab_hc_g',
      member_key: 'pilots,fy27',
      op: 'update',
      old_value: 2,
      new_value: 4,
    }),
    row(4, {
      target: 'scenario_value',
      key: 'lev.start',
      member_key: 'L09',
      op: 'delete',
      old_value: 9,
      new_value: null,
    }),
    row(5, {
      target: 'node_override',
      key: 'base.pool_outlay',
      member_key: 'si_contingent',
      op: 'insert',
      old_value: null,
      new_value: 118,
    }),
    row(6, {
      target: 'line_item',
      key: 'line',
      member_key: 'it_001',
      op: 'update',
      old_value: { name: 'Old' },
      new_value: { name: 'New' },
    }),
    row(7, {
      target: 'dimension_member',
      key: 'vendor',
      member_key: 'v_old',
      op: 'delete',
      old_value: { label: 'Gone' },
      new_value: null,
    }),
    // rejected in the import review: never applied, so never undone
    row(8, {
      target: 'scenario_value',
      key: 'g.target_net',
      member_key: '',
      op: 'update',
      old_value: 110,
      new_value: 150,
      status: 'rejected',
    }),
  ],
};

describe('reverse(changeset) builds the undo draft with reverts_id', () => {
  it('links the undo to the changeset, keeps origin and scenario, and inverts every applied change in reverse order', () => {
    const undo = reverse(applied);
    expect(undo).toEqual<ChangesetDraft>({
      origin: 'excel_import',
      scenario_id: SCENARIO,
      base_scenario_version: 8,
      reverts_id: 'cs-1',
      changes: [
        {
          target: 'structural',
          key: 'vendor',
          member_key: 'v_old',
          op: 'insert',
          old_value: null,
          new_value: { label: 'Gone' },
        },
        {
          target: 'structural',
          key: 'line',
          member_key: 'it_001',
          op: 'set',
          old_value: { name: 'New' },
          new_value: { name: 'Old' },
        },
        {
          target: 'override',
          key: 'base.pool_outlay',
          member_key: 'si_contingent',
          op: 'unset',
          old_value: 118,
          new_value: null,
        },
        // the row was deleted, so the cell now resolves to whatever it inherits: not known here
        { target: 'variable', key: 'lev.start', member_key: 'L09', op: 'set', new_value: 9 },
        {
          target: 'variable',
          key: 'corp.lab_hc_g',
          member_key: 'pilots,fy27',
          op: 'set',
          old_value: 4,
          new_value: 2,
        },
        // undoing an insert removes the row, so the cell inherits again (not "set 0.3")
        {
          target: 'variable',
          key: 'lev.L05.nb',
          member_key: '',
          op: 'unset',
          old_value: 0.4,
          new_value: null,
        },
        {
          target: 'structural',
          key: 'vp',
          member_key: 'vp_new',
          op: 'delete',
          old_value: { label: 'New VP', sort: 5 },
          new_value: null,
        },
      ],
    });
  });

  it('takes the base version to undo from (default: the version this changeset produced)', () => {
    expect(reverse(applied, 12).base_scenario_version).toBe(12);
    expect(reverse({ ...applied, scenario_id: null, changes: [] })).toMatchObject({
      scenario_id: null,
      changes: [],
    });
  });

  it('only an applied changeset can be reversed', () => {
    for (const status of ['pending', 'rejected', 'reverted'] as const) {
      expect(() => reverse({ ...applied, status })).toThrow(new RegExp(`cs-1.*${status}`));
    }
  });

  it('rejects stored values of the wrong shape', () => {
    const bad = (r: ChangeRow): Changeset => ({ ...applied, changes: [r] });
    expect(() =>
      reverse(
        bad(
          row(1, {
            target: 'scenario_value',
            key: 'g.target_net',
            member_key: '',
            op: 'update',
            old_value: 'x',
            new_value: 1,
          }),
        ),
      ),
    ).toThrow(/g\.target_net.*number/);
    expect(() =>
      reverse(
        bad(
          row(1, {
            target: 'line_item',
            key: 'line',
            member_key: 'it_1',
            op: 'insert',
            old_value: null,
            new_value: 3,
          }),
        ),
      ),
    ).toThrow(/it_1.*object/);
    expect(() =>
      reverse(
        bad(
          row(1, {
            target: 'line_item',
            key: 'line',
            member_key: 'it_1',
            op: 'insert',
            old_value: null,
            new_value: [],
          }),
        ),
      ),
    ).toThrow(/object/);
  });
});

// ---------------------------------------------------------------------------------------------
// Round trip through a minimal applier: the row-level semantics applyChangeset (DOM-03) will have.
// `old_value` is the cell's value before the change as resolved at the base version: its own row at
// this level, else what it inherits from the levels below (here a fixed map), with earlier changes of
// the changeset applied.

type State = ReadonlyMap<string, JsonValue>;
const cellOf = (scenario: string | null, c: Pick<Change, 'target' | 'key' | 'member_key'>) =>
  `${changeRowTarget(c, scenario)}|${c.key}|${c.member_key}`;

/** Values the scenario's cells inherit from its ancestors and the tenant defaults. */
const inherited: ReadonlyMap<string, number> = new Map([
  ['scenario_value|lev.L05.nb|', 0.3],
  ['scenario_value|lev.start|L09', 7],
  ['scenario_value|corp.lab_hc_g|pilots,fy27', 1],
]);

let nextId = 0;
function apply(draft: ChangesetDraft, state: State): { applied: Changeset; state: State } {
  const next = new Map(state);
  const id = `cs-${++nextId}`;
  const rows: ChangeRow[] = [];
  for (const c of draft.changes) {
    const cell = cellOf(draft.scenario_id, c);
    const exists = next.has(cell);
    const own = next.get(cell) ?? null;
    const cur = exists || c.target === 'structural' ? own : (inherited.get(cell) ?? null);
    if (c.old_value !== undefined)
      expect(cur, `expected old value of ${cell}`).toEqual(c.old_value);
    let op: ChangeRowOp | null;
    if (c.op === 'set') op = exists ? 'update' : 'insert';
    else if (c.op === 'unset') op = exists ? 'delete' : null;
    else {
      expect(exists, `${c.op} ${cell}`).toBe(c.op === 'delete');
      op = c.op;
    }
    if (op === null) continue;
    if (c.new_value === null) next.delete(cell);
    else next.set(cell, c.new_value);
    const target = changeRowTarget(c, draft.scenario_id);
    rows.push({
      changeset_id: id,
      seq: rows.length + 1,
      target,
      key: c.key,
      member_key: c.member_key,
      op,
      old_value: cur,
      new_value: c.new_value,
      export_value: null,
      status: 'clean',
      messages: [],
    });
  }
  const changeset: Changeset = {
    id,
    origin: draft.origin,
    scenario_id: draft.scenario_id,
    base_scenario_version: draft.base_scenario_version,
    status: 'applied',
    summary: {},
    created_by: USER,
    created_at: '2026-11-23T10:00:00.000Z',
    reverts_id: draft.reverts_id ?? null,
    changes: rows,
  };
  return { applied: changeset, state: next };
}

describe('undo and redo round trip', () => {
  const s0: State = new Map<string, JsonValue>([
    ['scenario_value|corp.lab_hc_g|pilots,fy27', 2],
    ['scenario_value|lev.start|L09', 9],
    ['line_item|line|it_001', { name: 'Old' }],
    ['dimension_member|vendor|v_old', { label: 'Gone' }],
  ]);
  const edit: ChangesetDraft = {
    origin: 'ui',
    scenario_id: SCENARIO,
    base_scenario_version: 1,
    changes: [
      {
        target: 'structural',
        key: 'vp',
        member_key: 'vp_new',
        op: 'insert',
        new_value: { label: 'New VP' },
      },
      // inherited 0.3: the draft's old_value is the resolved value, not the (absent) own row
      {
        target: 'variable',
        key: 'lev.L05.nb',
        member_key: '',
        op: 'set',
        old_value: 0.3,
        new_value: 0.4,
      },
      {
        target: 'variable',
        key: 'corp.lab_hc_g',
        member_key: 'pilots,fy27',
        op: 'set',
        old_value: 2,
        new_value: 4,
      },
      { target: 'variable', key: 'lev.start', member_key: 'L09', op: 'unset', new_value: null },
      { target: 'variable', key: 'lev.L09.n', member_key: '', op: 'unset', new_value: null }, // absent: no row
      { target: 'override', key: 'res.net', member_key: '', op: 'set', new_value: 140 },
      {
        target: 'structural',
        key: 'line',
        member_key: 'it_001',
        op: 'set',
        new_value: { name: 'New' },
      },
      { target: 'structural', key: 'vendor', member_key: 'v_old', op: 'delete', new_value: null },
    ],
  };

  it('apply(reverse(cs)) restores the state; reversing the undo (redo) re-applies the edit', () => {
    const first = apply(edit, s0);
    expect(first.applied.changes).toHaveLength(7);
    // old_value is the resolved value: inherited for a cell the scenario did not set, else its own row
    const rowOf = (key: string) => first.applied.changes.find((r) => r.key === key);
    expect(rowOf('lev.L05.nb')).toMatchObject({ op: 'insert', old_value: 0.3, new_value: 0.4 });
    expect(rowOf('lev.start')).toMatchObject({ op: 'delete', old_value: 9, new_value: null });
    expect(rowOf('corp.lab_hc_g')).toMatchObject({ op: 'update', old_value: 2, new_value: 4 });
    const undoDraft = reverse(first.applied);
    expect(undoDraft.reverts_id).toBe(first.applied.id);
    const undone = apply(undoDraft, first.state);
    expect(undone.state).toEqual(s0);
    expect(undone.applied).toMatchObject({ origin: 'ui', reverts_id: first.applied.id });

    const redoDraft = reverse(undone.applied);
    expect(redoDraft).toMatchObject({
      origin: 'ui',
      reverts_id: undone.applied.id,
      base_scenario_version: 3,
    });
    expect(apply(redoDraft, undone.state).state).toEqual(first.state);
  });
});
