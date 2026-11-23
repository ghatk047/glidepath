import { config, readRepoJson } from '@glidepath/int';
import { fmt } from '@glidepath/ui/format';
import type { Page } from '@playwright/test';
import { BUDGET_MS } from '../playwright.config';
import { expect, goldenOf, HEADLINE, test, type Headline } from './fixtures';

/**
 * QA-04, G9 E2E smoke: a signed-in browser against the compose stack. Load Cockpit C, drag the
 * target, switch scenario, edit an input through its popover, undo. Headline numbers are compared
 * with `docs/spec/reference/golden_results.json` rendered through the UI's own `fmt`, so the
 * test asserts what a person reads, not a re-computation.
 *
 * `pnpm e2e -- --trace off` (the stack is up: `docker compose up -d` or `ops/compose-check.sh --keep`).
 */

const STARTED = Date.now();
/** The Cockpit slider that moves `res.target` (spec id, verbatim). */
const TARGET = 'g.target_net';

interface RegistryVariable {
  id: string;
  min: number | null;
  max: number | null;
}
const registry = readRepoJson<{ variables: RegistryVariable[] }>('docs', 'spec', 'variables.json');
const targetDef = registry.variables.find((v) => v.id === TARGET);

/** What the screen shows for each headline cell, from a golden number. */
const shown: Record<Headline, (v: number) => string> = {
  'res.net': (v) => fmt.money(v),
  'res.gap': (v) => `${fmt.money(Math.abs(v))} ${v >= 0 ? 'clear' : 'short'}`,
  'res.risk': (v) => fmt.money(v),
  'br.eps27': (v) => fmt.eps(v),
};

/** Cockpit renders `res.net` without its unit (the unit is drawn beside it). */
const cockpit = (page: Page, cell: Headline) => {
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
};
const expectedOnCockpit = (cell: Headline, v: number) =>
  cell === 'res.net' ? shown[cell](v).replace(/M$/, '') : shown[cell](v);

const edits = (page: Page) => page.getByRole('button', { name: /edits?: open changeset/ });
const scenarioButton = (page: Page, id: string) => page.locator(`button[data-scenario="${id}"]`);

/** The gap chip carries an icon glyph and the EPS cell its label: those match by containment. */
const CONTAINED: ReadonlySet<Headline> = new Set(['res.gap', 'br.eps27']);

async function expectHeadline(page: Page, cell: Headline, preset: string): Promise<void> {
  const want = expectedOnCockpit(cell, goldenOf(preset, cell));
  const got = expect(cockpit(page, cell), `${cell} of ${preset}`);
  await (CONTAINED.has(cell) ? got.toContainText(want) : got.toHaveText(want));
}

test.describe.configure({ mode: 'serial' });

test.describe('G9 smoke on the compose stack (QA-04)', () => {
  let page: Page;
  let presetC: string;
  let presetA: string;

  test.beforeAll(async ({ browser, stack }) => {
    presetC = stack.presets.get('C')!.id;
    presetA = stack.presets.get('A')!.id;
    page = await browser.newPage();
    await stack.signInPage(page);
  });
  test.afterAll(async () => {
    await page.close();
  });

  test('cockpit_c_headline_numbers_equal_golden', async () => {
    await page.goto(`/${config.tenant}/${presetC}/cockpit`);
    await expect(page.getByRole('main', { name: 'Cockpit' })).toBeVisible();
    await expect(scenarioButton(page, presetC)).toHaveAttribute('aria-pressed', 'true');
    for (const cell of HEADLINE) {
      await expectHeadline(page, cell, 'C');
    }
    await expect(edits(page)).toHaveAccessibleName('0 edits: open changeset');
  });

  test('drag_target_moves_the_bar_and_forks_preset_c', async () => {
    const bar = page.locator('[data-node="res.bar"]');
    const before = Number(await bar.getAttribute('data-value'));
    const slider = page.locator(`[data-variable-id="${TARGET}"] input[type="range"]`);
    await expect(slider).toBeVisible();
    const box = (await slider.boundingBox())!;
    const { min, max } = { min: targetDef!.min!, max: targetDef!.max! };
    const at = (v: number) => box.x + ((v - min) / (max - min)) * box.width;
    const from = Number(await slider.inputValue());
    // pull the thumb to the low end of the registry range: a cut of the target
    await page.mouse.move(at(from), box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(at(min) + 2, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();
    await expect.poll(async () => Number(await bar.getAttribute('data-value'))).toBeLessThan(before);
    // release commits: a preset is locked, so tier 2 forks "Custom (from C)" and the URL follows
    await expect(edits(page)).toHaveAccessibleName('1 edit: open changeset');
    await expect(page).not.toHaveURL(new RegExp(presetC));
    await expect(scenarioButton(page, presetC)).toHaveAttribute('aria-pressed', 'false');
  });

  test('switch_scenario_shows_golden_a', async () => {
    await scenarioButton(page, presetA).click();
    await expect(page).toHaveURL(new RegExp(`/${presetA}/cockpit`));
    await expect(scenarioButton(page, presetA)).toHaveAttribute('aria-pressed', 'true');
    for (const cell of HEADLINE) {
      await expectHeadline(page, cell, 'A');
    }
    await expect(edits(page)).toHaveAccessibleName('0 edits: open changeset');
  });

  test('edit_input_via_popover_then_undo', async () => {
    // "of $X bar" opens the edit popover of the net target; one registry step up commits an edit
    // (preset A is locked, so tier 2 forks "Custom (from A)")
    const bar = page.locator('[data-node="res.bar"]');
    const barBefore = Number(await bar.getAttribute('data-value'));
    await bar.click();
    const popover = page.locator('.gp-pop[role="dialog"]');
    await expect(popover).toBeVisible();
    await popover.getByRole('slider').press('ArrowRight');
    await expect(edits(page)).toHaveAccessibleName('1 edit: open changeset');
    await expect.poll(async () => Number(await bar.getAttribute('data-value'))).toBeGreaterThan(barBefore);
    await page.keyboard.press('Escape');
    await expect(popover).toBeHidden();

    // undo from the changeset tray restores A: bar and every headline number are golden A again
    await edits(page).click();
    await page.getByRole('dialog', { name: /^Changeset/ }).getByRole('button', { name: 'Undo' }).click();
    await expect(edits(page)).toHaveAccessibleName('0 edits: open changeset');
    await expect.poll(async () => Number(await bar.getAttribute('data-value'))).toBe(barBefore);
    for (const cell of HEADLINE) await expectHeadline(page, cell, 'A');
  });

  test('suite_finishes_within_the_g9_budget', () => {
    expect(Date.now() - STARTED).toBeLessThan(BUDGET_MS);
  });
});
