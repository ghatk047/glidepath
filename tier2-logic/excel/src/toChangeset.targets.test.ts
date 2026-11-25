import { beforeAll, describe, expect, it } from 'vitest';
import { checkDraft, type ChangesetDraft, type JsonObject } from '@glidepath/domain';
import {
  ToChangesetError,
  snapshotKey,
  toChangeset,
  type ChangesetOptions,
  type SkipReason,
} from './index';
import {
  freshBook,
  header,
  makeFixture,
  put,
  putAt,
  report,
  sheetOf,
  spareRow,
  type Fixture,
} from './test-support/fixture';

let fx: Fixture;
beforeAll(async () => {
  fx = await makeFixture();
});

const OPTIONS: ChangesetOptions = {
  defaultsVersion: 7,
  scenarios: { A: { id: 'uuid-A', version: 3 }, C: { id: 'uuid-C', version: 5 } },
};
const ALL = { accept: 'all', decisions: [] } as const;
const reasons = (skipped: readonly { reason: SkipReason }[]): SkipReason[] =>
  skipped.map((s) => s.reason).sort();
const defaultsDraft = (drafts: readonly ChangesetDraft[]): ChangesetDraft => {
  const d = drafts.find((x) => x.scenario_id === null);
  if (d === undefined) throw new Error('no defaults draft');
  return d;
};

describe('toChangeset: blanks, notes and pins', () => {
  it('a blank scenario cell unsets the scenario row; a blank Default is skipped (a default cannot be unset)', async () => {
    const book = await freshBook(fx);
    put(book, 'Levers', 'lev.L01.cut', '', header(fx, 'Levers', 'scenario', 1), null);
    put(book, 'Workforce', 'hc.us', '', header(fx, 'Workforce', 'default'), null);
    const plan = toChangeset(await report(fx, book), ALL, OPTIONS);
    expect(plan.drafts).toHaveLength(1);
    expect(plan.drafts[0]).toMatchObject({
      origin: 'excel_import',
      scenario_id: 'uuid-C',
      base_scenario_version: 5,
      changes: [
        { target: 'variable', key: 'lev.L01.cut', member_key: '', op: 'unset', new_value: null },
      ],
    });
    expect(() => checkDraft(plan.drafts[0] as ChangesetDraft)).not.toThrow();
    expect(reasons(plan.skipped)).toEqual(['blank_keeps_value']);
  });

  it('a note edited alone needs the cell value (options.currentValue); a pin reason edited alone too', async () => {
    const book = await freshBook(fx);
    put(
      book,
      'Targets',
      'g.target_net',
      '',
      header(fx, 'Targets', 'note'),
      'only the note changed',
    );
    put(book, 'Overrides', 'res.net', '', header(fx, 'Overrides', 'reason'), 'only the reason');
    const built = await report(fx, book);
    const without = toChangeset(built, ALL, OPTIONS);
    expect(without.drafts).toEqual([]);
    expect(reasons(without.skipped)).toEqual(['needs_value', 'needs_value']);

    const withValue = toChangeset(built, ALL, {
      ...OPTIONS,
      currentValue: (c) => (c.target === 'override' ? 12.5 : c.key === 'g.target_net' ? 90 : null),
    });
    expect(withValue.drafts.map((d) => d.scenario_id)).toEqual([null, 'uuid-A']);
    expect(defaultsDraft(withValue.drafts).changes).toEqual([
      {
        target: 'variable',
        key: 'g.target_net',
        member_key: '',
        op: 'set',
        new_value: 90,
        note: 'only the note changed',
      },
    ]);
    expect(withValue.drafts[1]?.changes).toEqual([
      {
        target: 'override',
        key: 'res.net',
        member_key: '',
        op: 'set',
        new_value: 12.5,
        note: 'only the reason',
      },
    ]);
    // A value the lookup does not know is skipped, not invented.
    const unknown = toChangeset(built, ALL, { ...OPTIONS, currentValue: () => null });
    expect(reasons(unknown.skipped)).toEqual(['needs_value', 'needs_value']);
  });

  it('a pin cleared in Excel is removed (unset) and its reason goes with it; a new pin is set with its reason', async () => {
    const book = await freshBook(fx);
    put(book, 'Overrides', 'res.net', '', header(fx, 'Overrides', 'value'), null);
    put(book, 'Overrides', 'res.net', '', header(fx, 'Overrides', 'reason'), 'dropped');
    const ov = sheetOf(book, 'Overrides');
    const at = spareRow(ov);
    ov.getCell(at, 1).value = 'res.gap';
    putAt(ov, at, header(fx, 'Overrides', 'value'), 5);
    putAt(ov, at, header(fx, 'Overrides', 'reason'), 'new pin');
    const plan = toChangeset(await report(fx, book), ALL, OPTIONS);
    expect(plan.drafts).toHaveLength(1);
    expect(plan.drafts[0]?.scenario_id).toBe('uuid-A');
    expect(plan.drafts[0]?.changes).toEqual(
      expect.arrayContaining([
        { target: 'override', key: 'res.net', member_key: '', op: 'unset', new_value: null },
        {
          target: 'override',
          key: 'res.gap',
          member_key: '',
          op: 'set',
          new_value: 5,
          note: 'new pin',
        },
      ]),
    );
    expect(reasons(plan.skipped)).toEqual(['superseded']);
    expect(() => checkDraft(plan.drafts[0] as ChangesetDraft)).not.toThrow();
  });
});

