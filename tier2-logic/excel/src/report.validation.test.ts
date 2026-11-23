import { beforeAll, describe, expect, it } from 'vitest';
import {
  buildReport,
  buildWorkbook,
  diff,
  parseWorkbook,
  withImpact,
  type DeltaEntry,
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

describe('buildReport: validation and modes', () => {
  it('an unchanged export has no changes; withImpact fills the impact slot', async () => {
    const built = await report(fx, await freshBook(fx));
    expect(built.report.changes).toEqual([]);
    expect(built.items).toEqual([]);
    expect(built.report.summary).toMatchObject({
      changed_in_excel: 0,
      changed_in_app: 0,
      conflict: 0,
      invalid: 0,
      new_rows: 0,
      deleted_rows: 0,
      ignored: 0,
    });
    expect(built.report.impact).toEqual({ scenario: '' });
    const filled = withImpact(built, { scenario: 'C', 'res.net': [1, 2] });
    expect(filled.report.impact).toEqual({ scenario: 'C', 'res.net': [1, 2] });
    expect(built.report.impact).toEqual({ scenario: '' });
  });

  it('a blocking entry (VR04, type) marks the cell invalid and adds its message', async () => {
    const book = await freshBook(fx);
    put(book, 'Targets', 'g.target_net', '', header(fx, 'Targets', 'default'), 5000); // VR04, max 150
    put(book, 'Workforce', 'hc.us', '', header(fx, 'Workforce', 'default'), 2500.5); // whole numbers only
    put(book, 'Targets', 'g.head_start', '', header(fx, 'Targets', 'default'), 'soon'); // text
    const built = await report(fx, book);
    const target = entry(built, 'Targets', 'g.target_net');
    expect(target.status).toBe('invalid');
    expect(target.messages.length).toBeGreaterThan(0);
    expect(entry(built, 'Workforce', 'hc.us').status).toBe('invalid');
    expect(entry(built, 'Targets', 'g.head_start')).toMatchObject({
      status: 'invalid',
      workbook: 'soon',
    });
    expect(built.report.summary).toMatchObject({ invalid: 3, changed_in_excel: 0 });
    const item = built.items[built.report.changes.indexOf(target)];
    expect(item).toMatchObject({ kind: 'cell', column: 'default', diffStatus: 'changed_in_excel' });
  });

  it('a cross-row rule (VR01) turns the changed cell invalid', async () => {
    const book = await freshBook(fx);
    put(
      book,
      'Org_Map',
      'org.dom_share',
      'commercial_applications',
      header(fx, 'Org_Map', 'vp.vp_operations'),
      0.25,
    );
    const built = await report(fx, book);
    const bad = built.report.changes.filter((c) => c.status === 'invalid');
    expect(bad).toHaveLength(1);
    expect(bad[0]).toMatchObject({ sheet: 'Org_Map', key: 'org.dom_share', workbook: 0.25 });
  });

  it('an error at a place the diff does not list becomes one invalid entry; an edited locked label is only a warning', async () => {
    const book = await freshBook(fx);
    const tg = sheetOf(book, 'Targets');
    const at = spareRow(tg);
    tg.getCell(at, 1).value = 'g.no_such_input';
    putAt(tg, at, header(fx, 'Targets', 'default'), 5);
    put(book, 'Targets', 'g.target_net', '', header(fx, 'Targets', 'label'), 'my label');
    const built = await report(fx, book);
    const issues = built.items.filter((i) => i.kind === 'issue');
    expect(issues).toHaveLength(1);
    expect(built.report.changes[issues[0]?.index ?? -1]).toMatchObject({
      sheet: 'Targets',
      key: 'g.no_such_input',
      status: 'invalid',
      export: null,
      workbook: null,
      current: null,
    });
    expect(built.report.summary.invalid).toBe(1);
    // The unknown row is also in the diff's unmatched list: reported as invalid, not counted as ignored too.
    expect(built.unmatched.some((u) => u.key === 'g.no_such_input')).toBe(true);
    // The locked-label edit applies nothing: a warning, counted as ignored.
    expect(built.warnings.map((w) => w.code)).toEqual(['locked_edit']);
    expect(built.report.summary.ignored).toBe(1);
  });

  it('entries without a file position fall back to the first CellKey; warnings that point at nothing are kept', async () => {
    const book = await freshBook(fx);
    const bytes = new Uint8Array(await book.xlsx.writeBuffer());
    const W = await parseWorkbook(bytes, fx.defs, { scenarios: fx.scenarios });
    const D = buildWorkbook(fx.defs, fx.values, fx.meta).snapshot;
    const none = diff(fx.snapshot, W, D, fx.defs);
    const built = buildReport(none, [
      {
        code: 'cross_row',
        rule: 'VR01',
        severity: 'error',
        message: 'shares must sum to 100%',
        cells: ['org.dom_share[commercial_applications,vp_operations]'],
        locations: [],
      },
      {
        code: 'cross_row',
        rule: 'VR01',
        severity: 'error',
        message: 'no cells',
        cells: [],
        locations: [],
      },
      {
        code: 'locked_edit',
        severity: 'warning',
        message: 'edited a label',
        cells: [],
        locations: [],
      },
    ]);
    expect(built.report.changes).toHaveLength(1);
    expect(built.report.changes[0]).toMatchObject({
      sheet: '',
      key: 'org.dom_share',
      member: 'commercial_applications,vp_operations',
      status: 'invalid',
      messages: ['shares must sum to 100%'],
    });
    expect(built.warnings).toHaveLength(1);
    expect(built.report.summary).toMatchObject({ invalid: 1, ignored: 1 });
  });

  it('a foreign workbook (no snapshot) reports mode foreign and a null export id', async () => {
    const book = await freshBook(fx);
    put(book, 'Targets', 'g.target_net', '', header(fx, 'Targets', 'default'), 101);
    const bytes = new Uint8Array(await book.xlsx.writeBuffer());
    const W = await parseWorkbook(bytes, fx.defs, { scenarios: fx.scenarios });
    const D = buildWorkbook(fx.defs, fx.values, fx.meta).snapshot;
    const built = buildReport(diff(null, W, D, fx.defs), []);
    expect(built.report.mode).toBe('foreign');
    expect(built.report.export_job_id).toBeNull();
    expect(entry(built, 'Targets', 'g.target_net')).toMatchObject({
      status: 'changed_in_excel',
      export: null,
      workbook: 101,
    });
  });
});
