import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { config, readRepoJson, repoRoot } from '@glidepath/int';
import { fmt } from '@glidepath/ui/format';
import type { Locator, Page } from '@playwright/test';
import { M2_BUDGET_MS, SHOTS } from '../playwright.m2.config';
import { cockpitCell, edits, expectCockpitValue, quoted, scenarioButton, shown } from './cockpit';
import { expect, goldenOf, HEADLINE, test } from './fixtures';

/**
 * INT-03, M2 exit (09 §1) in a browser against the compose stack: the Cockpit of preset C shows
 * the numbers the spec quotes, an edit survives a reload, and every part of the global layer
 * (rail, scenario bar, flight strip, edit popover, trace drawer, ⌘K) works. Black box: the page is
 * reached through `web` (Caddy) like a person's browser, signed in with the INT magic link, and
 * every expected number comes from the spec bundle (`docs/spec/README.md` for the quoted headline,
 * `golden_results.json` for the rest) rendered through the UI's own `fmt`.
 *
 * `INT_COMPOSE_PROJECT=<project> pnpm int:m2 -- --trace off` against a stack that is up and seeded.
 * Screenshots for the status note land in `docs/status/assets/` (both themes).
 */

const STARTED = Date.now();
/** The Cockpit slider and popover that move the bar (spec id, verbatim). */
const TARGET = 'g.target_net';
/** The flight strip's cells (inventory #3) by their spec id. */
const STRIP: Readonly<Record<string, string>> = {
  net: 'res.net',
  bar: 'res.bar',
  gap: 'res.gap',
  risk: 'res.risk',
  eps27: 'br.eps27',
};
/** The eight modules of the rail (contract ids), as the shell lists them. */
const MODULES = [
  'cockpit',
  'baseline',
  'levers',
  'vps',
  'path',
  'market',
  'excel',
  'airlines',
] as const;

interface RegistryVariable {
  id: string;
  label: string;
  min: number | null;
  max: number | null;
  step: number | null;
}
const registry = readRepoJson<{ variables: RegistryVariable[] }>('docs', 'spec', 'variables.json');
const targetDef = registry.variables.find((v) => v.id === TARGET);

const popover = (page: Page) => page.locator('.gp-pop[role="dialog"]');
const drawer = (page: Page) => page.getByRole('dialog', { name: /^Trace · / });
const palette = (page: Page) => page.getByRole('dialog', { name: 'Find any number' });
const rail = (page: Page) => page.getByRole('navigation', { name: 'Modules' });
const strip = (page: Page) => page.locator('[data-hud] [aria-label="Flight strip"]');
const tray = (page: Page) => page.getByRole('dialog', { name: /^Changeset/ });
/** The scenario bar's overflow trigger: Custom and Path scenarios live in its menu. */
const moreScenarios = (page: Page) => page.getByRole('button', { name: /^More scenarios/ });
const barNode = (page: Page) => page.locator('[data-node="res.bar"]');
const numberOf = (l: Locator) => l.getAttribute('data-value').then(Number);
const themeOf = (page: Page) => page.locator('html').getAttribute('data-theme');

/** Printed for the status note. */
const timings: Record<string, number> = {};
const seen: Record<string, Record<string, unknown>> = {};
const shots: string[] = [];

test.describe.configure({ mode: 'serial' });

