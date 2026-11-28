import { config } from '@glidepath/int';
import { fmt } from '@glidepath/ui/format';
import type { Page } from '@playwright/test';
import { specProse } from '../src/storyline';
import { TOUR_CHAPTER_STEPS, TOUR_STEP_SPECS, WZ } from '../src/wizard';
import { edits } from './cockpit';
import { expect, goldenOf, test } from './fixtures';

/**
 * WIZ-11: the walkthrough tour in a browser against the compose stack (`docs/ux/07_wizard_tour_plan.md` §4, §6).
 * Start, Next / Back / Esc, the anchor of every one of the 24 steps found on its own screen, the
 * `?tour=` deep link, and the plan's promises: it never auto-starts and never writes. Steps, screens and
 * anchors are the plan's table (`src/wizard.ts` keeps it, and its unit test pins it to the app's source);
 * numbers on the cards come from the spec bundle through the UI's `fmt`.
 *
 * `INT_COMPOSE_PROJECT=<project> pnpm e2e:wizard -- --trace off`.
 */

const COUNT = TOUR_STEP_SPECS.length;
const tour = (page: Page) => page.locator('[data-tour-step]');
const card = (page: Page) => page.locator('[data-tour-card]');
const counter = (page: Page) => page.locator('.gp-tour-count');
const stepIs = (page: Page, id: string) => expect(page.locator(`[data-tour][data-tour-step="${id}"]`)).toBeAttached();
const where = (page: Page): string => new URL(page.url()).pathname.split('/')[3] ?? '';
const scenarioOf = (page: Page): string => new URL(page.url()).pathname.split('/')[2] ?? '';

async function open(page: Page, scenario: string, module: string, search = ''): Promise<void> {
  await page.goto(`/${config.tenant}/${scenario}/${module}${search}`);
  // A `?tour=` deep link may move the viewer to the step's own screen straight away; the caller
  // asserts the step and screen (stepIs / where), so the landing screen is not asserted here.
  if (search.includes('tour=')) return;
  await expect(page.getByRole('navigation', { name: 'Modules' }).locator(`a[data-item="${module}"]`)).toHaveAttribute(
    'aria-current',
    'page',
  );
}

test.describe.configure({ mode: 'default' });

