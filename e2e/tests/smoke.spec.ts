import { config, readRepoJson } from '@glidepath/int';
import type { Page } from '@playwright/test';
import { BUDGET_MS } from '../playwright.config';
import {
  edits,
  expectCockpitValue,
  expectedOnCockpit,
  cockpitCell as cockpit,
  scenarioButton,
} from './cockpit';
import { expect, goldenOf, HEADLINE, test, type Headline } from './fixtures';

/**
 * QA-04, G9 E2E smoke: a signed-in browser against the compose stack. Load Cockpit C, drag the
 * target, switch scenario, edit an input through its popover (the net target, and a lever found
 * with ⌘K), undo. Headline numbers are compared with `docs/spec/reference/golden_results.json`
 * rendered through the UI's own `fmt`, so the test asserts what a person reads, not a
 * re-computation.
 *
 * `pnpm e2e -- --trace off` (the stack is up: `docker compose up -d` or `ops/compose-check.sh --keep`).
 */

const STARTED = Date.now();
/** The Cockpit slider that moves `res.target` (spec id, verbatim). */
const TARGET = 'g.target_net';
/** A lever input (spec id, verbatim) found with ⌘K and edited in its popover. */
const LEVER = 'lev.L10.shelf';

interface RegistryVariable {
  id: string;
  min: number | null;
  max: number | null;
}
const registry = readRepoJson<{ variables: RegistryVariable[] }>('docs', 'spec', 'variables.json');
const targetDef = registry.variables.find((v) => v.id === TARGET);

/** The Cockpit's cell for `cell` shows the golden value of preset `preset`. */
const expectHeadline = (page: Page, cell: Headline, preset: string) =>
  expectCockpitValue(page, cell, goldenOf(preset, cell), `${cell} of ${preset}`);

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
    await expect
      .poll(async () => Number(await bar.getAttribute('data-value')))
      .toBeLessThan(before);
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
    await expect
      .poll(async () => Number(await bar.getAttribute('data-value')))
      .toBeGreaterThan(barBefore);
    await page.keyboard.press('Escape');
    await expect(popover).toBeHidden();

    // undo from the changeset tray restores A: bar and every headline number are golden A again
    await edits(page).click();
    await page
      .getByRole('dialog', { name: /^Changeset/ })
      .getByRole('button', { name: 'Undo' })
      .click();
    await expect(edits(page)).toHaveAccessibleName('0 edits: open changeset');
    await expect.poll(async () => Number(await bar.getAttribute('data-value'))).toBe(barBefore);
    for (const cell of HEADLINE) await expectHeadline(page, cell, 'A');
  });

  test('edit_lever_via_cmdk_popover_then_undo', async () => {
    // fresh load of locked preset A (0 edits): ⌘K finds the lever by its id, Enter jumps to the
    // Levers screen and opens the lever's edit popover on its control
    await page.goto(`/${config.tenant}/${presetA}/cockpit`);
    await expect(edits(page)).toHaveAccessibleName('0 edits: open changeset');
    await expect(cockpit(page, 'res.net')).toHaveText(
      expectedOnCockpit('res.net', goldenOf('A', 'res.net')),
    );
    await page.keyboard.press('Control+k');
    const palette = page.getByRole('dialog', { name: 'Find any number' });
    await expect(palette).toBeVisible();
    await palette.getByRole('combobox').fill(LEVER);
    await expect(palette.locator(`[role="option"][data-id="${LEVER}"]`)).toBeVisible();
    await palette.getByRole('combobox').press('Enter');
    await expect(page).toHaveURL(/\/levers/);
    const popover = page.locator('.gp-pop[role="dialog"]');
    await expect(popover).toBeVisible();
    const slider = popover.getByRole('slider');
    const before = Number(await slider.inputValue());

    // one registry step up commits an edit (A is locked, so tier 2 forks "Custom (from A)")
    await slider.press('ArrowRight');
    await expect(edits(page)).toHaveAccessibleName('1 edit: open changeset');
    await expect(page).not.toHaveURL(new RegExp(presetA));
    await expect.poll(async () => Number(await slider.inputValue())).toBeGreaterThan(before);
    await page.keyboard.press('Escape');
    await expect(popover).toBeHidden();

    // undo from the tray: no edits left, and the Cockpit headline is golden A again
    await edits(page).click();
    await page
      .getByRole('dialog', { name: /^Changeset/ })
      .getByRole('button', { name: 'Undo' })
      .click();
    await expect(edits(page)).toHaveAccessibleName('0 edits: open changeset');
    await page.goto(page.url().replace('/levers', '/cockpit'));
    for (const cell of HEADLINE) await expectHeadline(page, cell, 'A');
  });

  test('suite_finishes_within_the_g9_budget', () => {
    expect(Date.now() - STARTED).toBeLessThan(BUDGET_MS);
  });
});
