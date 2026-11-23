import { describe, expect, it } from 'vitest';
import {
  CHANGE_ROW_OPS,
  CHANGE_ROW_STATUSES,
  CHANGE_ROW_TARGETS,
  CHANGE_ROW_TARGET_KIND,
  CHANGE_TARGETS,
  CHANGESET_ORIGINS,
  CHANGESET_STATUSES,
  ChangesetDraftError,
  LINE_ITEM_DIM,
  TENANT_COLUMN,
  changeRowTarget,
  checkDraft,
  draftIssues,
  type Change,
  type ChangeRow,
  type ChangeRowTarget,
  type ChangesetDraft,
  type ChangesetRow,
  type StructuralChange,
  type ValueChange,
} from './changeset';
import { columnsOf, enumOf, isNullable } from './test-support/schema-json';

const SCENARIO = '00000000-0000-4000-8000-0000000000a1';

// Full rows: a literal of an exact row type must name every column and nothing else. The tenant-default
// row also pins the nullable columns (scenario_id, reverts_id) at compile time.
const changesetRow: ChangesetRow = {
  id: '00000000-0000-4000-8000-0000000000c1',
  origin: 'ui',
  scenario_id: SCENARIO,
  base_scenario_version: 3,
  status: 'applied',
  summary: {},
  created_by: '00000000-0000-4000-8000-0000000000e1',
  created_at: '2026-11-23T10:00:00.000Z',
  reverts_id: null,
};
const tenantDefaultRow: ChangesetRow = {
  ...changesetRow,
  scenario_id: null,
  reverts_id: changesetRow.id,
};
const changeRow: ChangeRow = {
  changeset_id: changesetRow.id,
  seq: 1,
  target: 'scenario_value',
  key: 'corp.lab_hc_g',
  member_key: 'pilots,fy27',
  op: 'update',
  old_value: 2,
  new_value: 4,
  export_value: null,
  status: 'clean',
  messages: [],
};

describe('ChangesetDraft and Change match schema.json changeset/change columns', () => {
  it('ChangesetRow and ChangeRow carry exactly the schema.json columns (tenant_id comes from the store)', () => {
    for (const row of [changesetRow, tenantDefaultRow]) {
      expect([TENANT_COLUMN, ...Object.keys(row)].sort()).toEqual(columnsOf('changeset').sort());
    }
    expect([TENANT_COLUMN, ...Object.keys(changeRow)].sort()).toEqual(columnsOf('change').sort());
  });

  it('the columns the row types make nullable are the nullable schema.json columns', () => {
    expect(columnsOf('changeset').filter((c) => isNullable('changeset', c))).toEqual([
      'scenario_id',
      'reverts_id',
    ]);
    expect(columnsOf('change').filter((c) => isNullable('change', c))).toEqual(['export_value']);
  });

  it('enums are schema.json enums verbatim', () => {
    expect([...CHANGESET_ORIGINS]).toEqual(enumOf('changeset', 'origin'));
    expect([...CHANGESET_STATUSES]).toEqual(enumOf('changeset', 'status'));
    expect([...CHANGE_ROW_TARGETS]).toEqual(enumOf('change', 'target'));
    expect([...CHANGE_ROW_OPS]).toEqual(enumOf('change', 'op'));
    expect([...CHANGE_ROW_STATUSES]).toEqual(enumOf('change', 'status'));
  });

  it('draft fields are changeset/change columns; a note is persisted to variable_value.note or node_override.reason', () => {
    const draft: Required<ChangesetDraft> = {
      origin: 'excel_import',
      scenario_id: SCENARIO,
      base_scenario_version: 3,
      reverts_id: null,
      changes: [],
    };
    const changesetCols = columnsOf('changeset');
    for (const k of Object.keys(draft).filter((k) => k !== 'changes'))
      expect(changesetCols).toContain(k);

    const value: Required<ValueChange> = {
      target: 'variable',
      key: 'corp.lab_hc_g',
      member_key: 'pilots,fy27',
      op: 'set',
      old_value: 2,
      new_value: 4,
      note: 'union contract',
    };
    const structural: Required<StructuralChange> = {
      target: 'structural',
      key: 'vp',
      member_key: 'vp_new',
      op: 'insert',
      old_value: null,
      new_value: { label: 'New VP' },
      note: 'reorg',
    };
    for (const c of [value, structural]) {
      for (const k of Object.keys(c).filter((k) => k !== 'note'))
        expect(columnsOf('change')).toContain(k);
    }
    // change has no note column; the value rows that keep one do.
    expect(columnsOf('change')).not.toContain('note');
    expect(columnsOf('variable_value')).toContain('note');
    expect(columnsOf('node_override')).toContain('reason');
    expect(columnsOf('scenario_value')).not.toContain('note');
    expect(columnsOf('dimension_member')).not.toContain('note');
  });

  it('every schema change target maps to one draft target, and changeRowTarget is its inverse', () => {
    expect(new Set(Object.values(CHANGE_ROW_TARGET_KIND))).toEqual(new Set(CHANGE_TARGETS));

    const v = { target: 'variable', key: 'g.target_net' } as const;
    const o = { target: 'override', key: 'res.net' } as const;
    const line = { target: 'structural', key: LINE_ITEM_DIM } as const;
    const vp = { target: 'structural', key: 'vp' } as const;
    const cases: [Pick<Change, 'target' | 'key'>, string | null, ChangeRowTarget][] = [
      [v, null, 'variable_value'],
      [v, SCENARIO, 'scenario_value'],
      [o, SCENARIO, 'node_override'],
      [line, null, 'line_item'],
      [vp, null, 'dimension_member'],
      [vp, SCENARIO, 'dimension_member'],
    ];
    for (const [change, scenario, rowTarget] of cases) {
      expect(changeRowTarget(change, scenario)).toBe(rowTarget);
      expect(CHANGE_ROW_TARGET_KIND[rowTarget]).toBe(change.target);
    }
    expect(new Set(cases.map((c) => c[2]))).toEqual(new Set(CHANGE_ROW_TARGETS));
  });

  it('a node override needs a scenario (node_override.scenario_id is a pk part)', () => {
    expect(isNullable('node_override', 'scenario_id')).toBe(false);
    expect(() => changeRowTarget({ target: 'override', key: 'res.net' }, null)).toThrow(
      /override res\.net.*scenario/,
    );
  });
});

