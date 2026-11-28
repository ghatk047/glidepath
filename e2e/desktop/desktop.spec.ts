import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { config } from '@glidepath/int';
import type { BrowserContext, Page } from '@playwright/test';
import { expect, test } from '../tests/fixtures';
import { CAPTURE_CSS, MODULES } from '../src/visual';
import { TOUR_STEP_SPECS } from '../src/wizard';

/**
 * UIX-01: the app is shown full screen on a laptop (1280x720) and on a 1080p display. On every
 * module and every wizard step at both sizes: the screen fits the viewport with no page scroll
 * (long lists scroll inside their panels), no text spills past the edge of its panel, no horizontal
 * page scroll. Every tour step (24) is captured with its card on screen and its anchor in view, and
 * the Solve for this strip stays on screen. The captures and one JSON per screen (page height in
 * screens and in px, spills, clipped text) go to `DESKTOP_SHOTS_DIR`.
 */

const VIEWPORTS = [
  { width: 1280, height: 720 },
  { width: 1920, height: 1080 },
] as const;
const OUT = resolve(process.env.DESKTOP_SHOTS_DIR ?? 'desktop-shots');
/** Page height a screen may exceed the viewport by (CSS px): sub-pixel rounding only, no scroll. */
const FIT_TOLERANCE = 1;
/** Input opened for the Solve for this check (spec id, verbatim). */
const SOLVE_INPUT = 'g.target_net';

interface Spill {
  text: string;
  cls: string;
  by: number;
}
interface Audit {
  screens: number;
  /** `document.documentElement.scrollHeight` and `window.innerHeight`, CSS px. */
  scrollHeight: number;
  innerHeight: number;
  hScroll: boolean;
  spills: Spill[];
  clipped: Spill[];
  /** Ellipsis-truncated text with no tooltip (`title`) or accessible name carrying the full text. */
  untitled: Spill[];
}

/** Runs in the page: text past its panel, and text clipped with no ellipsis. */
function audit(): Audit {
  const spills: Spill[] = [];
  const clipped: Spill[] = [];
  const untitled: Spill[] = [];
  /** The element's own text reaches past its box (not a handle or a mark that overflows). */
  const textPast = (a: Element) => {
    const b = a.getBoundingClientRect();
    const w = document.createTreeWalker(a, NodeFilter.SHOW_TEXT);
    for (let t = w.nextNode(); t; t = w.nextNode()) {
      if (!(t.textContent ?? '').trim()) continue;
      const r = document.createRange();
      r.selectNodeContents(t);
      const x = r.getBoundingClientRect();
      if (x.width > 0 && (x.right > b.right + 1 || x.left < b.left - 1)) return true;
    }
    return false;
  };
  const label = (el: Element) => (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 60);
  const walker = document.createTreeWalker(document.querySelector('main') ?? document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set<Element>();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement;
    if (!el || seen.has(el) || !(n.textContent ?? '').trim()) continue;
    seen.add(el);
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    if (el.closest('[aria-hidden="true"]')) continue;
    // visually hidden text (screen-reader only): clipped to nothing on purpose
    const hidden = (e: Element) => { const c = getComputedStyle(e); return c.clipPath === 'inset(50%)' || c.clip === 'rect(0px, 0px, 0px, 0px)'; };
    let srOnly = false;
    for (let a: Element | null = el; a; a = a.parentElement) if (hidden(a)) { srOnly = true; break; }
    if (srOnly) continue;
    // truncated with an ellipsis: fine when the full text is one hover away
    if (cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1 && !el.closest('[title]') && !el.getAttribute('aria-label'))
      untitled.push({ text: label(el), cls: el.className.toString(), by: el.scrollWidth - el.clientWidth });
    const panel = el.closest('.gp-panel');
    if (panel) {
      const range = document.createRange();
      range.selectNodeContents(n);
      const r = range.getBoundingClientRect();
      const p = panel.getBoundingClientRect();
      // what a clipping box (overflow hidden, ellipsis) cuts off is not on screen
      let left = r.left;
      let right = r.right;
      for (let a: Element | null = el; a && a !== panel; a = a.parentElement) {
        if (getComputedStyle(a).overflowX === 'visible') continue;
        const b = a.getBoundingClientRect();
        left = Math.max(left, b.left);
        right = Math.min(right, b.right);
      }
      if (r.width > 0 && right > left) {
        const by = Math.max(right - p.right, p.left - left);
        if (by > 1) spills.push({ text: label(el), cls: el.className.toString(), by: Math.round(by) });
      }
    }
    // clipped: content wider than the box, hidden, and no ellipsis to say so
    for (let a: Element | null = el; a && a !== panel; a = a.parentElement) {
      const s = getComputedStyle(a);
      if (s.overflowX !== 'visible' && a.scrollWidth > a.clientWidth + 1 && s.textOverflow !== 'ellipsis' && s.overflowX !== 'auto' && s.overflowX !== 'scroll' && textPast(a)) {
        clipped.push({ text: label(a), cls: a.className.toString(), by: a.scrollWidth - a.clientWidth });
        break;
      }
    }
  }
  const de = document.documentElement;
  return {
    screens: Math.round((de.scrollHeight / window.innerHeight) * 100) / 100,
    scrollHeight: de.scrollHeight,
    innerHeight: window.innerHeight,
    hScroll: de.scrollWidth > de.clientWidth + 1,
    spills,
    clipped: clipped.filter((c, i, xs) => xs.findIndex((x) => x.text === c.text) === i),
    untitled,
  };
}

