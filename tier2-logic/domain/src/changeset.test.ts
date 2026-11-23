import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  CHANGE_OPS,
  CHANGE_ROW_OPS,
  CHANGE_ROW_STATUSES,
  CHANGE_ROW_TARGETS,
  CHANGE_ROW_TARGET_KIND,
  CHANGE_TARGETS,
  CHANGESET_ORIGINS,
  CHANGESET_STATUSES,
  LINE_ITEM_DIM,
  TENANT_COLUMN,
  changeRowTarget,
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

// Full rows: a literal of an exact row type must name every column and nothing else.
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
    expect([TENANT_COLUMN, ...Object.keys(changesetRow)].sort()).toEqual(
      columnsOf('changeset').sort(),
    );
    expect([TENANT_COLUMN, ...Object.keys(changeRow)].sort()).toEqual(columnsOf('change').sort());
  });

  it('nullable columns are nullable in the row types and nowhere else', () => {
    expect(columnsOf('changeset').filter((c) => isNullable('changeset', c))).toEqual([
      'scenario_id',
      'reverts_id',
    ]);
    expect(columnsOf('change').filter((c) => isNullable('change', c))).toEqual(['export_value']);
    expectTypeOf<ChangesetRow['scenario_id']>().toEqualTypeOf<string | null>();
    expectTypeOf<ChangesetRow['reverts_id']>().toEqualTypeOf<string | null>();
    expectTypeOf<null>().not.toMatchTypeOf<ChangesetRow['id' | 'created_by' | 'created_at']>();
    expectTypeOf<null>().not.toMatchTypeOf<ChangeRow['key' | 'member_key' | 'changeset_id']>();
  });

  it('enums are schema.json enums verbatim', () => {
    expect([...CHANGESET_ORIGINS]).toEqual(enumOf('changeset', 'origin'));
    expect([...CHANGESET_STATUSES]).toEqual(enumOf('changeset', 'status'));
    expect([...CHANGE_ROW_TARGETS]).toEqual(enumOf('change', 'target'));
    expect([...CHANGE_ROW_OPS]).toEqual(enumOf('change', 'op'));
    expect([...CHANGE_ROW_STATUSES]).toEqual(enumOf('change', 'status'));
    expectTypeOf<ChangesetRow['origin']>().toEqualTypeOf<(typeof CHANGESET_ORIGINS)[number]>();
    expectTypeOf<ChangeRow['target']>().toEqualTypeOf<(typeof CHANGE_ROW_TARGETS)[number]>();
    expectTypeOf<ChangeRow['op']>().toEqualTypeOf<(typeof CHANGE_ROW_OPS)[number]>();
  });

  it('origins named by DOM-01 exist (market is schema market_refresh; api is also a schema origin)', () => {
    for (const o of [
      'ui',
      'excel_import',
      'solver',
      'ai_reconfig',
      'seed',
      'market_refresh',
      'api',
    ]) {
      expect(CHANGESET_ORIGINS).toContain(o);
    }
  });

  it('draft fields are changeset/change columns', () => {
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
    };
    const structural: Required<StructuralChange> = {
      target: 'structural',
      key: 'vp',
      member_key: 'vp_new',
      op: 'insert',
      old_value: null,
      new_value: { label: 'New VP' },
    };
    for (const c of [value, structural]) {
      for (const k of Object.keys(c)) expect(columnsOf('change')).toContain(k);
    }
    expectTypeOf<keyof Change>().toEqualTypeOf<
      'target' | 'key' | 'member_key' | 'op' | 'old_value' | 'new_value'
    >();
    expectTypeOf<keyof ChangesetDraft>().toEqualTypeOf<
      'origin' | 'scenario_id' | 'base_scenario_version' | 'reverts_id' | 'changes'
    >();
  });

  it('draft vocabulary is target variable|override|structural and op set|unset|insert|delete', () => {
    expect([...CHANGE_TARGETS]).toEqual(['variable', 'override', 'structural']);
    expect([...CHANGE_OPS]).toEqual(['set', 'unset', 'insert', 'delete']);
    expectTypeOf<Change['target']>().toEqualTypeOf<(typeof CHANGE_TARGETS)[number]>();
    expectTypeOf<Change['op']>().toEqualTypeOf<(typeof CHANGE_OPS)[number]>();
    // set/unset are value ops; insert/set/delete are structural ops.
    expectTypeOf<ValueChange['op']>().toEqualTypeOf<'set' | 'unset'>();
    expectTypeOf<StructuralChange['op']>().toEqualTypeOf<'insert' | 'set' | 'delete'>();
  });

  it('every schema change target maps to one draft target, and changeRowTarget is its inverse', () => {
    expect(Object.keys(CHANGE_ROW_TARGET_KIND).sort()).toEqual([...CHANGE_ROW_TARGETS].sort());
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
    expect(LINE_ITEM_DIM).toBe('line');
  });

  it('a node override needs a scenario (node_override.scenario_id is a pk part)', () => {
    expect(isNullable('node_override', 'scenario_id')).toBe(false);
    expect(() => changeRowTarget({ target: 'override', key: 'res.net' }, null)).toThrow(
      /override res\.net.*scenario/,
    );
  });
});
