import { config } from '@glidepath/int';
import { fmt } from '@glidepath/ui/format';
import type { Page } from '@playwright/test';
import { PEOPLE_LEVERS, solverDemo } from '../src/storyline';
import { WZ, cellsOfLever, demoPathEps27, expectedInYear, registryVariable } from '../src/wizard';
import { scenarioButton } from './cockpit';
import { expect, goldenOf, test } from './fixtures';

/**
 * WIZ-11 (plan §7.2): the wizard segment of the demo, which replaces beats 4 to 6 when the MD wants to
 * build rather than watch (`docs/ux/06_walkthrough_narrative.md` "Wizard segment"). It follows the
 * narrative step by step on a clean scenario C: the tour's `wizard` and `optimize` cards, Cloud FinOps (L11)
 * off and on with the tape following, Software (L10) shelfware moved and put back, outside funding moved
 * and restored, then Find a path and Use this path. Everything is restored before the optimizer runs,
 * so the answer is the oracle's `min_risk_total_bar` (the narrative's warning), and the app ends on the new
 * `solver` scenario with the wizard on its Result step. Expected numbers: `golden_results.json`,
 * `solver_demo_results.json` and the registry, through the UI's `fmt`.
 *
 * The tour cards that introduce the screen are their own test (they use the `?tour=wizard` deep link).
 *
 * Runs in the storyline config (`pnpm e2e:storyline -- --trace off`).
 */

const SHELF = 'lev.L10.shelf';
const OUTSIDE = 'g.ot_out_share';

const tape = (page: Page, term: string) => page.locator(WZ.tapeValue(term)).first();
const tapeNumber = async (page: Page, term: string): Promise<number> =>
  Number(await tape(page, term).getAttribute('data-value'));
const range = (page: Page, id: string) =>
  page.getByRole('slider', { name: registryVariable(id).label, exact: true }).first();
const onStep = (page: Page, n: number) =>
  expect(page.locator(WZ.stepButton(n))).toHaveAttribute('aria-current', 'step');

