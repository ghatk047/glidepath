import { readFile } from 'node:fs/promises';
import ExcelJS from 'exceljs';
import { apiAs, config, readRepoJson, signIn } from '@glidepath/int';
import type { ImportJob } from '@glidepath/api-contract';
import { SOLVER_TOLERANCES } from '@glidepath/parity';
import { fmt } from '@glidepath/ui/format';
import type { Locator, Page } from '@playwright/test';
import { M3_BUDGET_MS } from '../playwright.int-m3.config';
import { edits, expectCockpitValue, scenarioButton } from './cockpit';
import { expect, goldenOf, test } from './fixtures';

/**
 * INT-04, M3 exit (09 §1): the demo storyline (`docs/ux/05_demo_storyline.md`) beats 0:00–18:00
 * in a browser against the compose stack; Airlines (19:30) is M4. One serial page, signed in with
 * the INT magic link, every module reached through the rail like the presenter does. Expected
 * numbers come from the spec bundle (`golden_results.json`, `solver_demo_results.json`, the
 * registry) and the G5 tolerances, never literals. A subset of the G10 storyline (QA-05), which
 * replaces it once merged.
 *
 * `INT_COMPOSE_PROJECT=<project> pnpm int:m3 -- --trace off` against a stack that is up and seeded.
 */

const STARTED = Date.now();

