import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { chromium, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { config, readRepoJson } from '@glidepath/int';
import { THEME_STORAGE_KEY, type ThemeName } from '@glidepath/ui/tokens';
import puppeteer from 'puppeteer-core';
import { snapshot } from 'lighthouse';
import {
  A11Y_MODULES,
  A11Y_THEMES,
  LIGHTHOUSE_A11Y_MIN,
  LIGHTHOUSE_MODULES,
  blocking,
  describeViolation,
  failedA11yAudits,
  lighthousePercent,
  type LighthouseResultLike,
} from '../src/a11y';
import { edits } from '../tests/cockpit';
import { expect, test } from '../tests/fixtures';

/**
 * QA-07, G12: accessibility checks against the compose stack, signed in like the smoke.
 *
 * 1. `axe_each_module_in_both_themes_has_zero_serious_violations`: axe-core (all rules, real layout,
 *    so colour contrast is measured) on every module in Cruise and Daylight, on locked preset C, once
 *    the module has loaded its numbers; plus Cockpit with each overlay open.
 * 2. `lighthouse_accessibility_at_least_95_on_cockpit_levers_path`: Lighthouse (snapshot mode, the
 *    accessibility category) of the loaded Cockpit, Levers and Path, in both themes.
 * 3. `keyboard_paths_*`: slider, dial, ownership dividers, palette and drawer reached with Tab and
 *    driven with the keys the component inventory names.
 *
 * Reduced motion is emulated for axe (the app then switches the number roll and transitions off, so
 * colours are measured at rest, not mid-transition); Lighthouse and the keyboard paths run with the
 * default motion setting.
 */

/** The Cockpit slider that moves `res.target`; the Market dial and the VPs' share variable (spec ids). */
const TARGET = 'g.target_net';
const SHARE_VAR = 'org.dom_share';
interface RegistryVariable {
  id: string;
  min: number | null;
  max: number | null;
  step: number | null;
}
const registry = readRepoJson<{ variables: RegistryVariable[] }>('docs', 'spec', 'variables.json');
const def = (id: string): RegistryVariable => {
  const v = registry.variables.find((x) => x.id === id);
  if (!v) throw new Error(`registry has no ${id}`);
  return v;
};

const route = (preset: string, module: string) => `/${config.tenant}/${preset}/${module}`;

/** Every theme the page can start in: the app reads the viewer's choice from storage at startup. */
const themeInit = (theme: ThemeName) => ({
  script: ([key, value]: [string, string]) => {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      /* storage unavailable: the default theme applies */
    }
  },
  arg: [THEME_STORAGE_KEY, theme] as [string, string],
});

/**
 * The screen has drawn its numbers: no skeleton and no busy region left in the app, the web fonts
 * are in, and the module's own landmark (or the module root) is on screen.
 */
async function settled(page: Page, theme: ThemeName): Promise<void> {
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await expect(page.locator('main, [data-module]').first()).toBeVisible();
  await expect(page.locator('#root .gp-skel, #root [aria-busy="true"]')).toHaveCount(0, {
    timeout: 30_000,
  });
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  // the numbers, charts and glass settle one frame after their data
  await page.evaluate(
    () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
  );
}

async function openModule(
  page: Page,
  preset: string,
  module: string,
  theme: ThemeName,
): Promise<void> {
  await page.goto(route(preset, module));
  await expect(page).toHaveURL(new RegExp(`/${module}$`));
  await settled(page, theme);
}

/** Presses Tab until `target` has focus (a keyboard user's way in); fails if it is never reached. */
async function tabTo(page: Page, target: Locator, max = 200): Promise<number> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  for (let i = 1; i <= max; i += 1) {
    await page.keyboard.press('Tab');
    if (await target.evaluate((el) => el === document.activeElement).catch(() => false)) return i;
  }
  throw new Error(`Tab did not reach ${String(target)} in ${max} presses`);
}

