import { randomUUID } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MemberKey, VarKey } from '@glidepath/api-contract';
import { config, readRepoJson } from '@glidepath/int';
import { fmt } from '@glidepath/ui/format';
import type { Locator, Page } from '@playwright/test';
import { specHeadline } from '../src/spec-headline';
import {
  MONTE_CARLO_TOLERANCE_PP,
  PEOPLE_LEVERS,
  solverDemo,
  specProse,
} from '../src/storyline';
import { writeCell } from '../src/xlsx';
import { cockpitCell, edits, expectCockpitValue, quoted, quotedCells, scenarioButton } from './cockpit';
import { expect, goldenOf, HEADLINE, test } from './fixtures';

/**
 * QA-05, gate G10: the demo storyline in a browser against the compose stack. The 11 beats of
 * `docs/ux/05_demo_storyline.md` "Run of show", one test each and in the order the room sees them,
 * then the "Ready for questions" moves the build has. Black box, like the G9 smoke and the M2 spec: the
 * page is reached through `web` (Caddy), signed in with the INT magic link, and every number the
 * storyline quotes is read from the spec bundle (`docs/spec/README.md`, `solver_demo_results.json`,
 * `golden_results.json`) and rendered through the UI's own `fmt`; none is written here.
 *
 * `INT_COMPOSE_PROJECT=<project> pnpm e2e:storyline -- --trace off` against a stack that is up and seeded.
 *
 * The beats do not depend on one another: each opens the screen it needs on the locked preset it
 * needs, and an edit forks `Custom (from C)` like in the room, so a failing beat does not hide the next.
 * Assertions that wait on another backlog item are `test.fixme` with the item id and state the final
 * behaviour (they are listed in the QA-05 report):
 *
 * - AI-07: the UA tile (Draft, from the cached rehearsal bundle) and the AS tile do not exist yet;
 * - MOD-06: the Path screen has no GCC hiring-capacity constraint to add ("What if the GCC can't hire?").
 */

const TARGET = 'g.target_net';
const OUTSIDE = 'g.ot_out_share';
/** The Cockpit sliders: the registry's `ui.hero` inputs, found by their spec id. */
const slider = (page: Page, id: string) =>
  page.locator(`[data-variable-id="${id}"] input[type="range"]`).first();

interface RegistryVariable {
  id: string;
  label: string;
  min: number | null;
  max: number | null;
  step: number | null;
}
const registry = readRepoJson<{ variables: RegistryVariable[] }>('docs', 'spec', 'variables.json');
const variable = (id: string): RegistryVariable => {
  const v = registry.variables.find((x) => x.id === id);
  if (!v) throw new Error(`the registry has no ${id}`);
  return v;
};

const rail = (page: Page) => page.getByRole('navigation', { name: 'Modules' });
const popover = (page: Page) => page.locator('.gp-pop[role="dialog"]');
const drawer = (page: Page) => page.getByRole('dialog', { name: /^Trace · / });
const strip = (page: Page, slot: string) => page.locator(`[data-hud] [data-cell="${slot}"]`);
const barNode = (page: Page) => page.locator('[data-node="res.bar"]');
/** An edit of a locked preset makes tier 2 fork `Custom (from X)`: the URL leaves the preset. */
const SOME_EDITS = /^[1-9]\d* edits?: open changeset$/;

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The number in a displayed text (`$119.3M` → 119.3, `−$4.9M short` → −4.9); NaN for a cell not drawn yet ("—"). */
const numberIn = (text: string): number => {
  const m = /[−-]?\$?([\d,]+(?:\.\d+)?)/.exec(text);
  if (!m) return Number.NaN;
  return Number(m[1]!.replace(/,/g, '')) * (/^[−-]/.test(m[0]) ? -1 : 1);
};

async function open(page: Page, scenario: string, module: string, search = ''): Promise<void> {
  await page.goto(`/${config.tenant}/${scenario}/${module}${search}`);
  await expect(rail(page).locator(`a[data-item="${module}"]`)).toHaveAttribute(
    'aria-current',
    'page',
  );
}