interface RegistryVariable {
  id: string;
  label: string;
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

type Members = Record<string, { id: string; label: string }[]>;
const members = readRepoJson<Members>(
  'docs',
  'spec',
  'seed',
  config.tenant,
  'dimension_members.json',
);
const labelOf = (dim: string, id: string): string => {
  const m = members[dim]?.find((x) => x.id === id);
  if (!m) throw new Error(`no ${dim} member ${id}`);
  return m.label;
};

interface MonteCarlo {
  prob_clear_bar: number;
}
interface SolverDemo {
  min_risk_total_bar: { net: number; risk_exposure: number; fte_us: number };
  monte_carlo_C: MonteCarlo;
  monte_carlo_D: MonteCarlo;
}
const solverDemo = readRepoJson<SolverDemo>(
  'docs',
  'spec',
  'reference',
  'solver_demo_results.json',
);

/** Spec ids and member ids of the beats, verbatim. */
const TARGET = 'g.target_net';
const OT_SHARE = 'g.ot_out_share';
const BRENT = 'corp.brent';
const SHELF = 'lev.L10.shelf';
const SOFTWARE = 'L10';
const FINOPS = 'L11';
const POOLS = ['airline_platforms', 'internal_labour'] as const;
const DATA_ANALYTICS = 'data_analytics';
/** Presets of the storyline, by scenario key. */
const RATES = 'rates';

/** Tier 2 sends full precision; the golden file is the engine's (G3: 1e-6 relative). */
const GOLDEN_REL = 1e-6;
const relErr = (want: number) => (got: number) =>
  Math.abs(got - want) / Math.max(1, Math.abs(want));
const absErr = (want: number) => (got: number) => Math.abs(got - want);

const rail = (page: Page) => page.getByRole('navigation', { name: 'Modules' });
const toModule = async (page: Page, id: string) => {
  await rail(page).locator(`a[data-item="${id}"]`).click();
  await expect(rail(page).locator(`a[data-item="${id}"]`)).toHaveAttribute('aria-current', 'page');
};
/** A `data-value` as a number; a missing attribute is NaN (never 0), so it can not pass a bound. */
const numberOf = (l: Locator) => l.getAttribute('data-value').then((v) => Number(v ?? NaN));
const barNode = (page: Page) => page.locator('[data-node="res.bar"]').first();
const stripNet = (page: Page) => page.locator('[data-hud] [data-cell="net"] [data-value]');
/** The number a cell shows once tier 2 stops pushing (preview, then commit, then recompute). */
async function settled(l: Locator): Promise<number> {
  let last = await numberOf(l);
  for (let quiet = 0; quiet < 4;) {
    await new Promise((r) => setTimeout(r, 250));
    const now = await numberOf(l);
    quiet = now === last ? quiet + 1 : 0;
    last = now;
  }
  return last;
}
const drawer = (page: Page) => page.getByRole('dialog', { name: /^Trace · / });
const editsCount = async (page: Page) =>
  Number((await edits(page).getAttribute('aria-label'))?.match(/^(\d+)/)?.[1] ?? NaN);

/** Printed for the status note. */
const timings: Record<string, number> = {};
const seen: Record<string, unknown> = {};

test.describe.configure({ mode: 'serial' });

test.describe('M3 storyline 0:00–18:00 on the compose stack (INT-04)', () => {
  let page: Page;
  let presetC: string;
  let presetRates: string;

  test.beforeAll(async ({ browser, stack }) => {
    presetC = stack.presets.get('C')!.id;
    presetRates = stack.presets.get(RATES)!.id;
    page = await browser.newPage({ acceptDownloads: true });
    await stack.signInPage(page);
  });
  test.afterAll(async () => {
    await page?.close();
    console.info(`[m3] timings (ms): ${JSON.stringify(timings)}`);
    console.info(`[m3] read on screen: ${JSON.stringify(seen)}`);
  });

  const beat = async (name: string, run: () => Promise<void>) => {
    const t0 = Date.now();
    await run();
    timings[name] = Date.now() - t0;
  };

  test('beat_0000_cockpit_c_bar_and_gauge', async () => {
    await beat('0:00', async () => {
      await page.goto(`/${config.tenant}/${presetC}/cockpit`);
      await expect(page.getByRole('main', { name: 'Cockpit' })).toBeVisible();
      await expect(scenarioButton(page, presetC)).toHaveAttribute('aria-pressed', 'true');
      // "with cost growth absorbed it is a hundred and forty-three": the bar notch
      await expect
        .poll(() => numberOf(barNode(page)).then(relErr(goldenOf('C', 'res.bar'))))
        .toBeLessThanOrEqual(GOLDEN_REL);
      await expect(barNode(page)).toContainText(fmt.money(goldenOf('C', 'res.bar')));
      for (const cell of ['res.net', 'res.gap', 'res.risk', 'br.eps27'] as const) {
        await expectCockpitValue(page, cell, goldenOf('C', cell), `${cell} of C`);
      }
      await expect(edits(page)).toHaveAccessibleName('0 edits: open changeset');
    });
  });

  test('beat_0200_baseline_by_pool_platforms_and_us_labour', async () => {
    await beat('2:00', async () => {
      await toModule(page, 'baseline');
      const kpi = page.locator('[data-kpi="base.locked_share"] [data-value]').first();
      await expect
        .poll(() => numberOf(kpi).then(relErr(goldenOf('C', 'base.locked_share'))))
        .toBeLessThanOrEqual(GOLDEN_REL);
      const by = page.getByRole('group', { name: 'Group by' });
      await by.getByRole('button', { name: 'Cost pool' }).click();
      await expect(by.getByRole('button', { name: 'Cost pool' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      const treemap = page.getByRole('group', { name: /Treemap of CY26 IT outlay/ });
      for (const pool of POOLS) {
        const label = labelOf('pool', pool);
        await treemap.getByRole('button', { name: new RegExp(`^${label} `) }).click();
        await expect(page).toHaveURL(new RegExp(`[?&]key=${pool}`));
        const detail = page.locator(`.gp-bl-detail[data-group="${pool}"]`);
        await expect(detail.getByRole('heading', { name: label })).toBeVisible();
        await expect(page.getByRole('table')).toBeVisible();
      }
    });
  });

  test('beat_0400_cockpit_rates_only', async () => {
    await beat('4:00', async () => {
      await toModule(page, 'cockpit');
      await scenarioButton(page, presetRates).click();
      await expect(scenarioButton(page, presetRates)).toHaveAttribute('aria-pressed', 'true');
      // "squeezing vendor rates gets eight million"
      await expectCockpitValue(page, 'res.net', goldenOf(RATES, 'res.net'), 'res.net of rates');
    });
  });

  test('beat_0500_levers_shelfware_and_finops_toggle', async () => {
    await beat('5:00', async () => {
      await scenarioButton(page, presetC).click();
      await expect(scenarioButton(page, presetC)).toHaveAttribute('aria-pressed', 'true');
      await toModule(page, 'levers');
      await page.locator(`[data-lever="${SOFTWARE}"]`).click();
      const detail = page.locator('[data-lever-detail]');
      await expect(detail.getByRole('heading', { name: labelOf('lever', SOFTWARE) })).toBeVisible();
      const netBefore = await settled(stripNet(page));
      // drag shelfware one registry step: C is locked, tier 2 forks Custom (from C)
      const shelf = detail.getByRole('slider', { name: def(SHELF).label });
      await shelf.focus();
      await shelf.press('ArrowRight');
      await expect(page).not.toHaveURL(new RegExp(presetC));
      await expect.poll(() => editsCount(page)).toBeGreaterThanOrEqual(1);
      await expect.poll(() => numberOf(stripNet(page))).not.toBe(netBefore);
      // Cloud FinOps off and on: "watch the strip at the bottom"
      const on = page.getByRole('switch', { name: `${labelOf('lever', FINOPS)} on` });
      const netOn = await settled(stripNet(page));
      await on.click();
      await expect(on).not.toBeChecked();
      await expect.poll(() => numberOf(stripNet(page))).not.toBe(netOn);
      await on.click();
      await expect(on).toBeChecked();
      await expect.poll(() => numberOf(stripNet(page))).toBe(netOn);
      seen.levers = { netBefore, netOn };
    });
  });

  test('beat_0800_vps_four_bars_and_ownership', async () => {
    await beat('8:00', async () => {
      await toModule(page, 'vps');
      await expect(page.locator('article[data-vp]')).toHaveCount(members['vp']!.length);
      const before = await editsCount(page);
      const handle = page.locator(`li[data-domain="${DATA_ANALYTICS}"] [role="slider"]`).first();
      await expect(handle).toBeVisible();
      await handle.focus();
      await handle.press('ArrowRight');
      await expect.poll(() => editsCount(page)).toBeGreaterThan(before);
    });
  });

  test('beat_1000_path_find_a_path_from_c', async () => {
    await beat('10:00', async () => {
      // the reference path starts from Balanced (preset C), not from the fork of the earlier beats
      await scenarioButton(page, presetC).click();
      await expect(scenarioButton(page, presetC)).toHaveAttribute('aria-pressed', 'true');
      await toModule(page, 'path');
      const goal = page.getByRole('region', { name: 'Goal' });
      await goal.getByRole('button', { name: /Find a path/ }).click();
      const result = page.getByTestId('path-result');
      await expect(result).toBeVisible({ timeout: 180_000 });
      const ref = solverDemo.min_risk_total_bar;
      const tol = SOLVER_TOLERANCES.money;
      const hero = result.locator('.gp-path-hero');
      await expect.poll(() => numberOf(hero).then(absErr(ref.net))).toBeLessThanOrEqual(tol);
      const risk = result.locator('.gp-path-stat[data-metric="Risk exposure"] [data-value]');
      await expect
        .poll(() => numberOf(risk).then(absErr(ref.risk_exposure)))
        .toBeLessThanOrEqual(tol);
      // "leaves people levers alone": US headcount unchanged
      await expect(result.locator('.gp-path-stat[data-metric="US headcount"]')).toContainText(
        'unchanged',
      );
      await expect(result.locator('.gp-chip').first()).toHaveAttribute('data-status', 'clear');
      seen.path = { net: await numberOf(hero), risk: await numberOf(risk) };
    });
  });

  test('beat_1230_path_odds_c_and_d', async () => {
    await beat('12:30', async () => {
      const odds = page.getByTestId('path-odds');
      const clear = (key: string) => odds.locator(`[data-scenario="${key}"] [data-clear]`);
      // the demo warmer pre-runs the odds; when a scenario has none, run it like the presenter would
      for (const key of ['C', 'D']) {
        const action = odds.locator('.gp-empty-action').first();
        await expect(clear(key).or(action)).toBeVisible({ timeout: 60_000 });
        if (!(await clear(key).isVisible())) await action.click();
        await expect(clear(key)).toBeVisible({ timeout: 180_000 });
      }
      const tol = SOLVER_TOLERANCES.pClear;
      // the look-ups settle (an older run may show first, dimmed): poll the error against G5
      for (const [key, ref] of [
        ['C', solverDemo.monte_carlo_C],
        ['D', solverDemo.monte_carlo_D],
      ] as const) {
        await expect
          .poll(
            () =>
              clear(key)
                .getAttribute('data-clear')
                .then((v) => absErr(ref.prob_clear_bar)(Number(v ?? NaN))),
            {
              message: `P(clear) ${key} within G5 of ${ref.prob_clear_bar}`,
            },
          )
          .toBeLessThanOrEqual(tol);
      }
      seen.odds = { C: await clear('C').innerText(), D: await clear('D').innerText() };
    });
  });

  test('beat_1400_market_trace_and_brent', async () => {
    await beat('14:00', async () => {
      await toModule(page, 'market');
      const node = (id: string) => page.locator(`.gp-tnode[data-node="${id}"]`);
      await expect(node('res.net').locator('.gp-tnode-value')).toHaveText(
        fmt.money(goldenOf('C', 'res.net')),
      );
      // "about nine cents of EPS and a dollar a share"
      await expect(node('br.eps27').locator('.gp-tnode-value')).toHaveText(
        fmt.signed(goldenOf('C', 'br.eps27'), 'eps'),
      );
      await expect(node('br.px27').locator('.gp-tnode-value')).toHaveText(
        fmt.eps(goldenOf('C', 'br.px27'), { digits: 2, signed: true }),
      );
      // "the same as 1.7 cents off every gallon of fuel"
      const cents = page.locator('[data-node="br.fuel_equiv_cents"][data-value]');
      await expect
        .poll(() => numberOf(cents).then(relErr(goldenOf('C', 'br.fuel_equiv_cents'))))
        .toBeLessThanOrEqual(GOLDEN_REL);
      // walk the trace from net savings to share price
      for (const id of ['res.net', 'br.px27']) {
        await node(id).click();
        await expect(drawer(page)).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(drawer(page)).toBeHidden();
      }
      // turn Brent up ten dollars (registry steps)
      const brent = page.locator(`.gp-market-dial[data-variable-id="${BRENT}"] [role="slider"]`);
      const now = async () => Number(await brent.getAttribute('aria-valuenow'));
      const from = await now();
      const step = def(BRENT).step!;
      const up = 10;
      await brent.focus();
      // one press at a time, each answered by tier 2 before the next (each press commits)
      for (let i = 0; i < 2 * Math.round(up / step) && (await now()) < from + up; i += 1) {
        const before = await now();
        await brent.press('ArrowRight');
        await expect.poll(now).toBeGreaterThan(before);
      }
      const moved = (await now()) - from;
      expect(moved, `Brent moved ${moved}`).toBeGreaterThanOrEqual(up - step);
      expect(moved, `Brent moved ${moved}`).toBeLessThanOrEqual(up + step);
      seen.brent = { from, to: await now() };
      await expect(page).not.toHaveURL(new RegExp(presetC));
      await expect.poll(() => editsCount(page)).toBeGreaterThanOrEqual(1);
    });
  });

  test('beat_1600_cockpit_hand_over_one_time_funding_and_target', async () => {
    await beat('16:00', async () => {
      await toModule(page, 'cockpit');
      await expect(page.getByRole('main', { name: 'Cockpit' })).toBeVisible();
      const inputs = page.getByTestId('cockpit-inputs');
      const ot = inputs.locator(`[data-variable-id="${OT_SHARE}"] input[type="range"]`).first();
      const net = page.locator('[data-testid="cockpit-net"] .gp-cockpit-hero-value');
      const netBefore = await net.innerText();
      await ot.focus();
      await ot.press('ArrowRight');
      await expect(net).not.toHaveText(netBefore);
      const bar = await numberOf(barNode(page));
      const target = inputs.locator(`[data-variable-id="${TARGET}"] input[type="range"]`).first();
      await target.focus();
      await target.press('ArrowRight');
      await expect.poll(() => numberOf(barNode(page))).toBeGreaterThan(bar);
    });
  });

  test('beat_1800_excel_export_c_d_and_import_review_with_one_conflict', async () => {
    await beat('18:00', async () => {
      await toModule(page, 'excel');
      const scenarios = page.getByRole('group', { name: 'Scenarios to export' });
      await scenarios.getByRole('button', { name: 'C + D' }).click();
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('button', { name: 'Export workbook' }).click(),
      ]);
      const exported = await readFile((await download.path())!);
      seen.export = download.suggestedFilename();

      // One conflict = the same cell changed in the app and in the file after the export (XL-07
      // test 4). The app side is an earlier workbook applied through the Excel routes (tenant
      // defaults have no other write path in the UI); the file side is the presenter's edit.
      const target = def(TARGET);
      const now = defaultOf(await load(exported), TARGET);
      const step = target.step!;
      const up = now + 2 * step <= target.max! ? 1 : -1;
      const appValue = now + up * 2 * step;
      const fileValue = now + up * step;

      const api = apiAs(await signIn());
      const appBook = await load(exported);
      setDefault(appBook, TARGET, appValue);
      const appJob = await importAndWait(api, appBook, 'app-side.xlsx');
      expect(appJob.report?.summary.changed_in_excel).toBe(1);
      await api.importApply({
        params: { tenant: config.tenant, id: appJob.id },
        body: { accept: 'all', decisions: [] },
      });

      const fileBook = await load(exported);
      setDefault(fileBook, TARGET, fileValue);
      await page.getByLabel('Workbook file').setInputFiles({
        name: 'storyline-import.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        buffer: Buffer.from(await fileBook.xlsx.writeBuffer()),
      });
      const review = page.getByRole('table', { name: 'Import review' });
      await expect(review).toBeVisible({ timeout: 60_000 });
      await expect(page.getByText('1 conflict', { exact: true })).toBeVisible();
      await expect(review.locator('tr[data-status="conflict"]')).toHaveCount(1);
      await expect(review.locator('tr[data-status="conflict"]')).toContainText('Targets');
      seen.importSummary = await page
        .getByRole('heading', { level: 2, name: /Import review/ })
        .innerText();
    });
  });

  test('suite_finishes_within_the_m3_budget', () => {
    expect(Date.now() - STARTED).toBeLessThan(M3_BUDGET_MS);
  });
});

// --- workbook helpers (the file side of the Excel beat; tier 2 does every diff) -----------------

async function load(bytes: Uint8Array): Promise<ExcelJS.Workbook> {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(bytes as unknown as ArrayBuffer);
  return book;
}

/** The Targets sheet's `Default` column (key in column A, as the template writes it). */
function targetsCell(book: ExcelJS.Workbook, key: string): ExcelJS.Cell {
  const ws = book.getWorksheet('Targets');
  if (!ws) throw new Error('the export has no Targets sheet');
  let col = 0;
  for (let c = 1; c <= ws.columnCount; c += 1) if (ws.getCell(1, c).value === 'Default') col = c;
  if (col === 0) throw new Error('Targets has no Default column');
  for (let r = 2; r <= ws.rowCount; r += 1) {
    if (ws.getCell(r, 1).value === key) return ws.getCell(r, col);
  }
  throw new Error(`Targets has no row ${key}`);
}
const defaultOf = (book: ExcelJS.Workbook, key: string) => Number(targetsCell(book, key).value);
function setDefault(book: ExcelJS.Workbook, key: string, value: number): void {
  targetsCell(book, key).value = value;
}

async function importAndWait(
  api: ReturnType<typeof apiAs>,
  book: ExcelJS.Workbook,
  filename: string,
): Promise<ImportJob> {
  const bytes = new Uint8Array(await book.xlsx.writeBuffer());
  const started = await api.importCreate({
    params: { tenant: config.tenant },
    query: { filename },
    body: bytes,
  });
  let job = started;
  for (let i = 0; job.status === null; i += 1) {
    if (i > 120) throw new Error(`import ${started.id} did not finish`);
    await new Promise((r) => setTimeout(r, 500));
    job = await api.importGet({ params: { tenant: config.tenant, id: started.id } });
  }
  return job;
}