test.describe('Demo storyline: wizard segment (QA-05, WIZ-11)', () => {
  test('wizard_alt_beats_04_to_06_build_a_plan_and_optimize_to_the_bar', async ({ browser, stack }) => {
    test.setTimeout(240_000);
    const presetC = stack.presets.get('C')!.id;
    const demo = solverDemo().min_risk_total_bar;
    const shelf = registryVariable(SHELF);
    const outside = registryVariable(OUTSIDE);
    const page = await browser.newPage();
    await stack.signInPage(page);
    try {
      await page.goto(`/${config.tenant}/${presetC}/wizard`);
      await expect(page.locator(WZ.step(1))).toBeVisible();

      // Step 1 Levers: Cloud FinOps (L11) off, the tape drops; on, it comes back
      await onStep(page, 1);
      const totIy = goldenOf('C', 'res.tot_iy');
      await expect(tape(page, 'net')).toHaveText(fmt.money(goldenOf('C', 'res.net')));
      const finops = page.locator(WZ.leverRow).filter({ has: page.locator(WZ.lever('L11')) });
      await finops.getByRole('switch').click();
      await expect(finops.getByRole('switch')).not.toBeChecked();
      await expect.poll(() => tapeNumber(page, 'inyear')).toBeCloseTo(expectedInYear('C', totIy, ['L11']), 0);
      await finops.getByRole('switch').click();
      await expect(finops.getByRole('switch')).toBeChecked();
      await expect.poll(() => tapeNumber(page, 'inyear')).toBeCloseTo(totIy, 3);

      // Step 2 Tune: Software (L10), shelfware moved and put back
      await page.locator(WZ.next).click();
      await onStep(page, 2);
      await page.locator(`.gp-wz-chosen ${WZ.lever('L10')}`).click();
      await expect(page.locator(WZ.leverDetail('L10'))).toBeVisible();
      const slider = range(page, SHELF);
      const home = Number(await slider.inputValue());
      await slider.focus();
      for (let i = 0; i < 2; i++) await page.keyboard.press('ArrowRight');
      await expect.poll(() => tapeNumber(page, 'inyear')).toBeGreaterThan(totIy);
      expect(Number(await slider.inputValue())).toBeGreaterThan(home);
      for (let i = 0; i < 2; i++) await page.keyboard.press('ArrowLeft');
      await expect.poll(async () => Number(await slider.inputValue())).toBeCloseTo(home, 9);
      await expect.poll(() => tapeNumber(page, 'inyear')).toBeCloseTo(totIy, 3);
      expect(shelf.step).toBeGreaterThan(0);

      // Step 3 Policy: outside funding moved and restored; at the default share outside equals on-IT
      await page.locator(WZ.next).click();
      await onStep(page, 3);
      await expect(page.locator('[data-testid="wizard-funding"] [data-node="res.tot_ot_out"]')).toContainText(
        fmt.money(goldenOf('C', 'res.tot_ot_all') - goldenOf('C', 'res.tot_ot_it')),
      );
      const out = range(page, OUTSIDE);
      const start = Number(await out.inputValue());
      const dir = start + outside.step! <= outside.max! ? ['ArrowRight', 'ArrowLeft'] : ['ArrowLeft', 'ArrowRight'];
      await out.focus();
      await page.keyboard.press(dir[0]!);
      await expect.poll(async () => Number(await out.inputValue())).not.toBeCloseTo(start, 9);
      await page.keyboard.press(dir[1]!);
      await expect.poll(async () => Number(await out.inputValue())).toBeCloseTo(start, 9);
      await expect
        .poll(() => tapeNumber(page, 'onetime'))
        .toBeCloseTo(goldenOf('C', 'res.tot_ot_it'), 3);

      // Step 4 Result: Find a path from the Next button's screen, then Use this path
      await page.locator(WZ.next).click();
      await onStep(page, 4);
      await expect(page.locator(WZ.next)).toHaveCount(0);
      await page.locator(WZ.find).click();
      const found = page.locator(WZ.found);
      await expect(found).toBeVisible({ timeout: 90_000 });
      await expect(found.locator(`${WZ.moves}[aria-busy="false"]`)).toBeVisible({ timeout: 30_000 });
      await expect(found).toHaveAttribute('data-status', /^(optimal|feasible)$/);
      await expect(found).toContainText('Bar cleared');
      await expect(found.locator('[data-metric="Net"] dd')).toHaveText(fmt.money(demo.net));
      await expect(found.locator('[data-metric="One-time"] dd')).toHaveText(fmt.money(demo.one_time_it));
      await expect(found.locator('[data-metric="Risk exposure"] dd')).toHaveText(fmt.money(demo.risk_exposure));
      const cells = await found
        .locator('li[data-cell]')
        .evaluateAll((els) => els.map((e) => e.getAttribute('data-cell') ?? ''));
      for (const lever of PEOPLE_LEVERS) expect(cellsOfLever(cells, lever), `${lever} untouched`).toEqual([]);

      await page.locator(WZ.use).click();
      await expect(page.getByText('Path applied')).toBeVisible({ timeout: 30_000 });
      await expect(page).not.toHaveURL(new RegExp(`/${presetC}/`));
      await expect(page).toHaveURL(/\/wizard/);
      await onStep(page, 4);
      await expect(scenarioButton(page, presetC)).toHaveAttribute('aria-pressed', 'false');
      // "Everything I changed is now visible": the app is on the solver's scenario, net on the bar
      await expect(tape(page, 'net')).toHaveText(fmt.money(demo.net));
      await expect(page.locator('[data-testid="wizard-risk"] [data-node="br.eps27"]')).toContainText(
        fmt.eps(demoPathEps27()),
      );
      // ...and the moves stay marked in Tune
      await page.locator(WZ.stepButton(2)).click();
      const lever = /^lev\.(L\d+)\./.exec(cells[0]!)?.[1] ?? 'L10';
      await page.locator(WZ.lever(lever)).first().click();
      await expect(page.locator('[data-moved]').first()).toBeVisible();
    } finally {
      await page.close();
    }
  });

  // The tour's `wizard` and `optimize` cards introduce the screen (narrative: `…/wizard?tour=wizard`).
  test('wizard_alt_tour_cards_wizard_and_optimize_introduce_the_build_screen', async ({ browser, stack }) => {
    const presetC = stack.presets.get('C')!.id;
    const page = await browser.newPage();
    await stack.signInPage(page);
    try {
      await page.goto(`/${config.tenant}/${presetC}/wizard?tour=wizard`);
      await expect(page.locator('[data-tour][data-tour-step="wizard"]')).toBeAttached();
      await expect(page.locator(WZ.stepper)).toBeVisible();
      await page.keyboard.press('ArrowRight');
      await expect(page.locator('[data-tour][data-tour-step="optimize"]')).toBeAttached();
      await page.keyboard.press('Escape');
      await expect(page.locator('[data-tour-step]')).toHaveCount(0);
    } finally {
      await page.close();
    }
  });
});
