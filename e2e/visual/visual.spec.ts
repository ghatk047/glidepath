import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '@glidepath/int';
import type { BrowserContext, Page, TestInfo } from '@playwright/test';
import { expect, test } from '../tests/fixtures';
import {
  allShots,
  CAPTURE_CSS,
  DEVICE_SCALE_FACTOR,
  THEMES,
  VIEWPORT_HEIGHT,
  WIDTHS,
  type Shot,
  type VisualTheme,
  type VisualWidth,
} from '../src/visual';
import {
  baselineDirFor,
  baselinePlatform,
  defaultPaths,
  writeRecord,
  writeReport,
} from '../src/visual-report';

/**
 * QA-06 (G11): a full-page screenshot of each of the 11 modules in 2 themes on the presenter's 2
 * screens (1280x720 laptop and 1920x1080 monitor, CSS px, device scale 2 like the UX pack's
 * renders), preset C, compared with the approved
 * baseline at the pixel threshold in `src/visual.ts`. Reduced motion is on, so the app settles
 * without number rolls or sky drift, and Playwright waits for two identical frames before it
 * compares. The theme is the viewer's stored choice (`glidepath.theme`), as the toggle writes it.
 *
 * The last test writes the reviewer's report (`visual-report/index.html`): each baseline beside
 * the UX pack's render of the same screen, the first-approval check of G11.
 */

const THEME_KEY = 'glidepath.theme';

/** The baselines of this platform; the first run on a machine has none and needs `--update`. */
const baselineFile = (key: string) => join(baselineDirFor(), `${key}.png`);
const mtime = (file: string) => (existsSync(file) ? statSync(file).mtimeMs : null);

/** The module is drawn and tier 2's first values are in: no busy panel, no skeleton, fonts loaded. */
async function settled(page: Page, label: string): Promise<void> {
  await expect(page.locator('.gp-module, [data-module]').first(), `${label} renders`).toBeVisible();
  // a cold stack may still be running a background job (the Path frontier): give it time
  await expect(page.locator('[aria-busy="true"]'), `${label} has no busy panel`).toHaveCount(0, {
    timeout: 45_000,
  });
  await expect(page.locator('.gp-skel'), `${label} has no skeleton`).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready.then(() => true));
  await page.mouse.move(0, 0);
  await page.evaluate(() => window.scrollTo(0, 0));
}

let presetC: string;
/** What the running test is about, for the record written after it. */
let current: { shot: Shot; before: number | null } | null = null;

test.describe('visual baselines: 11 modules x 2 themes x 2 screens (G11)', () => {
  test.beforeAll(({ stack }) => {
    presetC = stack.presets.get('C')!.id;
  });

  // eslint-disable-next-line no-empty-pattern
  test.afterEach(async ({}, testInfo: TestInfo) => {
    if (!current) return;
    const { shot, before } = current;
    current = null;
    const after = mtime(baselineFile(shot.key));
    const attached = (suffix: string) =>
      testInfo.attachments.find((a) => a.name.endsWith(suffix))?.path;
    let status: 'approved' | 'passed' | 'failed' | 'missing';
    if (after === null) status = 'missing';
    else if (after !== before) status = 'approved'; // baseline written or updated by this run
    else status = testInfo.status === 'passed' ? 'passed' : 'failed';
    writeRecord({
      key: shot.key,
      status,
      actual: attached('-actual.png'),
      diff: attached('-diff.png'),
    });
  });

  for (const theme of THEMES) {
    for (const width of WIDTHS) {
      test.describe(`${theme} at ${width}x${VIEWPORT_HEIGHT[width]}`, () => {
        let context: BrowserContext;
        let page: Page;

        test.beforeAll(async ({ browser, stack }) => {
          context = await newContext(browser, theme, width);
          page = await context.newPage();
          await stack.signInPage(page);
        });
        test.afterAll(async () => {
          await context?.close();
        });

        for (const shot of allShots().filter((s) => s.theme === theme && s.width === width)) {
          test(shot.key, async () => {
            current = { shot, before: mtime(baselineFile(shot.key)) };
            await page.goto(`/${config.tenant}/${presetC}/${shot.module}`);
            await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
            await settled(page, shot.module);
            // fixed overlays would land mid-page in a full-page capture; see CAPTURE_CSS
            await page.addStyleTag({ content: CAPTURE_CSS });
            await expect(page).toHaveScreenshot(`${shot.key}.png`, { fullPage: true });
          });
        }
      });
    }
  }
});

test.describe('the reviewer report (G11 first approval)', () => {
  test('visual_report_generated_beside_the_ux_screens', () => {
    const { file, entries, html } = writeReport(defaultPaths());
    expect(existsSync(file), 'visual-report/index.html is written').toBe(true);
    expect(entries, '11 modules x 2 themes x 2 screens').toHaveLength(allShots().length);
    expect(html.match(/<section class="shot"/g)).toHaveLength(allShots().length);
    // every screen the UX pack has a render of is shown beside its baseline
    const withRender = entries.filter((e) => e.render);
    expect(withRender.length, 'screens with a render in docs/ux/screens').toBeGreaterThan(0);
    for (const e of withRender) {
      expect(e.baseline, `${e.key} has a baseline to put beside its render`).not.toBeNull();
    }
    console.info(
      `[visual] report: ${file} (${withRender.length} of ${entries.length} screens beside a UX render, platform ${baselinePlatform()})`,
    );
  });
});

async function newContext(
  browser: import('@playwright/test').Browser,
  theme: VisualTheme,
  width: VisualWidth,
): Promise<BrowserContext> {
  const context = await browser.newContext({
    viewport: { width, height: VIEWPORT_HEIGHT[width] },
    deviceScaleFactor: DEVICE_SCALE_FACTOR,
    ignoreHTTPSErrors: true,
    reducedMotion: 'reduce',
    colorScheme: theme === 'cruise' ? 'dark' : 'light',
  });
  await context.addInitScript(
    ([k, v]) => {
      try {
        localStorage.setItem(k!, v!);
      } catch {
        /* storage blocked: the app then shows its default theme and the test says so */
      }
    },
    [THEME_KEY, theme],
  );
  return context;
}