describe('toChangeset: lines', () => {
  const stored: JsonObject = { name: 'Old name', pool_id: 'infra', in_scope: true, active: true };

  it('an edited attribute is a structural set of the line row (needs options.memberRow); numbers are values of the line', async () => {
    const book = await freshBook(fx);
    put(book, 'Line_Items', 'it_001', 'it_001', header(fx, 'Line_Items', 'name'), 'Renamed line');
    put(book, 'Line_Items', 'it_001', 'it_001', header(fx, 'Line_Items', 'line.amount'), 4.25);
    const flag = fx.snapshot.cells[snapshotKey('Line_Items', 'it_001', 'it_001', 'in_scope')];
    put(
      book,
      'Line_Items',
      'it_001',
      'it_001',
      header(fx, 'Line_Items', 'in_scope'),
      flag === 1 ? false : true,
    );
    const built = await report(fx, book);

    const noRow = toChangeset(built, ALL, OPTIONS);
    expect(reasons(noRow.skipped)).toEqual(['needs_member_row', 'needs_member_row']);
    expect(defaultsDraft(noRow.drafts).changes).toEqual([
      { target: 'variable', key: 'line.amount', member_key: 'it_001', op: 'set', new_value: 4.25 },
    ]);
    const unknownLine = toChangeset(built, ALL, { ...OPTIONS, memberRow: () => null });
    expect(reasons(unknownLine.skipped)).toEqual(['needs_member_row', 'needs_member_row']);

    const calls: string[] = [];
    const plan = toChangeset(built, ALL, {
      ...OPTIONS,
      memberRow: (dim, key) => {
        calls.push(`${dim}/${key}`);
        return stored;
      },
    });
    expect(plan.skipped).toEqual([]);
    expect(calls.every((c) => c === 'line/it_001')).toBe(true);
    expect(defaultsDraft(plan.drafts).changes).toEqual([
      {
        target: 'structural',
        key: 'line',
        member_key: 'it_001',
        op: 'set',
        new_value: { ...stored, name: 'Renamed line', in_scope: flag !== 1 },
      },
      { target: 'variable', key: 'line.amount', member_key: 'it_001', op: 'set', new_value: 4.25 },
    ]);
    expect(() => checkDraft(defaultsDraft(plan.drafts))).not.toThrow();
  });

  it('a new row is an insert with the key the app assigns; DELETE is a structural delete; a missing row is never applied', async () => {
    const book = await freshBook(fx);
    const li = sheetOf(book, 'Line_Items');
    const fresh = spareRow(li);
    putAt(li, fresh, header(fx, 'Line_Items', 'name'), 'New platform');
    putAt(li, fresh, header(fx, 'Line_Items', 'line.amount'), 1.5);
    const r2 = put(
      book,
      'Line_Items',
      'it_002',
      'it_002',
      header(fx, 'Line_Items', 'action'),
      'DELETE',
    );
    li.spliceRows(r2 + 1, 1); // it_003 is removed from the sheet without DELETE
    const built = await report(fx, book);
    expect(built.report.summary).toMatchObject({ new_rows: 1, deleted_rows: 1 });

    const noKey = toChangeset(built, ALL, OPTIONS);
    expect(reasons(noKey.skipped)).toEqual(['missing_row', 'needs_member_key']);
    expect(defaultsDraft(noKey.drafts).changes).toEqual([
      { target: 'structural', key: 'line', member_key: 'it_002', op: 'delete', new_value: null },
    ]);

    const plan = toChangeset(built, ALL, {
      ...OPTIONS,
      newMemberKey: (row) => (row.sheet === 'Line_Items' ? 'it_900' : undefined),
    });
    expect(reasons(plan.skipped)).toEqual(['missing_row']);
    const changes = defaultsDraft(plan.drafts).changes;
    expect(changes).toEqual([
      { target: 'structural', key: 'line', member_key: 'it_002', op: 'delete', new_value: null },
      {
        target: 'structural',
        key: 'line',
        member_key: 'it_900',
        op: 'insert',
        new_value: { active: true, name: 'New platform' },
      },
      { target: 'variable', key: 'line.amount', member_key: 'it_900', op: 'set', new_value: 1.5 },
    ]);
    expect(() => checkDraft(defaultsDraft(plan.drafts))).not.toThrow();

    // Per row: the new row declined, the delete taken (selected).
    const selected = toChangeset(
      built,
      {
        accept: 'selected',
        decisions: [
          { sheet: 'Line_Items', key: 'it_002', member: 'it_002', scenario: null, take: 'excel' },
        ],
      },
      { ...OPTIONS, newMemberKey: () => 'it_900' },
    );
    expect(defaultsDraft(selected.drafts).changes.map((c) => c.op)).toEqual(['delete']);
    // New rows all have the key ''; a decision tells them apart by file row (the splice moved it up one).
    const newRow = built.items.find(
      (i) => i.kind === 'row' && i.diffStatus === 'new_row',
    )?.rowNumber;
    expect(newRow).toBe(fresh - 1);
    const declined = toChangeset(
      built,
      {
        accept: 'all',
        decisions: [
          {
            sheet: 'Line_Items',
            key: '',
            member: '',
            scenario: null,
            take: 'app',
            rowNumber: newRow ?? undefined,
          },
        ],
      },
      { ...OPTIONS, newMemberKey: () => 'it_900' },
    );
    expect(defaultsDraft(declined.drafts).changes.map((c) => c.op)).toEqual(['delete']);
  });
});

describe('toChangeset: options', () => {
  it('throws ToChangesetError when a needed layer has no base version', async () => {
    const book = await freshBook(fx);
    put(book, 'Targets', 'g.target_net', '', header(fx, 'Targets', 'default'), 101);
    put(book, 'Levers', 'lev.L01.cut', '', header(fx, 'Levers', 'scenario', 1), 0.2);
    const built = await report(fx, book);
    expect(() => toChangeset(built, ALL, { scenarios: OPTIONS.scenarios })).toThrow(
      ToChangesetError,
    );
    expect(() => toChangeset(built, ALL, { defaultsVersion: 1 })).toThrow(/scenario 'C'/);
    expect(() => toChangeset(built, ALL, OPTIONS)).not.toThrow();
  });
});