/** Pointer drag of a native range input to `to`, in a sweep of frames like a hand. */
async function dragRange(page: Page, range: Locator, to: number): Promise<void> {
  await range.scrollIntoViewIfNeeded();
  const box = (await range.boundingBox())!;
  const min = Number(await range.getAttribute('min'));
  const max = Number(await range.getAttribute('max'));
  const from = Number(await range.inputValue());
  const y = box.y + box.height / 2;
  const at = (v: number) => box.x + ((v - min) / (max - min)) * box.width;
  await page.mouse.move(at(from), y);
  await page.mouse.down();
  const frames = 8;
  for (let i = 1; i <= frames; i++) await page.mouse.move(at(from + ((to - from) * i) / frames), y);
  await page.mouse.up();
}

const leverRow = (page: Page, lever: string) =>
  page.locator('li.gp-lv-row').filter({ has: page.locator(`button[data-lever="${lever}"]`) });
const leverInYear = (page: Page, lever: string) =>
  leverRow(page, lever).locator('[data-id="lev.iy"]');

test.describe.configure({ mode: 'default' });

test.describe('Demo storyline: run of show (QA-05, G10)', () => {
  let page: Page;
  let presetC: string;
  let presetD: string;
  let presetRates: string;

  test.beforeAll(async ({ browser, stack }) => {
    presetC = stack.presets.get('C')!.id;
    presetD = stack.presets.get('D')!.id;
    presetRates = stack.presets.get('rates')!.id;
    page = await browser.newPage();
    await stack.signInPage(page);
  });
  test.afterAll(async () => {
    await page?.close();
  });

  // 0:00 Cockpit (C): open on Balanced, point at the gauge and the bar notch.
  test('beat_01_cockpit_opens_on_balanced_with_the_bar_143_0', async () => {
    const spec = quoted('C');
    const prose = specProse();
    await open(page, presetC, 'cockpit');
    await expect(page.getByRole('main', { name: 'Cockpit' })).toBeVisible();
    await expect(scenarioButton(page, presetC)).toHaveAttribute('aria-pressed', 'true');
    // "Ten percent sounds like a hundred million. With cost growth absorbed it is a hundred and forty-three."
    await expect(page.getByTestId('cockpit-net')).toBeVisible(); // the gauge, with the bar notch
    await expect(barNode(page)).toHaveText(fmt.money(prose.bar.value));
    expect(Number(await barNode(page).getAttribute('data-value'))).toBeCloseTo(prose.bar.value, 1);
    await expect(page.locator('g[data-step="growth"]')).toHaveAttribute(
      'aria-label',
      new RegExp(escapeRe(fmt.signed(prose.growth.value))),
    );
    // C: net 119.3, gap −23.7, risk-adjusted 82.0, EPS +0.091
    for (const cell of HEADLINE) {
      await expectCockpitValue(page, cell, spec[cell], `${cell} of C (spec ${spec[cell]})`);
    }
    await expect(edits(page)).toHaveAccessibleName('0 edits: open changeset');
  });

  // 2:00 Baseline: group by pool, then click Airline platforms and US labour.
  test('beat_02_baseline_groups_by_pool_airline_platforms_and_us_labour', async () => {
    const prose = specProse();
    await open(page, presetC, 'baseline');
    // "A fifth of the money is locked for 2027."
    await expect(page.locator('[data-kpi="base.locked_share"]')).toContainText(
      fmt.pct(prose.lockedPct.value / 100),
    );
    await page.locator('button[data-k="pool"]').click();
    await expect(page.locator('[data-group]').first()).toBeVisible();

    for (const [group, name] of [
      ['airline_platforms', 'Airline platforms'],
      ['internal_labour', 'US labour'],
    ] as const) {
      await page.locator(`[data-group="${group}"][role="button"]`).click();
      await expect(page).toHaveURL(new RegExp(`key=${group}`));
      const detail = page.locator(`.gp-bl-detail[data-group="${group}"]`);
      await expect(detail).toBeVisible();
      await expect(detail.getByRole('heading', { name })).toBeVisible();
      // the detail's total is the treemap tile's value, both tier 2's
      const tile = await page.locator(`[data-group="${group}"][role="button"]`).getAttribute('aria-label');
      expect(tile, `treemap tile of ${name}`).toContain(
        (await detail.getByTestId('group-total').innerText()).trim(),
      );
      await expect(page.getByRole('table')).toContainText('Line');
    }
  });

  // 4:00 Cockpit (R): switch the scenario bar to Rates only.
  test('beat_03_rates_only_gets_8_1', async () => {
    const rates = quotedCells('Rates');
    await open(page, presetC, 'cockpit');
    await scenarioButton(page, presetRates).click();
    await expect(page).toHaveURL(new RegExp(`/${presetRates}/cockpit`));
    await expect(scenarioButton(page, presetRates)).toHaveAttribute('aria-pressed', 'true');
    // "The instinctive move, squeezing vendor rates, gets eight million. It is not a plan."
    for (const cell of ['res.net', 'res.gap', 'res.risk'] as const) {
      await expectCockpitValue(page, cell, rates[cell]!, `${cell} of Rates only (spec ${rates[cell]})`);
    }
    expect(rates['res.net']).toBe(specHeadline('Rates').net!.value);
  });

  // 5:00 Levers: back to C. Open Software, drag shelfware, toggle Cloud FinOps off and on.
  test('beat_04_levers_software_shelfware_and_cloud_finops_move_the_strip', async () => {
    const spec = quoted('C');
    const shelf = variable('lev.L10.shelf');
    await open(page, presetC, 'levers');
    // "Seventeen levers, each with its own timing and confidence."
    await expect(page.locator('button[data-lever]')).toHaveCount(17);
    await expect(strip(page, 'net')).toContainText(fmt.money(spec['res.net']));

    // Software (L10): drag shelfware up
    await page.locator('button[data-lever="L10"]').click();
    const detail = page.locator('[data-lever-detail="L10"]');
    await expect(detail).toBeVisible();
    const range = detail.getByRole('slider', { name: shelf.label });
    const before = Number(await range.inputValue());
    const inYearBefore = await leverInYear(page, 'L10').innerText();
    await dragRange(page, range, Math.min(shelf.max!, before + 4 * shelf.step!));
    await expect(page).not.toHaveURL(new RegExp(presetC)); // tier 2 forked Custom (from C)
    await expect(edits(page)).toHaveAccessibleName(SOME_EDITS);
    expect(Number(await range.inputValue())).toBeGreaterThan(before);
    await expect
      .poll(async () => numberIn(await leverInYear(page, 'L10').innerText()))
      .toBeGreaterThan(numberIn(inYearBefore));

    // "Watch the strip at the bottom": Cloud FinOps off, then on
    const withShelf = await strip(page, 'net').innerText();
    const finops = leverRow(page, 'L11');
    const finopsOn = await leverInYear(page, 'L11').innerText();
    await finops.getByRole('switch').click();
    await expect(finops.getByRole('switch')).not.toBeChecked();
    await expect(leverInYear(page, 'L11')).toHaveText(fmt.money(0));
    await expect.poll(() => strip(page, 'net').innerText()).not.toBe(withShelf);
    await finops.getByRole('switch').click();
    await expect(finops.getByRole('switch')).toBeChecked();
    await expect(leverInYear(page, 'L11')).toHaveText(finopsOn);
    await expect.poll(() => strip(page, 'net').innerText()).toBe(withShelf);
  });

  // 8:00 VPs: show the four bars, drag Data & analytics ownership toward Commercial.
  test('beat_05_vps_four_bars_and_data_analytics_ownership_moves_to_commercial', async () => {
    await open(page, presetC, 'vps');
    // "Every VP is short today."
    const cards = page.locator('article[data-vp]');
    await expect(cards).toHaveCount(4);
    for (const card of await cards.all()) await expect(card).toContainText('short');

    const outlay = (vp: string) => page.locator(`article[data-vp="${vp}"] .gp-vps-hero`);
    const commercialBefore = numberIn(await outlay('vp_commercial').innerText());
    const operationsBefore = numberIn(await outlay('vp_operations').innerText());
    // the divider between Commercial and Operations on the Data & analytics row, dragged right
    const divider = page.locator(
      'li.gp-vps-row[data-domain="data_analytics"] [role="slider"][data-index="0"]',
    );
    await divider.scrollIntoViewIfNeeded();
    const box = (await divider.boundingBox())!;
    const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(x + i * 10, y);
    await page.mouse.up();
    await expect(page).not.toHaveURL(new RegExp(presetC));
    await expect(edits(page)).toHaveAccessibleName(SOME_EDITS);
    // "Ownership and chargeback decide who carries what": Commercial carries more, Operations less
    await expect
      .poll(async () => numberIn(await outlay('vp_commercial').innerText()))
      .toBeGreaterThan(commercialBefore);
    await expect
      .poll(async () => numberIn(await outlay('vp_operations').innerText()))
      .toBeLessThan(operationsBefore);
  });

  // 10:00 Path: press Find a path, let the moves land.
  async function findPath(): Promise<Locator> {
    await open(page, presetC, 'path');
    await page
      .getByTestId('path-grid')
      .getByRole('button', { name: 'Find a path' })
      .first()
      .click();
    const result = page.getByTestId('path-result');
    await expect(result).toBeVisible({ timeout: 90_000 });
    await expect(result.locator('ol.gp-path-moves[aria-busy="false"]')).toBeVisible({
      timeout: 30_000,
    });
    return result;
  }
  const stat = (result: Locator, label: RegExp) =>
    result.locator('[data-metric]').filter({ hasText: label });

  test('beat_06_find_a_path_reaches_143_0_with_people_levers_alone', async () => {
    const demo = solverDemo().min_risk_total_bar;
    const result = await findPath();
    await expect(result).toHaveAttribute('data-status', /^(optimal|feasible)$/);
    // "The least risky way to one forty-three leaves people levers alone."
    await expect(result.locator('.gp-path-hero')).toContainText(
      fmt.money(demo.net).replace(/^\$|M$/g, ''),
    );
    await expect(result).toContainText('Bar cleared');
    await expect(stat(result, /US headcount/i)).toContainText('unchanged');
    // "$42M risk exposure" (SOL-12 put the production solver on the oracle's bounds), here and on the Cockpit tile
    await expect(stat(result, /risk exposure/i)).toContainText(fmt.money(demo.risk_exposure));
    const moved = await result.locator('li[data-cell]').evaluateAll((els) =>
      els.map((e) => e.getAttribute('data-cell') ?? ''),
    );
    expect(moved.length).toBeGreaterThan(0);
    for (const lever of PEOPLE_LEVERS) {
      expect(moved.filter((c) => c.startsWith(`lev.${lever}.`)), `${lever} untouched`).toEqual([]);
    }
    expect(moved.filter((c) => c.startsWith('hc.')), 'no head count moved').toEqual([]);
    // "It refuses vendor COLA and contains growth first."
    const cola = result.locator('li[data-cell^="lev.L17.cola"]');
    await expect(cola).toHaveCount(1);
    await expect(cola).toContainText(fmt.pct(1, { digits: 0 }));
    await expect(result.locator('li[data-cell^="lev.L17.cl["]')).toHaveCount(1);
    await open(page, presetC, 'cockpit');
    await expect(page.getByTestId('cockpit-path')).toContainText(fmt.money(demo.risk_exposure));
  });

  // 12:30 Path · odds: point at 0% and 4.5%.
  test('beat_07_odds_of_clearing_the_bar_c_0_percent_d_4_5_percent', async () => {
    const demo = solverDemo();
    // D's own numbers first: net 166.9, clear of the bar
    const d = quoted('D');
    await open(page, presetD, 'cockpit');
    for (const cell of HEADLINE) await expectCockpitValue(page, cell, d[cell], `${cell} of D (spec ${d[cell]})`);

    await open(page, presetC, 'path');
    const odds = page.getByTestId('path-odds');
    const clear = async (name: string) =>
      Number(
        await odds
          .locator(`[data-scenario="${name}"] .gp-path-odds-big`)
          .getAttribute('data-clear', { timeout: 30_000 }),
      );
    // "If each lever only delivers its confidence, even full stretch rarely clears."
    const c = await clear('C');
    expect(c * 100).toBeCloseTo(demo.monte_carlo_C.prob_clear_bar * 100, 6);
    await expect(odds.locator('[data-scenario="C"] .gp-path-odds-big')).toHaveText(
      fmt.pct(demo.monte_carlo_C.prob_clear_bar).replace(/\.0%$/, '%'),
    );
    // D: 4.5% in the oracle; the seeded 2,000 draws are within the solver gate's ±1.5 pp
    const dClear = await clear('D');
    expect(Math.abs(dClear - demo.monte_carlo_D.prob_clear_bar) * 100).toBeLessThanOrEqual(
      MONTE_CARLO_TOLERANCE_PP,
    );
    await expect(odds).toContainText(`${fmt.fte(demo.monte_carlo_D.iterations)} runs`);
    // the Cockpit's Odds tile (C) says the same without a click
    await open(page, presetC, 'cockpit');
    await expect(page.getByTestId('cockpit-odds').locator('[data-clear]')).toHaveText(
      fmt.pct(demo.monte_carlo_C.prob_clear_bar).replace(/\.0%$/, '%'),
    );
  });

  // 14:00 Market: walk the trace from net savings to share price, turn Brent up ten dollars.
  test('beat_08_market_trace_to_share_price_and_brent_plus_ten', async () => {
    const spec = specHeadline('C');
    const brent = variable('corp.brent');
    await open(page, presetC, 'market');
    // "Balanced is worth about nine cents of EPS and a dollar a share. The same as 1.7 cents off every gallon of fuel."
    const chain = page.getByTestId('market-trace').locator('[data-node]');
    await expect(chain.first()).toBeVisible(); // the chain is drawn once tier 2 has pushed the cells
    const ids = await chain.evaluateAll((els) => els.map((e) => e.getAttribute('data-node') ?? ''));
    expect(ids[0]).toBe('res.net');
    expect(ids.indexOf('br.eps27')).toBeGreaterThan(0);
    expect(ids.indexOf('br.px27')).toBeGreaterThan(ids.indexOf('br.eps27'));
    const node = (id: string) => page.getByTestId('market-trace').locator(`[data-node="${id}"]`);
    await expect(node('res.net')).toContainText(fmt.money(spec.net!.value));
    await expect(node('br.eps27')).toContainText(fmt.eps(spec.eps27!.value, { signed: true }));
    await expect(node('br.px27')).toContainText(
      fmt.eps(spec.px27!.value, { digits: 2, signed: true }),
    );
    const fuel = goldenOf('C', 'br.fuel_equiv_cents');
    const fuelNode = page.locator('[data-node="br.fuel_equiv_cents"]').first();
    expect(Number(await fuelNode.getAttribute('data-value'))).toBeCloseTo(fuel, 6);
    expect(fuel.toFixed(2)).toBe('1.74'); // the storyline's 1.74¢, as the golden cell carries it
    await expect(fuelNode).toContainText(fmt.cents(fuel));

    // walk the trace: each node opens tier 2's explanation of that node
    for (const id of ids) {
      await page.locator(`[data-testid="market-trace"] [data-node="${id}"]`).click();
      await expect(drawer(page)).toBeVisible();
      await expect(drawer(page).locator('[data-slot="node-id"]')).toHaveText(id);
      await expect(drawer(page).locator('[data-slot="formula"]')).not.toBeEmpty();
      await drawer(page).getByRole('button', { name: 'Close' }).click();
      await expect(drawer(page)).toBeHidden();
    }

    // Brent up ten dollars
    const dial = page.getByRole('slider', { name: 'Brent' });
    const from = Number(await dial.getAttribute('aria-valuenow'));
    const epsBefore = await page.getByTestId('market-eps').innerText();
    const presses = Math.round(10 / brent.step!);
    // one step per key press; the next press waits for tier 2's value, which the dial steps from.
    // The dial snaps to its step, so the first press may move a little more than one step.
    let last = from;
    for (let i = 1; i <= presses; i++) {
      await dial.focus();
      await page.keyboard.press('ArrowUp');
      const prev = last;
      await expect
        .poll(async () => Number(await dial.getAttribute('aria-valuenow')))
        .toBeGreaterThan(prev);
      last = Number(await dial.getAttribute('aria-valuenow'));
      if (i === 1) await expect(page).not.toHaveURL(new RegExp(presetC)); // the first edit forks Custom (from C)
    }
    expect(Math.abs(last - (from + 10))).toBeLessThanOrEqual(brent.step!);
    await expect(edits(page)).toHaveAccessibleName(SOME_EDITS);
    await expect.poll(() => page.getByTestId('market-eps').innerText()).not.toBe(epsBefore);
  });

  // 16:00 Cockpit: hand over the controls; the MD moves one-time funding and the target.
  test('beat_09_cockpit_hand_over_one_time_funding_and_the_target', async () => {
    const prose = specProse();
    const target = variable(TARGET);
    await open(page, presetC, 'cockpit');
    await expectCockpitValue(page, 'res.net', quoted('C')['res.net'], 'net of C before the edits');
    await expect(page.locator('[data-node="res.tot_ot_it"]')).toContainText('$');
    const netBefore = numberIn(await cockpitCell(page, 'res.net').innerText());
    const oneTimeBefore = numberIn(await page.locator('[data-node="res.tot_ot_it"]').innerText());

    // one-time funding up: less of it lands in IT, so net rises
    await dragRange(page, slider(page, OUTSIDE), 1);
    await expect(page).not.toHaveURL(new RegExp(presetC));
    await expect(edits(page)).toHaveAccessibleName(SOME_EDITS);
    await expect
      .poll(async () => numberIn(await cockpitCell(page, 'res.net').innerText()))
      .toBeGreaterThan(netBefore);
    await expect
      .poll(async () => numberIn(await page.locator('[data-node="res.tot_ot_it"]').innerText()))
      .toBeLessThan(oneTimeBefore);

    // the target: the bar follows it ("target + cost growth")
    const barBefore = Number(await barNode(page).getAttribute('data-value'));
    const targetBefore = Number(await slider(page, TARGET).inputValue());
    await dragRange(page, slider(page, TARGET), Math.min(target.max!, targetBefore + 4 * target.step!));
    const targetAfter = Number(await slider(page, TARGET).inputValue());
    expect(targetAfter).toBeGreaterThan(targetBefore);
    await expect
      .poll(async () => Number(await barNode(page).getAttribute('data-value')))
      .toBeCloseTo(barBefore + (targetAfter - targetBefore), 5);
    expect(barBefore - targetBefore).toBeCloseTo(prose.growth.value, 1);
  });

  // 18:00 Excel: export C + D, show the import review with one conflict.
  // Blocked by an open defect in the worker (XL-08): the pg-boss runtime drops the handler output of
  // non-solver queues, so POST /exports answers 500 "excel.export job answered no result". The body is the
  // full, unweakened assertion set (it passed against a local worker fix, see the QA-05 report); the
  // validation-line check also waits on D's seed (VR04: lever values above the registry maximum).
  test.fixme('beat_10_excel_exports_c_and_d_and_the_import_review_shows_one_conflict [XL-08]', async ({ stack }) => {
    test.setTimeout(180_000);
    const dir = mkdtempSync(join(tmpdir(), 'gp-storyline-'));
    const tenant = { tenant: config.tenant };
    await open(page, presetC, 'excel');

    // Export C + D: the workbook arrives, named for the tenant and the two scenarios
    await page.locator('button[data-k="C+D"]').click();
    await expect(page.getByTestId('export-filename')).toContainText(`${config.tenant}_it_savings_`);
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export workbook' }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(
      // tier 2 names the file (`{tenant}_it_savings_{scenario keys}_{yyyymmdd-hhmm}.xlsx`, keys joined by +)
      new RegExp(`^${config.tenant}_it_savings_C\\+D_\\d{8}-\\d{4}\\.xlsx$`),
    );
    const exported = join(dir, download.suggestedFilename());
    await download.saveAs(exported);
    await expect(page.getByTestId('template-version')).toBeVisible();

    // "The app reads it back": the unchanged export has nothing to apply
    await page.getByLabel('Workbook file').setInputFiles(exported);
    await expect(page.getByText('No differences to apply.')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('validation-line')).toContainText(/VR01.VR10 passed/);

    // One conflict. The presets are locked and the UI exports only presets, so the conflict is made on
    // a Custom scenario: export it (the API), edit the net target in the file, change the same target
    // in the app afterwards, then hand the file to the review screen.
    const target = variable(TARGET);
    const step = target.step!;
    const a = target.min! + 3 * step;
    const change = (value: number) => ({
      target: 'variable' as const,
      key: TARGET as VarKey,
      member: '' as MemberKey,
      value,
    });
    const preset = stack.presets.get('C')!;
    const fork = await stack.api.changesetApply({
      params: tenant,
      body: {
        scenarioId: preset.id,
        baseVersion: preset.version,
        changes: [change(a)],
        clientRequestId: randomUUID(),
      },
    });
    const { scenarios } = await stack.api.scenarios({ params: tenant });
    const label = scenarios.find((s) => s.id === fork.scenarioId)!.label;
    const made = await stack.api.exportCreate({
      params: tenant,
      body: { scenarioIds: [fork.scenarioId], sheets: ['Targets'] },
    });
    const file = await stack.api.fileDownload({ params: { ...tenant, id: made.file.id } });
    const column = new RegExp(escapeRe(label), 'i');
    const edited = await writeCell(file.bytes, { sheet: 'Targets', key: TARGET, column }, a + step);
    await stack.api.changesetApply({
      params: tenant,
      body: {
        scenarioId: fork.scenarioId,
        baseVersion: fork.version,
        changes: [change(a + 2 * step)],
        clientRequestId: randomUUID(),
      },
    });
    const conflicted = join(dir, 'conflict.xlsx');
    writeFileSync(conflicted, edited);

    await page.getByLabel('Workbook file').setInputFiles(conflicted);
    const conflict = page.locator('tr[data-status="conflict"]');
    await expect(conflict).toHaveCount(1, { timeout: 60_000 });
    await expect(page.getByText('1 conflict', { exact: true })).toBeVisible();
    const cell = (col: string) => conflict.locator(`[data-col="${col}"]`);
    const [was, inFile, now] = [
      await cell('exported').innerText(),
      await cell('file').innerText(),
      await cell('appNow').innerText(),
    ];
    expect(new Set([was, inFile, now]).size, 'exported, file and app differ').toBe(3);
    await expect(cell('take')).toContainText('File');
    await expect(cell('take')).toContainText('App');
    // the review: impact preview, then apply as one changeset
    await page.getByRole('button', { name: 'Preview impact' }).click();
    await expect(page.getByTestId('impact')).toBeVisible();
    await page.getByRole('button', { name: /Apply as changeset/ }).click();
    await expect(page.getByRole('status').filter({ hasText: /^Applied as changeset/ })).toBeVisible();
  });

  // 19:30 Airlines: show the UA and AS tiles. Close.
  test('beat_11_airlines_american_is_the_first_airline_on_it', async () => {
    await open(page, presetC, 'airlines');
    // "American is the first airline on it, not the only one."
    const aa = page.locator('[data-tile="aa"]');
    await expect(aa).toHaveAttribute('data-kind', 'live');
    await expect(aa.locator('[data-monogram]')).toHaveText(config.tenant.toUpperCase());
    await expect(page.getByTestId('facts-aa')).toHaveText(/^\d+ lines · \d+ VPs · \d+ scenarios/);
    await expect(page.locator('[data-kind="add"]')).toBeVisible(); // "Add an airline"
    await expect(page.getByRole('img', { name: /logo/i })).toHaveCount(0); // monograms, never logos
  });

  // AI-07: the UA rehearsal bundle. UA is a Draft tile from the cached bundle, AS is Not started.
  test.fixme('beat_11_ua_and_as_tiles [AI-07]', async () => {
    await open(page, presetC, 'airlines');
    await expect(page.locator('[data-tile="ua"]')).toHaveAttribute('data-kind', 'draft');
    await expect(page.locator('[data-tile="ua"] progress')).toBeVisible();
    await expect(page.locator('[data-tile="as"]')).toContainText('Not started');
  });
});