test.describe('Walkthrough tour (WIZ-11)', () => {
  let page: Page;
  let presetC: string;

  test.beforeAll(async ({ browser, stack }) => {
    presetC = stack.presets.get('C')!.id;
    page = await browser.newPage();
    await stack.signInPage(page);
  });
  test.afterAll(async () => {
    await page?.close();
  });

  test('never_auto_starts_and_the_tour_button_waits_with_a_dot_until_seen', async ({ browser, stack }) => {
    const fresh = await browser.newPage(); // a new context: nothing seen yet
    try {
      await stack.signInPage(fresh);
      await open(fresh, presetC, 'cockpit');
      await expect(fresh.locator('[data-tour-button]')).toBeVisible();
      await expect(fresh.locator('[data-tour-button]')).toHaveAccessibleName('Tour: start the walkthrough');
      await expect(fresh.locator('[data-tour-button]')).not.toHaveAttribute('data-tour-seen', '');
      await fresh.waitForTimeout(1500); // it would have opened by now
      await expect(tour(fresh)).toHaveCount(0);
    } finally {
      await fresh.context().close();
    }
  });

  test('start_shows_step_1_on_the_cockpit_with_the_bar_from_tier_2', async () => {
    await open(page, presetC, 'cockpit');
    await page.locator('[data-tour-button]').click();
    await stepIs(page, 'bar');
    await expect(tour(page)).not.toHaveAttribute('data-tour-missing', '');
    await expect(counter(page)).toHaveText(`1 / ${COUNT}`);
    await expect(card(page)).toHaveAttribute('role', 'dialog');
    await expect(card(page).getByRole('heading', { name: 'The bar' })).toBeVisible();
    await expect(page.locator('[data-tour-spotlight]')).toBeVisible();
    await expect(page.locator('[data-tour-back]')).toBeDisabled();
    await expect(page.locator('[data-tour-next]')).toBeFocused();
    // numbers only through placeholders: tier 2's net, bar, target and growth, formatted by the UI
    const prose = specProse();
    await expect(card(page)).toContainText(fmt.money(goldenOf('C', 'res.net')));
    await expect(card(page)).toContainText(fmt.money(prose.bar.value));
    await expect(card(page)).toContainText(fmt.money(goldenOf('C', 'res.target')));
    await expect(card(page)).toContainText(fmt.money(prose.growth.value));
    // the spotlight leaves the highlighted element clickable
    await expect(page.locator('[data-tour-spotlight]')).toHaveCSS('pointer-events', 'none');
  });

  test('next_back_enter_and_arrow_keys_move_between_steps_and_screens', async () => {
    await open(page, presetC, 'cockpit');
    await page.locator('[data-tour-button]').click();
    await stepIs(page, 'bar');
    await page.locator('[data-tour-next]').click();
    await stepIs(page, 'baseline'); // the tour takes the viewer to the Baseline screen by itself
    await expect(counter(page)).toHaveText(`2 / ${COUNT}`);
    expect(where(page)).toBe('baseline');
    await expect(card(page)).toContainText(fmt.pct(specProse().lockedPct.value / 100));
    await page.locator('[data-tour-back]').click();
    await stepIs(page, 'bar');
    expect(where(page)).toBe('cockpit');
    await page.keyboard.press('ArrowRight');
    await stepIs(page, 'baseline');
    await page.keyboard.press('ArrowRight');
    await stepIs(page, 'rates');
    await page.keyboard.press('ArrowLeft');
    await stepIs(page, 'baseline');
    await expect(counter(page)).toHaveText(`2 / ${COUNT}`);
  });

  test('tab_stays_inside_the_card', async () => {
    await open(page, presetC, 'cockpit');
    await page.locator('[data-tour-button]').click();
    await stepIs(page, 'bar');
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => document.activeElement?.closest('[data-tour-card]') !== null)).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(tour(page)).toHaveCount(0);
  });

  test('escape_leaves_the_page_as_it_was_and_marks_the_tour_seen', async () => {
    await open(page, presetC, 'cockpit');
    await page.locator('[data-tour-button]').click();
    await stepIs(page, 'bar');
    await page.keyboard.press('ArrowRight');
    await stepIs(page, 'baseline');
    const url = page.url();
    await page.keyboard.press('Escape');
    await expect(tour(page)).toHaveCount(0);
    expect(page.url()).toBe(url); // stays on the screen it is on
    await expect(page.locator('[data-tour-button]')).toHaveAttribute('data-tour-seen', '');
    // a later click starts again at step 1
    await page.locator('[data-tour-button]').click();
    await stepIs(page, 'bar');
    await expect(counter(page)).toHaveText(`1 / ${COUNT}`);
    await page.locator('[data-tour-card]').getByRole('button', { name: 'Skip' }).click();
    await expect(tour(page)).toHaveCount(0);
  });

  test('every_step_finds_its_anchor_on_its_own_screen_and_the_tour_writes_nothing', async () => {
    await open(page, presetC, 'cockpit');
    await page.locator('[data-tour-button]').click();
    let screen = 'cockpit';
    for (const [i, spec] of TOUR_STEP_SPECS.entries()) {
      await stepIs(page, spec.id);
      await expect(counter(page), spec.id).toHaveText(`${i + 1} / ${COUNT}`);
      await expect(tour(page), `${spec.id}: the anchor appeared`).not.toHaveAttribute('data-tour-missing', '');
      if (spec.module) screen = spec.module;
      expect(where(page), `${spec.id} is on its screen`).toBe(screen);
      if (spec.anchor) {
        await expect(page.locator(spec.anchor).first(), `${spec.id}: ${spec.anchor}`).toBeVisible();
        await expect(page.locator('[data-tour-spotlight]'), spec.id).toBeVisible();
      }
      if (i < COUNT - 1) await page.locator('[data-tour-next]').click();
    }
    await expect(page.locator('[data-tour-next]')).toHaveText('Done'); // the last step
    await page.locator('[data-tour-next]').click();
    await expect(tour(page)).toHaveCount(0);
    await expect(page.locator('[data-tour-button]')).toHaveAttribute('data-tour-seen', '');
    // never writes, never switches scenario: still locked preset C with no edits
    expect(scenarioOf(page)).toBe(presetC);
    await expect(edits(page)).toHaveAccessibleName('0 edits: open changeset');
  });

  test('wizard_deep_link_opens_the_tour_at_build_a_plan', async () => {
    await open(page, presetC, 'wizard', '?tour=wizard');
    await stepIs(page, 'wizard');
    await expect(counter(page)).toHaveText(`${TOUR_STEP_SPECS.findIndex((s) => s.id === 'wizard') + 1} / ${COUNT}`);
    await expect(page.locator(WZ.stepper)).toBeVisible();
    await expect(page.locator('[data-tour-spotlight]')).toBeVisible();
    await expect(tour(page)).not.toHaveAttribute('data-tour-missing', '');
    expect(where(page)).toBe('wizard');
    // the wizard is still usable under the tour: Next reaches the Optimize step on the tape
    await page.keyboard.press('ArrowRight');
    await stepIs(page, 'optimize');
    await expect(page.locator(WZ.tapeFind)).toBeVisible();
    await page.keyboard.press('ArrowRight');
    await stepIs(page, 'restart'); // any screen: stays on the wizard
    expect(where(page)).toBe('wizard');
    await expect(page.locator('[data-tour-button]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(tour(page)).toHaveCount(0);
  });

  test('deep_link_takes_other_screens_and_chapters_and_ignores_unknown_names', async () => {
    // from a screen the step is not on, the tour moves the viewer there
    await open(page, presetC, 'cockpit', '?tour=wizard');
    await stepIs(page, 'wizard');
    expect(where(page)).toBe('wizard');
    await page.keyboard.press('Escape');
    for (const [chapter, id] of Object.entries(TOUR_CHAPTER_STEPS)) {
      await open(page, presetC, 'cockpit', `?tour=${chapter}`);
      await stepIs(page, id);
      await page.keyboard.press('Escape');
      await expect(tour(page)).toHaveCount(0);
    }
    // a step id works too
    await open(page, presetC, 'cockpit', '?tour=market');
    await stepIs(page, 'market');
    expect(where(page)).toBe('market');
    await page.keyboard.press('Escape');
    // unknown names do nothing
    await open(page, presetC, 'cockpit', '?tour=nonsense');
    await page.waitForTimeout(1000);
    await expect(tour(page)).toHaveCount(0);
    await expect(edits(page)).toHaveAccessibleName('0 edits: open changeset');
  });
});
