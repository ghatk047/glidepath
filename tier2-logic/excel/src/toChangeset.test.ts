import { beforeAll, describe, expect, it } from 'vitest';
import { checkDraft, type ChangesetDraft } from '@glidepath/domain';
import {
  ToChangesetError,
  toChangeset,
  type BuiltReport,
  type ChangesetOptions,
  type ImportDecision,
} from './index';
import {
  appValues,
  freshBook,
  header,
  makeFixture,
  put,
  report,
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
const own = (scenario: string, key: string): number => {
  const v = fx.values.scenarios
    .find((s) => s.id === scenario)
    ?.values.find((r) => r.var_key === key);
  if (v === undefined) throw new Error(`no ${scenario}/${key}`);
  return v.value;
};
/** A value inside a lever's bounds that differs from `v`. */
const shift = (v: number): number => (v > 0.15 ? v - 0.05 : v + 0.05);

const draftOf = (drafts: readonly ChangesetDraft[], scenario: string | null): ChangesetDraft => {
  const id = scenario === null ? null : (OPTIONS.scenarios?.[scenario]?.id ?? null);
  const d = drafts.find((x) => x.scenario_id === id);
  if (d === undefined) throw new Error(`no draft for ${scenario}`);
  return d;
};
const changeOf = (d: ChangesetDraft, key: string, member = '') =>
  d.changes.find((c) => c.key === key && c.member_key === member);

const decide = (
  sheet: string,
  key: string,
  take: 'excel' | 'app',
  extra: Partial<ImportDecision> = {},
): ImportDecision => ({ sheet, key, member: '', scenario: null, take, ...extra });

/** The workbook of most tests: edits of every status, and the app's changes since the export. */
async function scenario(): Promise<BuiltReport> {
  const book = await freshBook(fx);
  put(book, 'Targets', 'g.target_net', '', header(fx, 'Targets', 'default'), 101);
  put(book, 'Targets', 'g.target_net', '', header(fx, 'Targets', 'note'), 'revised target');
  put(
    book,
    'Levers',
    'lev.L01.cut',
    '',
    header(fx, 'Levers', 'scenario', 1),
    shift(own('C', 'lev.L01.cut')),
  );
  put(
    book,
    'Levers',
    'lev.L02.cut',
    '',
    header(fx, 'Levers', 'scenario', 0),
    shift(own('A', 'lev.L02.cut')),
  );
  put(book, 'Levers', 'lev.L08.cut', '', header(fx, 'Levers', 'scenario', 1), 99); // VR04
  put(book, 'Overrides', 'res.net', '', header(fx, 'Overrides', 'value'), 13);
  put(book, 'Overrides', 'res.net', '', header(fx, 'Overrides', 'reason'), 'board pin, revised');
  const app = appValues(fx, {
    defaults: [['hc.us', '', 2700]],
    scenarios: [['C', 'lev.L01.cut', '', own('C', 'lev.L01.cut') + 0.01]],
  });
  return report(fx, book, app);
}

describe('toChangeset: acceptance', () => {
  it('toChangeset honours accept all / per row / File|App per conflict; origin excel_import; invalid rows never included', async () => {
    const built = await scenario();
    const statuses = (): string[] => built.report.changes.map((c) => `${c.key}|${c.status}`).sort();
    expect(statuses()).toEqual(
      [
        'g.target_net|changed_in_excel',
        'g.target_net|changed_in_excel',
        'hc.us|changed_in_app',
        'lev.L01.cut|conflict',
        'lev.L02.cut|changed_in_excel',
        'lev.L08.cut|invalid',
        'res.net|changed_in_excel',
        'res.net|changed_in_excel',
      ].sort(),
    );

    // The conflict needs a decision, for accept all and for selected.
    for (const accept of ['all', 'selected'] as const) {
      const err = ((): unknown => {
        try {
          toChangeset(built, { accept, decisions: [] }, OPTIONS);
        } catch (e) {
          return e;
        }
        return undefined;
      })();
      expect(err).toBeInstanceOf(ToChangesetError);
      expect((err as ToChangesetError).undecided).toHaveLength(1);
    }

    // Accept all, the conflict resolved File.
    const all = toChangeset(
      built,
      {
        accept: 'all',
        decisions: [{ ...decide('Levers', 'lev.L01.cut', 'excel'), scenario: 'C' }],
      },
      OPTIONS,
    );
    expect(all.drafts.map((d) => d.origin)).toEqual([
      'excel_import',
      'excel_import',
      'excel_import',
    ]);
    for (const d of all.drafts) expect(() => checkDraft(d)).not.toThrow();
    expect(all.drafts.map((d) => [d.scenario_id, d.base_scenario_version])).toEqual([
      [null, 7],
      ['uuid-C', 5], // scenarios in the order of their first change in the workbook
      ['uuid-A', 3],
    ]);
    expect(changeOf(draftOf(all.drafts, null), 'g.target_net')).toEqual({
      target: 'variable',
      key: 'g.target_net',
      member_key: '',
      op: 'set',
      new_value: 101,
      note: 'revised target',
    });
    expect(changeOf(draftOf(all.drafts, 'A'), 'lev.L02.cut')).toMatchObject({
      op: 'set',
      new_value: shift(own('A', 'lev.L02.cut')),
    });
    const c = draftOf(all.drafts, 'C');
    expect(changeOf(c, 'lev.L01.cut')).toMatchObject({
      op: 'set',
      new_value: shift(own('C', 'lev.L01.cut')),
    });
    // The Overrides sheet lists the pins of the first exported scenario (A).
    expect(changeOf(draftOf(all.drafts, 'A'), 'res.net')).toEqual({
      target: 'override',
      key: 'res.net',
      member_key: '',
      op: 'set',
      new_value: 13,
      note: 'board pin, revised',
    });
    // Invalid rows are never included; the app's change (hc.us) is kept.
    const keys = all.drafts.flatMap((d) => d.changes.map((x) => x.key));
    expect(keys).not.toContain('lev.L08.cut');
    expect(keys).not.toContain('hc.us');
    expect(all.skipped.map((s) => s.reason).sort()).toEqual(['invalid', 'keep_app']); // L08, hc.us

    // Conflict resolved App: the app's value stays, the rest is applied.
    const keepApp = toChangeset(
      built,
      { accept: 'all', decisions: [{ ...decide('Levers', 'lev.L01.cut', 'app'), scenario: 'C' }] },
      OPTIONS,
    );
    expect(keepApp.drafts.map((d) => d.scenario_id)).toEqual([null, 'uuid-A']); // nothing left for C
    expect(changeOf(draftOf(keepApp.drafts, 'A'), 'res.net')).toBeDefined();
    expect(keepApp.skipped.map((s) => s.reason).sort()).toEqual([
      'invalid',
      'keep_app',
      'keep_app',
    ]);

    // Per row: one accepted row (and the conflict, decided) in 'selected'; a row declined in 'all'.
    const selected = toChangeset(
      built,
      {
        accept: 'selected',
        decisions: [
          { ...decide('Levers', 'lev.L01.cut', 'app'), scenario: 'C' },
          { ...decide('Levers', 'lev.L02.cut', 'excel'), scenario: 'A' },
        ],
      },
      OPTIONS,
    );
    expect(selected.drafts.map((d) => d.scenario_id)).toEqual(['uuid-A']);
    expect(selected.drafts[0]?.changes.map((x) => x.key)).toEqual(['lev.L02.cut']);
    const declined = toChangeset(
      built,
      {
        accept: 'all',
        decisions: [
          decide('Targets', 'g.target_net', 'app'),
          { ...decide('Levers', 'lev.L01.cut', 'app'), scenario: 'C' },
        ],
      },
      OPTIONS,
    );
    expect(declined.drafts.flatMap((d) => d.changes.map((x) => x.key))).not.toContain(
      'g.target_net',
    );
    expect(declined.skipped.filter((s) => s.reason === 'keep_app')).toHaveLength(4); // value, note, conflict, hc.us
  });
});

describe('toChangeset: decisions', () => {
  it('a decision that names the column wins over one for the whole row', async () => {
    const built = await scenario();
    const plan = toChangeset(
      built,
      {
        accept: 'all',
        decisions: [
          decide('Targets', 'g.target_net', 'excel'),
          decide('Targets', 'g.target_net', 'app', { column: 'note' }),
          { ...decide('Levers', 'lev.L01.cut', 'app'), scenario: 'C' },
        ],
      },
      OPTIONS,
    );
    const change = changeOf(draftOf(plan.drafts, null), 'g.target_net');
    expect(change).toMatchObject({ op: 'set', new_value: 101 });
    expect(change).not.toHaveProperty('note');
  });

  it('a decision for changed_in_app is ignored (the app value stays); decisions that match nothing are returned; invalid stays out even when decided File', async () => {
    const built = await scenario();
    const stray = decide('Targets', 'g.nothing', 'excel');
    const plan = toChangeset(
      built,
      {
        accept: 'all',
        decisions: [
          decide('Workforce', 'hc.us', 'excel'),
          { ...decide('Levers', 'lev.L08.cut', 'excel'), scenario: 'C' },
          { ...decide('Levers', 'lev.L01.cut', 'app'), scenario: 'C' },
          stray,
        ],
      },
      OPTIONS,
    );
    const keys = plan.drafts.flatMap((d) => d.changes.map((x) => x.key));
    expect(keys).not.toContain('hc.us');
    expect(keys).not.toContain('lev.L08.cut');
    expect(plan.unmatchedDecisions).toEqual([stray]);
  });

  it('nothing accepted gives no drafts', async () => {
    const built = await scenario();
    // The conflict is decided App; nothing else is selected, so no base versions are needed either.
    const plan = toChangeset(
      built,
      {
        accept: 'selected',
        decisions: [{ ...decide('Levers', 'lev.L01.cut', 'app'), scenario: 'C' }],
      },
      {},
    );
    expect(plan.drafts).toEqual([]);
    expect(plan.applied).toEqual([]);
  });
});