/**
 * "Ready for questions" (05_demo_storyline.md): the moves the build has. Each is on a fresh
 * locked C, so the first edit forks like in the room.
 */
test.describe('Demo storyline: ready for questions (QA-05, G10)', () => {
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

  // "What if the GCC can't hire?": Path, add the GCC hiring-capacity constraint, rerun.
  // The solver has the constraint (`gcc_hiring`); MOD-06 gives Goal only the VP, US headcount and
  // one-time constraints, so there is nothing to add yet.
  test.fixme('q_gcc_cannot_hire_adds_the_hiring_capacity_constraint [MOD-06]', async () => {
    await open(page, presetC, 'path');
    const gcc = page.getByRole('switch', { name: /GCC/i });
    await expect(gcc).toBeVisible();
    await gcc.click();
    await expect(gcc).toBeChecked();
    await page.getByTestId('path-grid').getByRole('button', { name: 'Find a path' }).first().click();
    const result = page.getByTestId('path-result');
    await expect(result).toBeVisible({ timeout: 90_000 });
    await expect(result).toHaveAttribute('data-status', /^(optimal|feasible|infeasible)$/);
  });

  // "What if vendors win COLA?": Levers, L17 vendor COLA refused, 0%.
  test('q_vendors_win_cola_refused_share_to_zero', async () => {
    const cola = variable('lev.L17.cola');
    const spec = quoted('C');
    await open(page, presetC, 'levers');
    await expect(strip(page, 'net')).toContainText(fmt.money(spec['res.net']));
    await page.locator('button[data-lever="L17"]').click();
    const range = page
      .locator('[data-lever-detail="L17"]')
      .getByRole('slider', { name: cola.label });
    const inYearBefore = numberIn(await leverInYear(page, 'L17').innerText());
    const netBefore = await strip(page, 'net').innerText();
    await range.focus();
    await page.keyboard.press('Home');
    await expect(page).not.toHaveURL(new RegExp(presetC));
    await expect(range).toHaveValue(String(cola.min));
    await expect(range).toHaveAttribute('aria-valuetext', /^0(\.0)?%$/);
    await expect
      .poll(async () => numberIn(await leverInYear(page, 'L17').innerText()))
      .toBeLessThan(inYearBefore);
    await expect.poll(() => strip(page, 'net').innerText()).not.toBe(netBefore);
  });

  // "Who pays the one-time?": Cockpit, outside funding 0% and 100% (net swings ±$19.6M; EPS does not move).
  test('q_outside_funding_0_and_100_percent_swing_net_not_eps', async () => {
    const out = variable(OUTSIDE);
    const net = goldenOf('C', 'res.net');
    // the one-time cost the IT budget carries at the plan's funding share is the swing either way
    const swing = goldenOf('C', 'res.tot_ot_it');
    await open(page, presetC, 'cockpit');
    // the flight strip's EPS cell is hidden on Cockpit: its text is still the bound value
    const epsText = async () => ((await cockpitCell(page, 'br.eps27').textContent()) ?? '').trim();
    const eps = await epsText();
    const funding = slider(page, OUTSIDE);

    await funding.focus();
    await page.keyboard.press('Home');
    await expect(page).not.toHaveURL(new RegExp(presetC));
    await expect(funding).toHaveValue(String(out.min));
    await expectCockpitValue(page, 'res.net', net - swing, 'net with nothing funded outside');
    expect(await epsText(), 'EPS at 0%').toBe(eps);

    await funding.focus();
    await page.keyboard.press('End');
    await expect(funding).toHaveValue(String(out.max));
    await expectCockpitValue(page, 'res.net', net + swing, 'net with everything funded outside');
    expect(await epsText(), 'EPS at 100%').toBe(eps);
    // the swing the storyline quotes is the one-time tile of C
    expect(fmt.money(swing)).toBe(fmt.money(goldenOf('C', 'res.tot_ot_it')));
  });

  // "Show me one line.": Baseline, click a line, edit the amount.
  test('q_one_line_baseline_click_a_line_and_edit_the_amount', async () => {
    await open(page, presetC, 'baseline');
    const row = page.locator('.gp-bl-lines tr[data-line]').first();
    const amount = row.locator('button[data-id="line.amount"]');
    const before = (await amount.innerText()).trim();
    await amount.click();
    await expect(popover(page)).toBeVisible();
    const range = popover(page).getByRole('slider');
    const from = Number(await range.inputValue());
    await range.press('ArrowRight');
    await expect(page).not.toHaveURL(new RegExp(presetC));
    await expect(edits(page)).toHaveAccessibleName(SOME_EDITS);
    const to = Number(await range.inputValue());
    expect(to).toBeGreaterThan(from);
    await page.keyboard.press('Escape');
    await expect(popover(page)).toBeHidden();
    await expect(amount).toHaveText(fmt.money(to, { digits: 2 }));
    expect(fmt.money(to, { digits: 2 })).not.toBe(before);
    // the changeset names the line
    await edits(page).click();
    await expect(
      page
        .getByRole('dialog', { name: /^Changeset/ })
        .getByRole('list', { name: 'Changes' })
        .getByRole('listitem'),
    ).toHaveCount(1);
    await page.keyboard.press('Escape');
  });

  // "Can we start in Q2?": Levers, start month for the people levers (L03 to L05).
  test('q_start_in_q2_start_month_of_the_people_levers', async () => {
    const start = variable('lev.start');
    // Q2 begins in April
    const april = '4';
    expect(start.min).toBeLessThanOrEqual(Number(april));
    await open(page, presetC, 'levers');
    for (const lever of PEOPLE_LEVERS) {
      await page.locator(`button[data-lever="${lever}"]`).click();
      const select = page.locator(`[data-lever-detail="${lever}"] select[data-variable-id="lev.start"]`);
      await expect(select).toBeVisible();
      const was = await select.inputValue();
      const inYearBefore = numberIn(await leverInYear(page, lever).innerText());
      // a lever that already starts in April has nothing to move: take the next quarter
      const to = was === april ? '7' : april;
      await select.selectOption(to);
      await expect(select).toHaveValue(to);
      await expect(page).not.toHaveURL(new RegExp(presetC));
      await expect
        .poll(async () => numberIn(await leverInYear(page, lever).innerText()), {
          message: `${lever} in-year after starting later`,
        })
        .toBeLessThan(inYearBefore);
    }
    await expect(edits(page)).toHaveAccessibleName(SOME_EDITS);
  });
});
