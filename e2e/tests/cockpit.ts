import { fmt } from '@glidepath/ui/format';
import { expect, type Locator, type Page } from '@playwright/test';
import { HEADLINE_CELLS, specHeadline, type HeadlineKey } from '../src/spec-headline';
import { HEADLINE, type Headline } from './fixtures';

/**
 * What a person reads on the Cockpit, shared by the G9 smoke (QA-04) and the M2 integration spec
 * (INT-03): the element each headline cell is drawn in and the text the UI's own `fmt` makes of a
 * number. Nothing is computed here; the expected text always comes from a number the spec bundle
 * carries (`golden_results.json` or the quoted headline table).
 */

/** What the screen shows for each headline cell, from a value in model units. */
export const shown: Readonly<Record<Headline, (v: number) => string>> = {
  'res.net': (v) => fmt.money(v),
  'res.gap': (v) => `${fmt.money(Math.abs(v))} ${v >= 0 ? 'clear' : 'short'}`,
  'res.risk': (v) => fmt.money(v),
  'br.eps27': (v) => fmt.eps(v),
};

/** Cockpit renders `res.net` without its unit (the unit is drawn beside it). */
export const expectedOnCockpit = (cell: Headline, v: number) =>
  cell === 'res.net' ? shown[cell](v).replace(/M$/, '') : shown[cell](v);

/** The element the Cockpit draws `cell` in. */
export function cockpitCell(page: Page, cell: Headline): Locator {
  switch (cell) {
    case 'res.net':
      return page.locator('[data-testid="cockpit-net"] .gp-cockpit-hero-value');
    case 'res.gap':
      return page.locator('[data-node="res.gap"] .gp-chip');
    case 'res.risk':
      return page.locator('[data-node="res.risk"] dd');
    case 'br.eps27':
      // the flight strip's cell (the strip is hidden on Cockpit, its text is still the bound value)
      return page.locator('[data-hud] [data-cell="eps27"]');
  }
}

/** The gap chip carries an icon glyph and the EPS cell its label: those match by containment. */
const CONTAINED: ReadonlySet<Headline> = new Set(['res.gap', 'br.eps27']);

/** Asserts the Cockpit shows `value` for `cell`, formatted the way the UI formats it. */
export async function expectCockpitValue(
  page: Page,
  cell: Headline,
  value: number,
  what: string,
): Promise<void> {
  const want = expectedOnCockpit(cell, value);
  const got = expect(cockpitCell(page, cell), what);
  await (CONTAINED.has(cell) ? got.toContainText(want) : got.toHaveText(want));
}

/** The whole headline row, against one value per cell. */
export async function expectCockpitHeadline(
  page: Page,
  values: Readonly<Record<Headline, number>>,
  what: string,
): Promise<void> {
  for (const cell of HEADLINE) {
    await expectCockpitValue(page, cell, values[cell], `${cell} ${what}`);
  }
}

/** The edits counter in the top bar (its accessible name carries tier 2's count). */
export const edits = (page: Page) => page.getByRole('button', { name: /edits?: open changeset/ });

/** A scenario's button in the scenario bar. */
export const scenarioButton = (page: Page, id: string) =>
  page.locator(`button[data-scenario="${id}"]`);

/**
 * The numbers the spec quotes for `scenario` (`docs/spec/README.md` "Headline numbers": `A`..`D`,
 * `Rates` for Rates only), by headline cell (`res.net` → 119.3). A cell the spec leaves empty for that
 * row is absent (Rates only quotes no EPS).
 */
export function quotedCells(scenario: string): Partial<Record<Headline, number>> {
  const row = specHeadline(scenario);
  const out: Partial<Record<Headline, number>> = {};
  for (const key of Object.keys(HEADLINE_CELLS) as HeadlineKey[]) {
    const cell = HEADLINE_CELLS[key];
    const quoted = row[key];
    if (quoted && (HEADLINE as readonly string[]).includes(cell)) out[cell as Headline] = quoted.value;
  }
  return out;
}

/** `quotedCells` for a preset whose row quotes every headline cell (A..D); throws otherwise. */
export function quoted(preset: string): Record<Headline, number> {
  const byCell = quotedCells(preset);
  for (const cell of HEADLINE) {
    if (!(cell in byCell)) throw new Error(`the spec quotes no ${cell} for ${preset}`);
  }
  return byCell as Record<Headline, number>;
}