async function settled(page: Page): Promise<void> {
  await expect(page.locator('.gp-module, [data-module]').first()).toBeVisible();
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 20_000 });
  await expect(page.locator('.gp-skel')).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready.then(() => true));
  await page.mouse.move(0, 0);
}

let presetC: string;

test.describe('desktop fit (UIX-01)', () => {
  test.beforeAll(({ stack }) => {
    presetC = stack.presets.get('C')!.id;
    mkdirSync(OUT, { recursive: true });
  });

  for (const vp of VIEWPORTS) {
    test.describe(`${vp.width}x${vp.height}`, () => {
      let context: BrowserContext;
      let page: Page;
      test.beforeAll(async ({ browser, stack }) => {
        context = await browser.newContext({
          viewport: vp,
          deviceScaleFactor: 1,
          ignoreHTTPSErrors: true,
          reducedMotion: 'reduce',
        });
        page = await context.newPage();
        await stack.signInPage(page);
      });
      test.afterAll(async () => {
        await context?.close();
      });

      /** Audits the page as it is, saves the viewport capture and the JSON under `key`. */
      const check = async (key: string, full: boolean): Promise<Audit> => {
        await page.screenshot({ path: join(OUT, `${key}.png`) });
        if (full) {
          // the floating flight strip would land mid-page in a full-page capture (see CAPTURE_CSS)
          const style = await page.addStyleTag({ content: CAPTURE_CSS });
          await page.screenshot({ path: join(OUT, `${key}-full.png`), fullPage: true });
          await style.evaluate((el) => el.remove());
        }
        const a = await page.evaluate(audit);
        writeFileSync(join(OUT, `${key}.json`), JSON.stringify(a, null, 2));
        expect.soft(a.hScroll, `${key} scrolls sideways`).toBe(false);
        expect.soft(a.spills, `${key} text spills out of a panel`).toEqual([]);
        expect.soft(a.untitled, `${key} truncated text has no tooltip`).toEqual([]);
        expect.soft(a.clipped, `${key} text is cut off with no ellipsis`).toEqual([]);
        // the screen fits one viewport: no page scroll (raw px, not the rounded `screens`)
        expect.soft(a.scrollHeight, `${key} page scrolls (${a.screens} screens)`).toBeLessThanOrEqual(a.innerHeight + FIT_TOLERANCE);
        return a;
      };

      // wizard steps 2 to 4 (step 1 is the module's default view), each fits one screen (check)
      test(`wizard-steps-${vp.width}`, async () => {
        await page.goto(`/${config.tenant}/${presetC}/wizard`);
        await settled(page);
        for (const n of [2, 3, 4]) {
          await page.getByRole('button', { name: 'Next', exact: true }).click();
          await expect(page.locator(`[data-wizard-step="${n}"]`)).toBeVisible();
          await settled(page);
          await check(`wizard-step${n}-${vp.width}`, true);
        }
      });

      // every tour step: its card on screen, clear of the element it points at
      test(`tour-${vp.width}`, async () => {
        for (const [i, step] of TOUR_STEP_SPECS.entries()) {
          await page.goto(`/${config.tenant}/${presetC}/${step.module ?? 'cockpit'}?tour=${step.id}`);
          const card = page.locator('[data-tour-card]');
          await expect(card).toBeVisible();
          await page.waitForTimeout(400); // the card settles beside its anchor
          const key = `tour-${String(i + 1).padStart(2, '0')}-${step.id}-${vp.width}`;
          await page.screenshot({ path: join(OUT, `${key}.png`) });
          const box = (await card.boundingBox())!;
          expect.soft(box.x >= 0 && box.y >= 0 && box.x + box.width <= vp.width && box.y + box.height <= vp.height, `${key} card inside the screen`).toBe(true);
          if (step.anchor) {
            const t = await page.locator(step.anchor).first().boundingBox();
            // the anchor is on screen: with every screen fitted, no anchor sits below the fold
            expect.soft(t, `${key} anchor ${step.anchor} is rendered`).not.toBeNull();
            if (t) {
              const visible = t.width > 0 && t.height > 0 && t.x < vp.width && t.y < vp.height && t.x + t.width > 0 && t.y + t.height > 0;
              expect.soft(visible, `${key} anchor ${step.anchor} in view`).toBe(true);
              const ix = Math.min(box.x + box.width, t.x + t.width) - Math.max(box.x, t.x);
              const iy = Math.min(box.y + box.height, t.y + t.height) - Math.max(box.y, t.y);
              const cover = ix > 0 && iy > 0 ? (ix * iy) / (t.width * t.height) : 0;
              expect.soft(cover, `${key} card covers its target`).toBeLessThan(0.35);
            }
          }
        }
      });

      for (const module of MODULES) {
        const key = `${module}-${vp.width}`;
        test(key, async () => {
          await page.goto(`/${config.tenant}/${presetC}/${module}`);
          await settled(page);
          await check(key, true);
        });
      }

      // SRC-21: Solve for this hangs under the edit popover; strip and its answer stay on screen
      test(`solve-for-this-${vp.width}`, async () => {
        const key = `solve-for-this-${vp.width}`;
        await page.goto(`/${config.tenant}/${presetC}/cockpit`);
        await settled(page);
        await page.keyboard.press('Control+k');
        const palette = page.getByRole('dialog', { name: 'Find any number' });
        await palette.getByRole('combobox').fill(SOLVE_INPUT);
        await expect(palette.locator(`[role="option"][data-id="${SOLVE_INPUT}"]`)).toBeVisible();
        await palette.getByRole('combobox').press('Enter');
        const solve = page.locator('[data-tour="solve-for-this"]');
        await expect(solve).toBeVisible();
        await solve.getByRole('button', { name: 'Solve for this' }).click();
        await expect(solve.getByTestId('solve-result')).toBeVisible({ timeout: 20_000 });
        await page.waitForTimeout(200);
        await page.screenshot({ path: join(OUT, `${key}.png`) });
        for (const el of [page.locator('.gp-pop[role="dialog"]'), solve, solve.getByTestId('solve-result')]) {
          const b = (await el.boundingBox())!;
          expect.soft(b.x >= 0 && b.y >= 0 && b.x + b.width <= vp.width && b.y + b.height <= vp.height, `${key} inside the screen`).toBe(true);
        }
        const pop = (await page.locator('.gp-pop[role="dialog"]').boundingBox())!;
        const sb = (await solve.boundingBox())!;
        expect.soft(sb.y >= pop.y + pop.height - 1 || sb.y + sb.height <= pop.y + 1, `${key} strip clear of the popover`).toBe(true);
        const fits = await solve.evaluate((el) => [...el.querySelectorAll('*')].every((c) => c.scrollWidth <= c.clientWidth + 1 || getComputedStyle(c).textOverflow === 'ellipsis'));
        expect.soft(fits, `${key} text fits the strip`).toBe(true);
        await page.keyboard.press('Escape');
      });
    });
  }
});
