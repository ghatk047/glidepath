import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { section, tableRows } from './porting-doc';

const here = dirname(fileURLToPath(import.meta.url));
const porting = readFileSync(resolve(here, '../PORTING.md'), 'utf8');

/** The semantics the ENG-01 acceptance line requires, in its order, with the phrase the row must carry. */
const REQUIRED: readonly (readonly [id: string, phrase: RegExp])[] = [
  ['S01', /implicit indexing \(innermost bound var per dim\)/i],
  ['S02', /lazy IF/],
  ['S03', /SAFEDIV alt default 0/],
  ['S04', /'\/' by zero raises/],
  ['S05', /static where-filters/i],
  ['S06', /member order of sums/i],
  ['S07', /MAXOVER\/MINOVER of empty = 0/],
  ['S08', /first matching case/i],
  ['S09', /member subsets/i],
  ['S10', /symbol ids win over attribute access/i],
  ['S11', /'\^' right-assoc/],
  ['S12', /unary minus bp 40/i],
  ['S13', /comparisons return 1\/0/i],
  ['S14', /string literal indices/i],
  ['S15', /node override replaces a cell/i],
];

interface SemRow {
  id: string;
  semantic: string;
  python: string;
  rule: string;
  test: string;
  item: string;
}

function semRows(): SemRow[] {
  const body = section(porting, /^## \d+\. Semantics that are easy to get wrong/);
  return tableRows(body)
    .filter((c) => /^S\d\d$/.test(c[0] ?? ''))
    .map((c) => ({
      id: c[0]!,
      semantic: c[1] ?? '',
      python: c[2] ?? '',
      rule: c[3] ?? '',
      test: c[4] ?? '',
      item: c[5] ?? '',
    }));
}

describe('PORTING.md semantics (porting-semantics.spec.ts)', () => {
  const rows = semRows();

  it('lists each required semantic with its engine.py lines, TS rule, planned test name and item', () => {
    for (const [id, phrase] of REQUIRED) {
      const row = rows.find((r) => r.id === id);
      expect(row, `${id} missing`).toBeDefined();
      expect(row!.semantic, `${id} semantic`).toMatch(phrase);
    }
  });

  it('gives every row engine.py lines, a rule, a planned `*.spec.ts` test and an owning ENG item', () => {
    expect(rows.length).toBeGreaterThanOrEqual(REQUIRED.length);
    for (const r of rows) {
      expect(r.python, `${r.id} engine.py lines`).toMatch(/L\d+/);
      expect(r.rule.length, `${r.id} TS rule`).toBeGreaterThan(20);
      expect(r.test, `${r.id} planned test`).toMatch(/^`[\w-]+\.spec\.ts` › \S.+$/);
      expect(r.item, `${r.id} item`).toMatch(/^ENG-\d\d$/);
    }
  });

  it('plans one distinct test per semantic', () => {
    const titles = rows.map((r) => r.test);
    expect(new Set(titles).size).toBe(titles.length);
    const ids = rows.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