/** True while focus is inside `scope` (the dialog traps Tab). */
const focusIn = (scope: Locator) => scope.evaluate((el) => el.contains(document.activeElement));

/** The focused element draws a visible focus indicator (outline or ring) on it or its control wrapper. */
const hasFocusIndicator = (target: Locator) =>
  target.evaluate((el) => {
    const drawn = (e: Element) => {
      const s = getComputedStyle(e);
      const outline = s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0;
      const ring = s.boxShadow !== 'none';
      return outline || ring;
    };
    return drawn(el) || (el.parentElement ? drawn(el.parentElement) : false);
  });

test.describe('QA-07 accessibility (G12)', () => {
  test.describe('axe_each_module_in_both_themes_has_zero_serious_violations', () => {
    const pages = new Map<ThemeName, Page>();
    let presetC: string;

    test.beforeAll(async ({ browser, stack }) => {
      presetC = stack.presets.get('C')!.id;
      for (const theme of A11Y_THEMES) {
        // AxeBuilder needs a page that belongs to an explicit context
        const page = await (await browser.newContext()).newPage();
        await stack.signInPage(page);
        const init = themeInit(theme);
        await page.addInitScript(init.script, init.arg);
        await page.emulateMedia({ reducedMotion: 'reduce' });
        pages.set(theme, page);
      }
    });
    test.afterAll(async () => {
      for (const page of pages.values()) await page.context().close();
    });

    /** axe on the whole page, every rule; the run prints what it did not count as a failure. */
    async function expectNoSeriousViolations(page: Page, what: string): Promise<void> {
      const results = await new AxeBuilder({ page }).analyze();
      const minor = results.violations.filter((v) => !blocking([v]).length);
      process.stdout.write(
        `  axe ${what}: ${results.passes.length} rules passed, ${results.violations.length} violations` +
          ` (${minor.length} below serious), ${results.incomplete.length} for review\n`,
      );
      for (const v of minor) process.stdout.write(`    below serious: ${describeViolation(v)}\n`);
      expect(results.passes.length, `${what}: axe ran its rules`).toBeGreaterThan(10);
      expect(
        blocking(results.violations).map((v) => describeViolation(v)),
        what,
      ).toEqual([]);
    }

    for (const theme of A11Y_THEMES) {
      for (const module of A11Y_MODULES) {
        test(`${module}_${theme}`, async () => {
          const page = pages.get(theme)!;
          await openModule(page, presetC, module, theme);
          await expectNoSeriousViolations(page, `${module} (${theme})`);
        });
      }
    }

    for (const theme of A11Y_THEMES) {
      test(`cockpit_${theme}_with_each_overlay_open`, async () => {
        const page = pages.get(theme)!;
        await openModule(page, presetC, 'cockpit', theme);

        // the edit popover on the net target ("of $X bar")
        await page.locator('[data-node="res.bar"]').click();
        const popover = page.locator('.gp-pop[role="dialog"]');
        await expect(popover).toBeVisible();
        await expectNoSeriousViolations(page, `cockpit edit popover (${theme})`);
        await page.keyboard.press('Escape');
        await expect(popover).toBeHidden();

        // the trace drawer (hero number)
        await page.locator('[data-testid="cockpit-net"] .gp-cockpit-hero-value').click();
        const drawer = page.getByRole('dialog', { name: /^Trace · / });
        await expect(drawer).toBeVisible();
        await expect(drawer.locator('[data-slot="upstream"] [data-node-id]').first()).toBeVisible();
        await page.evaluate(() => new Promise<void>((r) => setTimeout(r, 400))); // slide-in done
        await expectNoSeriousViolations(page, `cockpit trace drawer (${theme})`);
        await drawer.getByRole('button', { name: 'Close' }).click();
        await expect(drawer).toBeHidden();

        // the changeset tray
        await edits(page).click();
        const tray = page.getByRole('dialog', { name: /^Changeset/ });
        await expect(tray).toBeVisible();
        await expectNoSeriousViolations(page, `cockpit changeset tray (${theme})`);
        await page.keyboard.press('Escape');
        await expect(tray).toBeHidden();

        // the command palette with results
        await page.keyboard.press('Control+k');
        const palette = page.getByRole('dialog', { name: 'Find any number' });
        await expect(palette).toBeVisible();
        await palette.getByRole('combobox').fill('net');
        await expect(palette.locator('[role="option"]').first()).toBeVisible();
        await expectNoSeriousViolations(page, `command palette (${theme})`);
        await page.keyboard.press('Escape');
        await expect(palette).toBeHidden();
      });
    }
  });

  test.describe('axe_wizard_steps_and_tour_open_have_zero_serious_violations', () => {
    const pages = new Map<ThemeName, Page>();
    let presetC: string;

    test.beforeAll(async ({ browser, stack }) => {
      presetC = stack.presets.get('C')!.id;
      for (const theme of A11Y_THEMES) {
        const page = await (await browser.newContext()).newPage();
        await stack.signInPage(page);
        const init = themeInit(theme);
        await page.addInitScript(init.script, init.arg);
        await page.emulateMedia({ reducedMotion: 'reduce' });
        pages.set(theme, page);
      }
    });
    test.afterAll(async () => {
      for (const page of pages.values()) await page.context().close();
    });

    async function noSerious(page: Page, what: string): Promise<void> {
      const results = await new AxeBuilder({ page }).analyze();
      const minor = results.violations.filter((v) => !blocking([v]).length);
      process.stdout.write(
        `  axe ${what}: ${results.passes.length} rules passed, ${results.violations.length} violations` +
          ` (${minor.length} below serious), ${results.incomplete.length} for review\n`,
      );
      for (const v of minor) process.stdout.write(`    below serious: ${describeViolation(v)}\n`);
      expect(results.passes.length, `${what}: axe ran its rules`).toBeGreaterThan(10);
      expect(
        blocking(results.violations).map((v) => describeViolation(v)),
        what,
      ).toEqual([]);
    }

    for (const theme of A11Y_THEMES) {
      test(`wizard_steps_2_to_4_${theme}`, async () => {
        const page = pages.get(theme)!;
        await openModule(page, presetC, 'wizard', theme);
        for (const n of [2, 3, 4]) {
          await page.locator(`.gp-wz-step[data-step="${n}"]`).click();
          await expect(page.locator(`[data-wizard-step="${n}"]`)).toBeVisible();
          await settled(page, theme);
          await noSerious(page, `wizard step ${n} (${theme})`);
        }
      });

      for (const module of ['cockpit', 'wizard']) {
        test(`tour_open_on_${module}_${theme}`, async () => {
          const page = pages.get(theme)!;
          await openModule(page, presetC, module, theme);
          await page.locator('[data-tour-button]').click();
          await expect(page.locator('[data-tour-card]')).toBeVisible();
          if (module === 'wizard') {
            // step 12 of the tour lives on the wizard
            while ((await page.locator('[data-tour]').getAttribute('data-tour-step')) !== 'wizard') {
              await page.locator('[data-tour-next]').click();
            }
            await expect(page.locator('[data-tour-spotlight]')).toBeVisible();
          }
          await page.evaluate(() => new Promise<void>((r) => setTimeout(r, 400)));
          await noSerious(page, `tour open on ${module} (${theme})`);
          await page.keyboard.press('Escape');
          await expect(page.locator('[data-tour-card]')).toBeHidden();
        });
      }
    }
  });

  test.describe('lighthouse_accessibility_at_least_95_on_cockpit_levers_path', () => {
    let context: BrowserContext;
    let userDataDir: string;
    let presetC: string;
    let port: number;

    test.beforeAll(async ({ stack }) => {
      presetC = stack.presets.get('C')!.id;
      // a free port for the DevTools endpoint Lighthouse's driver attaches to
      port = await new Promise<number>((resolve, reject) => {
        const srv = createServer();
        srv.once('error', reject);
        srv.listen(0, '127.0.0.1', () => {
          const { port: p } = srv.address() as { port: number };
          srv.close(() => resolve(p));
        });
      });
      userDataDir = mkdtemp();
      context = await chromium.launchPersistentContext(userDataDir, {
        executablePath: process.env.GP_A11Y_CHROMIUM || undefined,
        headless: true,
        ignoreHTTPSErrors: true,
        viewport: { width: 1440, height: 900 },
        args: [`--remote-debugging-port=${port}`, '--no-sandbox'],
      });
      const seed = await context.newPage();
      await stack.signInPage(seed);
      await seed.close();
    });
    test.afterAll(async () => {
      await context?.close();
      if (userDataDir) rmSync(userDataDir, { recursive: true, force: true });
    });

    for (const theme of A11Y_THEMES) {
      for (const module of LIGHTHOUSE_MODULES) {
        test(`${module}_${theme}`, async () => {
          const page = await context.newPage();
          const init = themeInit(theme);
          await page.addInitScript(init.script, init.arg);
          try {
            await openModule(page, presetC, module, theme);
            // Lighthouse's driver (puppeteer) attaches to the same browser over its DevTools port and
            // audits the page as the person sees it, numbers drawn.
            const browser = await puppeteer.connect({
              browserURL: `http://127.0.0.1:${port}`,
              defaultViewport: null,
            });
            try {
              const url = page.url();
              const target = (await browser.pages()).find((p) => p.url() === url);
              if (!target) throw new Error(`Lighthouse driver cannot see ${url}`);
              const run = await snapshot(target, {
                config: {
                  extends: 'lighthouse:default',
                  settings: {
                    onlyCategories: ['accessibility'],
                    formFactor: 'desktop',
                    screenEmulation: { disabled: true },
                    disableFullPageScreenshot: true,
                  },
                },
              });
              const lhr = run?.lhr as unknown as LighthouseResultLike | undefined;
              if (!lhr) throw new Error('Lighthouse returned no result');
              const score = lighthousePercent(lhr.categories.accessibility?.score);
              const failed = failedA11yAudits(lhr);
              process.stdout.write(
                `  lighthouse ${module} (${theme}): accessibility ${score}` +
                  `${failed.length ? `; not passing: ${failed.join('; ')}` : ''}\n`,
              );
              expect(score, `${module} (${theme}) ${failed.join('; ')}`).toBeGreaterThanOrEqual(
                LIGHTHOUSE_A11Y_MIN,
              );
            } finally {
              await browser.disconnect();
            }
          } finally {
            await page.close();
          }
        });
      }
    }
  });

  test.describe('keyboard_paths_slider_dial_ownership_dividers_palette_drawer', () => {
    test.describe.configure({ mode: 'serial' });
    let page: Page;
    let presetC: string;

    test.beforeAll(async ({ browser, stack }) => {
      presetC = stack.presets.get('C')!.id;
      page = await browser.newPage();
      await stack.signInPage(page);
    });
    test.afterAll(async () => {
      await page.close();
    });

    test('slider_reached_by_tab_moves_with_arrows_home_end', async () => {
      const { min, max, step } = def(TARGET);
      await openModule(page, presetC, 'cockpit', 'cruise');
      const slider = page.locator(`[data-variable-id="${TARGET}"] input[type="range"]`);
      await expect(slider).toHaveAccessibleName(/\S/);
      const presses = await tabTo(page, slider);
      process.stdout.write(`  slider ${TARGET}: reached with ${presses} Tab presses\n`);
      expect(await hasFocusIndicator(slider), 'focus indicator on the slider').toBe(true);

      const value = async () => Number(await slider.inputValue());
      const from = await value();
      await page.keyboard.press('ArrowLeft');
      await expect.poll(value).toBeCloseTo(from - step!, 6);
      // a preset is locked: the first edit forked it, the slider on screen is the fork's
      await expect(edits(page)).toHaveAccessibleName('1 edit: open changeset');
      await expect(page).not.toHaveURL(new RegExp(presetC));
      await slider.focus();
      await page.keyboard.press('ArrowRight');
      await expect.poll(value).toBeCloseTo(from, 6);
      await page.keyboard.press('Home');
      await expect.poll(value).toBeCloseTo(min!, 6);
      await page.keyboard.press('End');
      await expect.poll(value).toBeCloseTo(max!, 6);
    });

    test('dial_reached_by_tab_moves_with_arrows_home_end', async () => {
      await openModule(page, presetC, 'market', 'cruise');
      const dial = page.locator('.gp-dial [role="slider"]').first();
      const id = await dial
        .locator('xpath=ancestor::*[@data-variable-id][1]')
        .getAttribute('data-variable-id');
      const { min, max, step } = def(id!);
      await expect(dial).toHaveAccessibleName(/\S/);
      const presses = await tabTo(page, dial);
      process.stdout.write(`  dial ${id}: reached with ${presses} Tab presses\n`);
      expect(await hasFocusIndicator(dial), 'focus indicator on the dial').toBe(true);

      // the dial snaps to the registry's grid: from an off-grid value one key press lands on the next
      // grid value in that direction, never further than one step away
      const now = async () => Number(await dial.getAttribute('aria-valuenow'));
      const from = await now();
      await page.keyboard.press('ArrowUp');
      await expect.poll(now).toBeGreaterThan(from);
      const up = await now();
      expect(up - from).toBeLessThanOrEqual(step! * 1.5);
      const k = (up - min!) / step!;
      expect(Math.abs(k - Math.round(k)), 'on the registry grid').toBeLessThan(1e-6);
      await expect(edits(page)).toHaveAccessibleName('1 edit: open changeset');
      // the commit forked the preset: the dial on screen is the fork's
      const again = page.locator('.gp-dial [role="slider"]').first();
      const nowAgain = async () => Number(await again.getAttribute('aria-valuenow'));
      await again.focus();
      await page.keyboard.press('ArrowDown');
      await expect.poll(nowAgain).toBeCloseTo(up - step!, 6);
      await page.keyboard.press('Home');
      await expect.poll(nowAgain).toBeCloseTo(min!, 6);
      await page.keyboard.press('End');
      await expect.poll(nowAgain).toBeCloseTo(max!, 6);
    });

    test('ownership_dividers_reached_by_tab_move_in_registry_steps', async () => {
      const step = Math.round(def(SHARE_VAR).step! * 100);
      await openModule(page, presetC, 'vps', 'cruise');
      const row = page.locator('.gp-vps-row').first();
      const dividers = row.getByRole('slider');
      expect(await dividers.count(), 'n VPs have n - 1 dividers').toBeGreaterThanOrEqual(2);
      const first = dividers.first();
      await expect(first).toHaveAccessibleName(/\S/);
      const presses = await tabTo(page, first);
      process.stdout.write(`  ownership divider: reached with ${presses} Tab presses\n`);
      expect(await hasFocusIndicator(first), 'focus indicator on the divider').toBe(true);

      const pos = async (d: Locator) => Number(await d.getAttribute('aria-valuenow'));
      const text = (d: Locator) => d.getAttribute('aria-valuetext');
      const from = await pos(first);
      const textBefore = await text(first);
      // Tab moves between the dividers of the row, in order
      await page.keyboard.press('Tab');
      await expect(dividers.nth(1)).toBeFocused();
      await page.keyboard.press('Shift+Tab');
      await expect(first).toBeFocused();

      // a divider at the end of its range (a row held 100% by one VP) can only move back: the key
      // that moves it one registry step in, then the opposite key restores the row
      const room = Number(await first.getAttribute('aria-valuemax')) - from;
      const [go, back, delta] =
        room >= step
          ? (['ArrowRight', 'ArrowLeft', step] as const)
          : (['ArrowLeft', 'ArrowRight', -step] as const);
      await page.keyboard.press(go);
      await expect.poll(() => pos(first)).toBe(from + delta);
      await expect.poll(() => text(first)).not.toBe(textBefore);
      await expect(edits(page)).toHaveAccessibleName(/^\d+ edits?: open changeset$/);
      // the commit forked the preset: the divider on screen is the fork's
      const again = page.locator('.gp-vps-row').first().getByRole('slider').first();
      await again.focus();
      await page.keyboard.press(back);
      await expect.poll(() => pos(again)).toBe(from);
      await expect.poll(() => text(again)).toBe(textBefore);
    });

    test('palette_opens_with_ctrl_k_traps_tab_and_returns_focus_on_escape', async () => {
      await openModule(page, presetC, 'cockpit', 'cruise');
      const opener = page.getByRole('button', { name: /Find any number/ });
      await tabTo(page, opener);
      await page.keyboard.press('Enter');
      const palette = page.getByRole('dialog', { name: 'Find any number' });
      await expect(palette).toBeVisible();
      const input = palette.getByRole('combobox');
      await expect(input).toBeFocused();
      await expect(palette).toHaveAttribute('aria-modal', 'true');

      await input.fill('net');
      const options = palette.getByRole('option');
      await expect(options.first()).toBeVisible();
      const active = () => input.getAttribute('aria-activedescendant');
      const first = await active();
      await page.keyboard.press('ArrowDown');
      await expect.poll(active).not.toBe(first);
      await page.keyboard.press('ArrowUp');
      await expect.poll(active).toBe(first);

      for (let i = 0; i < 6; i += 1) {
        await page.keyboard.press('Tab');
        expect(await focusIn(palette), `Tab ${i + 1} stays in the palette`).toBe(true);
      }
      for (let i = 0; i < 6; i += 1) {
        await page.keyboard.press('Shift+Tab');
        expect(await focusIn(palette), `Shift+Tab ${i + 1} stays in the palette`).toBe(true);
      }
      await page.keyboard.press('Escape');
      await expect(palette).toBeHidden();
      await expect(opener).toBeFocused();

      // and the shortcut alone opens it from anywhere on the page
      await page.keyboard.press('Control+k');
      await expect(palette).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(palette).toBeHidden();
    });

    test('drawer_opens_from_a_button_traps_tab_and_returns_focus_on_escape', async () => {
      await openModule(page, presetC, 'market', 'cruise');
      const trigger = page.locator('[data-testid="market-trace"] button.gp-market-formulas');
      await tabTo(page, trigger);
      await page.keyboard.press('Enter');
      const drawer = page.getByRole('dialog', { name: /^Trace · / });
      await expect(drawer).toBeVisible();
      await expect(drawer).toHaveAttribute('aria-modal', 'true');
      await expect(drawer.getByRole('button', { name: 'Close' })).toBeFocused();

      for (let i = 0; i < 8; i += 1) {
        await page.keyboard.press('Tab');
        expect(await focusIn(drawer), `Tab ${i + 1} stays in the drawer`).toBe(true);
      }
      for (let i = 0; i < 8; i += 1) {
        await page.keyboard.press('Shift+Tab');
        expect(await focusIn(drawer), `Shift+Tab ${i + 1} stays in the drawer`).toBe(true);
      }
      await page.keyboard.press('Escape');
      await expect(drawer).toBeHidden();
      await expect(trigger).toBeFocused();
    });
  });
});

function mkdtemp(): string {
  return mkdtempSync(join(tmpdir(), 'gp-a11y-'));
}