test.describe('M2 walking skeleton on the compose stack (INT-03)', () => {
  let page: Page;
  let presetC: string;
  let presetA: string;
  /** The fork tier 2 made for the edit of C, as the URL carries it. */
  let fork: string;

  test.beforeAll(async ({ browser, stack }) => {
    presetC = stack.presets.get('C')!.id;
    presetA = stack.presets.get('A')!.id;
    page = await browser.newPage();
    await stack.signInPage(page);
  });
  test.afterAll(async () => {
    await page?.close();
    console.info(`[m2] timings (ms): ${JSON.stringify(timings)}`);
    console.info(`[m2] read on screen: ${JSON.stringify(seen)}`);
    console.info(`[m2] screenshots: ${JSON.stringify(shots)}`);
  });

  test('cockpit_c_shows_the_spec_headline_numbers', async () => {
    const spec = quoted('C');
    const t0 = Date.now();
    await page.goto(`/${config.tenant}/${presetC}/cockpit`);
    await expect(page.getByRole('main', { name: 'Cockpit' })).toBeVisible();
    await expect(scenarioButton(page, presetC)).toHaveAttribute('aria-pressed', 'true');
    // net 119.3, gap −23.7, risk-adjusted 82.0, EPS +0.091, as the spec quotes them
    for (const cell of HEADLINE) {
      await expectCockpitValue(page, cell, spec[cell], `${cell} of C (spec ${spec[cell]})`);
    }
    timings.cockpitHeadline = Date.now() - t0;
    await expect(edits(page)).toHaveAccessibleName('0 edits: open changeset');

    seen.specC = Object.fromEntries(HEADLINE.map((c) => [c, spec[c]]));
    seen.cockpitC = Object.fromEntries(
      await Promise.all(HEADLINE.map(async (c) => [c, await cockpitCell(page, c).innerText()])),
    );
    // the same cells, to the full precision tier 2 pushed: the spec row is the golden row rounded
    for (const cell of HEADLINE) {
      expect(shown[cell](goldenOf('C', cell)), `golden ${cell} reads as the spec's`).toBe(
        shown[cell](spec[cell]),
      );
    }
  });

  test('edits_persist_across_reload', async () => {
    const before = await numberOf(barNode(page));
    // "of $143.0M bar" opens the net target's popover; one registry step up commits an edit.
    // C is locked, so tier 2 forks "Custom (from C)" and the URL follows the fork.
    await barNode(page).click();
    await expect(popover(page)).toBeVisible();
    await expect(popover(page)).toHaveAttribute('aria-label', targetDef!.label);
    const t0 = Date.now();
    await popover(page).getByRole('slider').press('ArrowRight');
    await expect(edits(page)).toHaveAccessibleName('1 edit: open changeset');
    timings.commitFromPopover = Date.now() - t0;
    await page.keyboard.press('Escape');
    await expect(popover(page)).toBeHidden();
    await expect(page).not.toHaveURL(new RegExp(presetC));
    await expect.poll(() => numberOf(barNode(page))).toBeGreaterThan(before);

    const url = page.url();
    fork = url.split('/').at(-2)!;
    const edited = {
      bar: await numberOf(barNode(page)),
      net: await cockpitCell(page, 'res.net').innerText(),
      gap: await cockpitCell(page, 'res.gap').innerText(),
      risk: await cockpitCell(page, 'res.risk').innerText(),
      target: await page
        .locator(`[data-variable-id="${TARGET}"] input[type="range"]`)
        .first()
        .inputValue(),
    };
    expect(Number(edited.target)).toBe(targetDef!.min! + targetDef!.step! * 11); // 100 + one step
    seen.fork = { ...edited, scenario: fork };

    // reload: the same URL comes back from tier 3 with the edit, its count and its numbers
    const t1 = Date.now();
    await page.reload();
    await expect(page.getByRole('main', { name: 'Cockpit' })).toBeVisible();
    await expect(page).toHaveURL(url);
    await expect(edits(page)).toHaveAccessibleName('1 edit: open changeset');
    // the fork is the selected scenario: a custom scenario lives in the bar's overflow menu
    await expect(moreScenarios(page)).toHaveAttribute('data-active', 'true');
    await expect(moreScenarios(page)).toHaveAccessibleName(
      new RegExp(`^More scenarios, Custom \\(from C\\)( \\d+)? selected$`),
    );
    await moreScenarios(page).click();
    await expect(page.locator(`[role="menuitemradio"][data-scenario="${fork}"]`)).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await page.keyboard.press('Escape');
    await expect.poll(() => numberOf(barNode(page))).toBe(edited.bar);
    timings.reload = Date.now() - t1;
    expect(await cockpitCell(page, 'res.net').innerText()).toBe(edited.net);
    expect(await cockpitCell(page, 'res.gap').innerText()).toBe(edited.gap);
    expect(await cockpitCell(page, 'res.risk').innerText()).toBe(edited.risk);
    await expect(
      page.locator(`[data-variable-id="${TARGET}"] input[type="range"]`).first(),
    ).toHaveValue(edited.target);

    // the changeset is in the tray after the reload too (one row, the target's label)
    await edits(page).click();
    await expect(
      tray(page).getByRole('list', { name: 'Changes' }).getByRole('listitem'),
    ).toHaveCount(1);
    await expect(tray(page).getByRole('listitem').first()).toContainText(targetDef!.label);
    await page.keyboard.press('Escape');

    // the locked preset is untouched: still 0 edits and still the numbers the spec quotes
    const spec = quoted('C');
    await page.goto(`/${config.tenant}/${presetC}/cockpit`);
    await expect(edits(page)).toHaveAccessibleName('0 edits: open changeset');
    for (const cell of HEADLINE) {
      await expectCockpitValue(page, cell, spec[cell], `${cell} of C after the fork`);
    }
  });

  test('global_layer_works_rail_scenario_bar_flight_strip_edit_popover_trace_drawer_cmdk', async () => {
    // rail: the eight modules, the tenant monogram (never a logo), routing without a reload
    await expect(rail(page)).toBeVisible();
    for (const id of MODULES) {
      await expect(rail(page).locator(`a[data-item="${id}"]`), `rail has ${id}`).toBeVisible();
    }
    await expect(rail(page).locator('a[data-item="cockpit"]')).toHaveAttribute(
      'aria-current',
      'page',
    );
    const tenantButton = rail(page).getByRole('button', { name: /switch airline$/ });
    await expect(tenantButton).toBeVisible();
    await expect(tenantButton.locator('[data-monogram]')).toHaveText(config.tenant.toUpperCase());
    await expect(strip(page)).toBeHidden(); // Cockpit has the same numbers as its hero
    await rail(page).locator('a[data-item="baseline"]').click();
    await expect(page).toHaveURL(new RegExp(`/${presetC}/baseline$`));
    await expect(rail(page).locator('a[data-item="baseline"]')).toHaveAttribute(
      'aria-current',
      'page',
    );

    // flight strip: visible off Cockpit, its five cells are the session's cells for C
    await expect(strip(page)).toBeVisible();
    for (const [slot, cell] of Object.entries(STRIP)) {
      const value = goldenOf('C', cell);
      const want = cell === 'res.gap' ? shown['res.gap'](value) : undefined;
      await expect(
        page.locator(`[data-hud] [data-cell="${slot}"]`),
        `strip ${slot} = ${cell}`,
      ).toContainText(want ?? (cell === 'br.eps27' ? fmt.eps(value) : fmt.money(value)));
    }
    seen.strip = Object.fromEntries(
      await Promise.all(
        Object.keys(STRIP).map(async (slot) => [
          slot,
          await page.locator(`[data-hud] [data-cell="${slot}"]`).innerText(),
        ]),
      ),
    );

    // scenario bar: switching to preset A moves the URL, the session and every bound number
    await page.goto(`/${config.tenant}/${presetC}/cockpit`);
    const specA = quoted('A');
    const t0 = Date.now();
    await scenarioButton(page, presetA).click();
    await expect(page).toHaveURL(new RegExp(`/${presetA}/cockpit`));
    await expect(scenarioButton(page, presetA)).toHaveAttribute('aria-pressed', 'true');
    for (const cell of HEADLINE) {
      await expectCockpitValue(page, cell, specA[cell], `${cell} of A (spec ${specA[cell]})`);
    }
    timings.scenarioSwitch = Date.now() - t0;
    seen.specA = Object.fromEntries(HEADLINE.map((c) => [c, specA[c]]));

    // edit popover: the registry definition of the net target, closed again without an edit
    await barNode(page).click();
    await expect(popover(page)).toBeVisible();
    const slider = popover(page).getByRole('slider');
    await expect(slider).toHaveAttribute('min', String(targetDef!.min));
    await expect(slider).toHaveAttribute('max', String(targetDef!.max));
    await expect(slider).toHaveAttribute('step', String(targetDef!.step));
    await page.keyboard.press('Escape');
    await expect(popover(page)).toBeHidden();
    await expect(edits(page)).toHaveAccessibleName('0 edits: open changeset');

    // trace drawer: the hero net opens tier 2's explanation of res.net
    const t1 = Date.now();
    await cockpitCell(page, 'res.net').click();
    await expect(drawer(page)).toBeVisible();
    await expect(drawer(page).locator('[data-slot="node-id"]')).toHaveText('res.net');
    await expect(drawer(page).locator('[data-slot="formula"]')).not.toBeEmpty();
    await expect(
      drawer(page).locator('[data-slot="upstream"] [data-node-id]').first(),
    ).toBeVisible();
    timings.traceDrawer = Date.now() - t1;
    seen.trace = {
      value: await drawer(page).locator('[data-slot="value"]').innerText(),
      formula: await drawer(page).locator('[data-slot="formula"]').innerText(),
      upstream: await drawer(page).locator('[data-slot="upstream"] [data-node-id]').count(),
    };
    await drawer(page).getByRole('button', { name: 'Close' }).click();
    await expect(drawer(page)).toBeHidden();

    // ⌘K: the shell's button and the shortcut open it; tier 2 ranks the hit for a spec id
    await page.getByRole('button', { name: /Find any number/ }).click();
    await expect(palette(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(palette(page)).toBeHidden();
    const t2 = Date.now();
    await page.keyboard.press('Control+k');
    await expect(palette(page)).toBeVisible();
    await palette(page).getByRole('combobox').fill(TARGET);
    await expect(palette(page).locator(`[role="option"][data-id="${TARGET}"]`)).toBeVisible();
    timings.palette = Date.now() - t2;
    await page.keyboard.press('Escape');
    await expect(palette(page)).toBeHidden();
  });

  test('cockpit_c_screenshots_in_both_themes', async () => {
    const spec = quoted('C');
    mkdirSync(join(repoRoot, ...SHOTS), { recursive: true });
    await page.goto(`/${config.tenant}/${presetC}/cockpit`);
    await expect(page.getByRole('main', { name: 'Cockpit' })).toBeVisible();

    for (const theme of ['cruise', 'daylight'] as const) {
      if ((await themeOf(page)) !== theme) {
        await page.getByRole('button', { name: /^Theme / }).click();
      }
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      // the numbers are the spec's in both themes (the theme is presentation only)
      for (const cell of HEADLINE) {
        await expectCockpitValue(page, cell, spec[cell], `${cell} of C in ${theme}`);
      }
      const file = join(repoRoot, ...SHOTS, `cockpit-c-${theme}-1440.jpg`);
      await page.screenshot({
        path: file,
        type: 'jpeg',
        quality: 80,
        fullPage: true, // the whole Cockpit, down to the Shareholder tile's EPS
        animations: 'disabled',
      });
      shots.push(file.slice(repoRoot.length + 1));
    }
    expect(shots).toHaveLength(2);
  });

  test('m2_suite_finishes_within_its_budget', () => {
    timings.suite = Date.now() - STARTED;
    expect(timings.suite).toBeLessThan(M2_BUDGET_MS);
  });
});
