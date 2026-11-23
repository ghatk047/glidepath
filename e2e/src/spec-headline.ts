import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from '@glidepath/int';

/**
 * The headline numbers the spec quotes for a scenario, read from the spec bundle itself
 * (`docs/spec/README.md` § "Headline numbers"), so no business number is written in code.
 * They are the rounded numbers a person reads on the Cockpit and the ones the milestone checks
 * quote (09 §1, 20_orchestrator Loop step 6: C net 119.3, gap −23.7, risk-adjusted 82.0,
 * EPS +0.091); `docs/spec/reference/golden_results.json` holds the same values to six decimals.
 */

/** Spec ids (verbatim) of the cells the headline table carries. */
export const HEADLINE_CELLS = {
  net: 'res.net',
  risk: 'res.risk',
  gap: 'res.gap',
  runRate: 'res.tot_rr',
  eps27: 'br.eps27',
  px27: 'br.px27',
} as const;

export type HeadlineKey = keyof typeof HEADLINE_CELLS;

/** Column headers of the table, as written in `docs/spec/README.md`. */
const COLUMNS: Readonly<Record<string, HeadlineKey>> = {
  Net: 'net',
  'Risk-adjusted': 'risk',
  'Gap to bar': 'gap',
  'Run-rate': 'runRate',
  'EPS 2027': 'eps27',
  'Share price': 'px27',
};

const HEADING = '## Headline numbers';
const SPEC_README = ['docs', 'spec', 'README.md'];
/** U+2212, the minus sign the spec and the UI use. */
const MINUS = '−';

/** One quoted number: its value, how many decimals the spec quotes it to, and the cell's text. */
export interface SpecNumber {
  readonly value: number;
  readonly decimals: number;
  /** The table cell as written (`+$0.091`). */
  readonly text: string;
}

export type SpecHeadline = { readonly [K in HeadlineKey]?: SpecNumber };

const cells = (row: string): string[] =>
  row
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());

const isRule = (row: string) => /^\|[\s:|-]+\|$/.test(row.trim());

/** `+$0.091` → 0.091 to 3 decimals; `−23.7` → −23.7 to 1. An empty cell is not a number. */
export function parseSpecNumber(text: string): SpecNumber | null {
  const plain = text.replace(/\*/g, '').replace(/[$,+]/g, '').replace(MINUS, '-').trim();
  if (!/^-?\d+(\.\d+)?$/.test(plain)) return null;
  const value = Number(plain);
  return { value, decimals: (plain.split('.')[1] ?? '').length, text };
}

/** The scenario a row is for (`**C Balanced**` → `C`, `Rates only` → `Rates`). */
const rowKey = (label: string) => label.replace(/\*/g, '').trim().split(/\s+/)[0] ?? '';

/** The markdown table that follows `heading`, as rows of cells (the rule row dropped). */
function tableAfter(text: string, heading: string): string[][] {
  const at = text.indexOf(heading);
  if (at < 0) throw new Error(`${SPEC_README.join('/')} has no "${heading}" section`);
  const lines = text
    .slice(at + heading.length)
    .split('\n')
    .map((l) => l.trim());
  const start = lines.findIndex((l) => l.startsWith('|'));
  if (start < 0) throw new Error(`"${heading}" is followed by no table`);
  const after = lines.findIndex((l, i) => i > start && !l.startsWith('|'));
  return lines
    .slice(start, after < 0 ? undefined : after)
    .filter((l) => !isRule(l))
    .map(cells);
}

/**
 * The spec's headline row for `scenario` (`A`..`D`), by column. Columns the spec leaves empty for
 * that row are absent. Throws when the table or the row is gone: `docs/spec/` is read-only, so a
 * change there is an ADR, never a test fix.
 */
export function specHeadline(scenario: string): SpecHeadline {
  const table = tableAfter(readFileSync(join(repoRoot, ...SPEC_README), 'utf8'), HEADING);
  const header = table[0] ?? [];
  const row = table.slice(1).find((r) => rowKey(r[0] ?? '') === scenario);
  if (!row) throw new Error(`"${HEADING}" has no row for scenario ${scenario}`);

  const found: { -readonly [K in HeadlineKey]?: SpecNumber } = {};
  header.forEach((name, i) => {
    const key = COLUMNS[name];
    const parsed = key ? parseSpecNumber(row[i] ?? '') : null;
    if (key && parsed) found[key] = parsed;
  });
  if (Object.keys(found).length === 0) {
    throw new Error(`row ${scenario} of "${HEADING}" carries no numbers`);
  }
  return found;
}