describe('checkDraft rejects drafts that are invalid whatever the state', () => {
  const draft = (scenario_id: string | null, ...changes: Change[]): ChangesetDraft => ({
    origin: 'api',
    scenario_id,
    base_scenario_version: 0,
    changes,
  });
  const unsetDefault: Change = {
    target: 'variable',
    key: 'g.target_net',
    member_key: '',
    op: 'unset',
    new_value: null,
  };

  it('valid drafts pass, including set on tenant defaults and unset on a scenario', () => {
    const ok = [
      draft(null, { ...unsetDefault, op: 'set', new_value: 120, note: 'board target' }),
      draft(SCENARIO, unsetDefault),
      draft(SCENARIO, {
        target: 'override',
        key: 'res.net',
        member_key: '',
        op: 'set',
        new_value: 140,
        note: 'finance view',
      }),
      draft(null, {
        target: 'structural',
        key: 'vp',
        member_key: 'vp_new',
        op: 'insert',
        new_value: { label: 'New VP' },
      }),
      draft(null, {
        target: 'structural',
        key: 'vp',
        member_key: 'vp_old',
        op: 'delete',
        new_value: null,
      }),
    ];
    for (const d of ok) {
      expect(draftIssues(d)).toEqual([]);
      expect(() => checkDraft(d)).not.toThrow();
    }
  });

  it('unset on tenant defaults (scenario_id null) is a validation error', () => {
    const d = draft(null, unsetDefault);
    expect(draftIssues(d)).toEqual([
      {
        index: 0,
        message:
          'variable g.target_net[]: tenant defaults cannot be unset (the cell would have no value); set a value instead',
      },
    ]);
    expect(() => checkDraft(d)).toThrow(ChangesetDraftError);
    expect(() => checkDraft(d)).toThrow(/change 0: .*tenant defaults cannot be unset/);
  });

  it('lists every problem: overrides without a scenario, new_value not fitting the op, a bad version, no changes', () => {
    const d: ChangesetDraft = {
      ...draft(
        null,
        { target: 'override', key: 'res.net', member_key: '', op: 'set', new_value: 1 },
        { target: 'variable', key: 'g.target_net', member_key: '', op: 'set', new_value: null },
        { target: 'variable', key: 'g.target_net', member_key: '', op: 'set', new_value: NaN },
        { target: 'structural', key: 'vp', member_key: 'v', op: 'insert', new_value: null },
        { target: 'structural', key: 'vp', member_key: 'v', op: 'delete', new_value: {} },
      ),
      base_scenario_version: -1,
    };
    const issues = draftIssues(d);
    expect(issues.map((i) => i.index)).toEqual([null, 0, 1, 2, 3, 4]);
    expect(issues.map((i) => i.message)).toEqual([
      'base_scenario_version -1 is not a version',
      'override res.net[]: a node override belongs to a scenario',
      'variable g.target_net[]: set needs a finite number as new_value',
      'variable g.target_net[]: set needs a finite number as new_value',
      'structural vp[v]: insert needs the row as new_value',
      'structural vp[v]: delete needs new_value null',
    ]);
    try {
      checkDraft(d);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ChangesetDraftError);
      expect((e as ChangesetDraftError).issues).toEqual(issues);
      expect((e as Error).message).toBe(
        'draft: base_scenario_version -1 is not a version (and 5 more)',
      );
    }
    expect(
      draftIssues(
        draft(SCENARIO, {
          target: 'variable',
          key: 'g.target_net',
          member_key: '',
          op: 'unset',
          new_value: 3,
        }),
      ),
    ).toEqual([{ index: 0, message: 'variable g.target_net[]: unset needs new_value null' }]);
    expect(draftIssues(draft(SCENARIO))).toEqual([
      { index: null, message: 'a changeset needs at least one change' },
    ]);
  });
});
