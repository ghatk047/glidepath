import { beforeAll, describe, expect, it } from 'vitest';
import { type DeltaEntry } from './index';
import {
  appValues,
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

const keysOf = (o: object): string[] => Object.keys(o).sort();
const spec = (): {
  summary: object;
  changes: object[];
  impact: object;
  [k: string]: unknown;
} => fx.template.delta_report_schema as never;

const entry = (
  b: { report: { changes: readonly DeltaEntry[] } },
  sheet: string,
  key: string,
  member = '',
  scenario: string | null = null,
): DeltaEntry => {
  const e = b.report.changes.find(
    (c) => c.sheet === sheet && c.key === key && c.member === member && c.scenario === scenario,
  );
  if (e === undefined) throw new Error(`no entry ${sheet}/${key}/${member}/${scenario}`);
  return e;
};

describe('buildReport: acceptance', () => {
  it('delta report matches delta_report_schema: summary counts, changes[], impact slot', async () => {
    const book = await freshBook(fx);
    // One of each: changed_in_excel, changed_in_app, conflict, already_applied, new row, deleted row, missing row, invalid.
    put(book, 'Targets', 'g.target_net', '', header(fx, 'Targets', 'default'), 101);
    put(book, 'Levers', 'lev.L01.cut', '', header(fx, 'Levers', 'scenario', 1), 0.21);
    put(book, 'Levers', 'lev.L02.cut', '', header(fx, 'Levers', 'scenario', 1), 0.11);
    put(book, 'Levers', 'lev.L08.cut', '', header(fx, 'Levers', 'scenario', 1), 99); // VR04
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
    li.spliceRows(r2 + 1, 1); // it_003 removed without DELETE
    const base =
      fx.values.scenarios[1]?.values.find((v) => v.var_key === 'lev.L01.cut')?.value ?? 0;
    const app = appValues(fx, {
      defaults: [['hc.us', '', 2700]],
      scenarios: [
        ['C', 'lev.L01.cut', '', base + 0.05],
        ['C', 'lev.L02.cut', '', 0.11],
      ],
    });
    const built = await report(fx, book, app, {
      importJobId: 'imp-1',
      impact: { scenario: 'C', 'res.net': [119.3, 123.1], 'res.gap': [-23.7, -19.9] },
    });
    const r = built.report;

    // The schema's keys, verbatim.
    expect(keysOf(r)).toEqual(keysOf(spec()));
    expect(keysOf(r.summary)).toEqual(keysOf(spec().summary));
    const sample = spec().changes[0] ?? {};
    for (const c of r.changes) expect(keysOf(c)).toEqual(keysOf(sample));
    expect(r.import_job_id).toBe('imp-1');
    expect(r.export_job_id).toBe('exp-0001');
    expect(r.mode).toBe('three_way');
    // Impact slot: scenario plus [before, after] per node.
    expect(r.impact).toEqual({
      scenario: 'C',
      'res.net': [119.3, 123.1],
      'res.gap': [-23.7, -19.9],
    });
    expect(r.impact.scenario).toBe((spec().impact as { scenario: string }).scenario);

    // Summary counts, and the statuses behind them.
    expect(entry(built, 'Targets', 'g.target_net').status).toBe('changed_in_excel');
    expect(entry(built, 'Workforce', 'hc.us').status).toBe('changed_in_app');
    expect(entry(built, 'Levers', 'lev.L01.cut', '', 'C').status).toBe('conflict');
    expect(entry(built, 'Levers', 'lev.L02.cut', '', 'C').status).toBe('already_applied');
    expect(entry(built, 'Levers', 'lev.L08.cut', '', 'C')).toMatchObject({
      status: 'invalid',
      workbook: 99,
    });
    expect(r.summary).toEqual({
      unchanged: expect.any(Number),
      changed_in_excel: 1,
      changed_in_app: 1,
      conflict: 1,
      invalid: 1,
      new_rows: 1,
      deleted_rows: 1,
      ignored: 2, // already_applied + the missing row it_003
    });
    expect(r.summary.unchanged).toBeGreaterThan(3000);
    expect(r.changes.filter((c) => c.status === 'new_row')).toHaveLength(1);
    expect(r.changes.filter((c) => c.status === 'deleted_row')).toHaveLength(1);
    expect(r.changes.filter((c) => c.status === 'missing_row')).toHaveLength(1);
    // Every entry has detail at its index.
    expect(built.items).toHaveLength(r.changes.length);
    built.items.forEach((item, i) => expect(item.index).toBe(i));
  });
});
