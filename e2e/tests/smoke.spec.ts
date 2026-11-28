import type {
  BenchmarkGap,
  BusinessCase,
  ConsolidationResult,
  RenewalCalendar,
  SolverRun,
  VendorSpend,
} from '@glidepath/api-contract';
import { config, readRepoJson } from '@glidepath/int';
import { fmt } from '@glidepath/ui/format';
import type { Page, Response } from '@playwright/test';
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
 * SRC-21 adds Sourcing and Plan (each panel shows the numbers tier 2 answered, rendered through `fmt`),
 * the Savings vs risk frontier on Path and Solve for this in the edit popover.
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

/**
 * What tier 2 answered the page: the last JSON body of each `/api/t/<tenant>/...` path, and the last finished
 * solver run of each problem (lookups, quick runs and job read-backs alike). The specs compare the screen with
 * these, so they assert what tier 2 sent, never a number computed here.
 */
function tier2Answers(page: Page) {
  const bodies = new Map<string, unknown>();
  const runs = new Map<string, SolverRun>();
  const listen = async (r: Response) => {
    const path = new URL(r.url()).pathname;
    if (!path.startsWith('/api/') || !r.ok()) return;
    let body: unknown;
    try {
      body = await r.json();
    } catch {
      return;
    }
    bodies.set(path.replace(/^\/api\/t\/[^/]+/, ''), body);
    const run = ((body as { run?: SolverRun }).run ?? body) as Partial<SolverRun> | null;
    if (run?.spec?.problem && run.status === 'done' && run.result) runs.set(run.spec.problem, run as SolverRun);
  };
  page.on('response', listen);
  return {
    body: <T,>(path: string) => bodies.get(path) as T | undefined,
    run: (problem: string) => runs.get(problem),
    stop: () => page.off('response', listen),
  };
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

  test('sourcing_panels_show_tier2_spend_renewals_benchmarks_consolidation', async () => {
    const t2 = tier2Answers(page);
    await page.goto(`/${config.tenant}/${presetC}/sourcing`);
    await expect(page.getByRole('main', { name: 'Sourcing' })).toBeVisible();

    // vendor spend: the 3rd-party total and the top vendor's spend, as tier 2 sent them
    const vendors = page.locator('[data-testid="sourcing-vendors"]');
    await expect.poll(() => t2.body<VendorSpend>('/sourcing/vendors') !== undefined).toBe(true);
    const v = t2.body<VendorSpend>('/sourcing/vendors')!;
    await expect(vendors.locator('[data-kpi="spend"] dd')).toHaveText(fmt.money(v.totals.thirdPartySpend));
    await expect(vendors.locator('li.gp-src-vendor').first().locator('[data-value]')).toHaveAttribute(
      'data-value',
      String(v.vendors[0]!.spend),
    );

    // renewals: the count of every status
    const renewals = page.locator('[data-testid="sourcing-renewals"]');
    await expect.poll(() => t2.body<RenewalCalendar>('/sourcing/renewals') !== undefined).toBe(true);
    const r = t2.body<RenewalCalendar>('/sourcing/renewals')!;
    for (const [status, n] of Object.entries(r.totals.byStatus)) {
      await expect(renewals.locator(`[data-status-count="${status}"]`), status).toHaveText(String(n));
    }
    await expect(renewals.locator('[data-kpi="value"] dd')).toHaveText(fmt.money(r.totals.annualValue));

    // should-cost: the gap to target
    await expect.poll(() => t2.body<BenchmarkGap>('/sourcing/benchmarks') !== undefined).toBe(true);
    const b = t2.body<BenchmarkGap>('/sourcing/benchmarks')!;
    await expect(page.locator('[data-testid="sourcing-benchmarks"] [data-kpi="opportunity"] dd')).toHaveText(
      fmt.money(b.totals.opportunity),
    );

    // consolidation optimizer (POST, computes): the saving it found
    await expect.poll(() => t2.body<ConsolidationResult>('/sourcing/consolidation') !== undefined).toBe(true);
    const c = t2.body<ConsolidationResult>('/sourcing/consolidation')!;
    await expect(page.locator('[data-testid="sourcing-consolidation"] [data-kpi="saving"] dd')).toHaveText(
      fmt.money(c.totals.annualSaving),
    );
    t2.stop();
  });

  test('plan_panels_show_tier2_breakeven_stress_business_case_wave_plan', async () => {
    const t2 = tier2Answers(page);
    await page.goto(`/${config.tenant}/${presetC}/plan`);
    await expect(page.getByRole('main', { name: 'Plan' })).toBeVisible();

    // business case: portfolio NPV, one-time and run-rate
    const bc = page.locator('[data-testid="plan-business-case"]');
    await expect.poll(() => t2.body<BusinessCase>('/plan/business-case') !== undefined).toBe(true);
    const totals = t2.body<BusinessCase>('/plan/business-case')!.totals;
    await expect(bc.locator('[data-kpi="npv"] dd')).toHaveText(fmt.money(totals.npv));
    await expect(bc.locator('[data-kpi="onetime"] dd')).toHaveText(fmt.money(totals.oneTime));
    await expect(bc.locator('[data-kpi="runrate"] dd')).toHaveText(fmt.money(totals.runRate));

    // breakeven: one row per lever input of the run, and tier 2's count of those that close the gap alone
    const be = page.locator('[data-testid="plan-breakeven"]');
    await expect(async () => {
      const run = t2.run('breakeven');
      expect(run, 'a finished breakeven run').toBeDefined();
      const d = run!.result!.detail;
      if (d?.problem !== 'breakeven') throw new Error('breakeven detail missing');
      expect(d.rows.length).toBeGreaterThan(0);
      await expect(be.locator('li[data-cell]')).toHaveCount(d.rows.length, { timeout: 1_000 });
      await expect(be.getByTestId('plan-breakeven-count')).toHaveText(fmt.fte(run!.result!.metrics['feasible']!), {
        timeout: 1_000,
      });
    }).toPass({ timeout: 30_000 });

    // stress: one row per shock tier 2 ran
    const stress = page.locator('[data-testid="plan-stress"]');
    await expect(async () => {
      const d = t2.run('stress_presets')?.result?.detail;
      if (d?.problem !== 'stress_presets') throw new Error('no finished stress run yet');
      expect(d.presets.length).toBeGreaterThan(0);
      await expect(stress.locator('tr[data-preset]')).toHaveCount(d.presets.length, { timeout: 1_000 });
      await expect(stress.locator(`tr[data-preset="${d.presets[0]!.name}"]`)).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 30_000 });

    // wave planner (worker job): the plan's status as tier 2 reports it
    const wave = page.locator('[data-testid="plan-waves"]');
    await expect(async () => {
      const run = t2.run('wave_plan');
      expect(run, 'a finished wave_plan run').toBeDefined();
      await expect(wave.getByTestId('plan-wave-status')).toHaveText(run!.result!.status, { timeout: 1_000 });
    }).toPass({ timeout: 45_000 });
    t2.stop();
  });

  test('path_savings_vs_risk_draws_the_frontier', async () => {
    const t2 = tier2Answers(page);
    await page.goto(`/${config.tenant}/${presetC}/path`);
    const scatter = page.getByTestId('path-scatter');
    await expect(scatter).toBeVisible();
    await expect(async () => {
      const d = t2.run('pareto')?.result?.detail;
      if (d?.problem !== 'pareto') throw new Error('no finished pareto run yet');
      const feasible = d.points.filter((p) => p.feasible).length;
      expect(feasible).toBeGreaterThan(1);
      await expect(scatter.locator('[data-part="frontier-point"]')).toHaveCount(feasible, { timeout: 1_000 });
      await expect(scatter.locator('polyline[data-part="frontier"]')).toHaveAttribute('points', /\d+(\.\d+)?,\d/, {
        timeout: 1_000,
      });
    }).toPass({ timeout: 45_000 });
    t2.stop();
  });

  test('solve_for_this_finds_a_value_for_the_net_target', async () => {
    // locked preset C: the solve only reads (save: false); Apply is never pressed, so nothing is written
    const t2 = tier2Answers(page);
    await page.goto(`/${config.tenant}/${presetC}/cockpit`);
    await expect(edits(page)).toHaveAccessibleName('0 edits: open changeset');
    // ⌘K finds the input by its id; Enter opens the global edit popover, which carries Solve for this
    await page.keyboard.press('Control+k');
    const palette = page.getByRole('dialog', { name: 'Find any number' });
    await palette.getByRole('combobox').fill(TARGET);
    await expect(palette.locator(`[role="option"][data-id="${TARGET}"]`)).toBeVisible();
    await palette.getByRole('combobox').press('Enter');
    await expect(page.locator('.gp-pop[role="dialog"]')).toBeVisible();
    const solve = page.getByRole('region', { name: 'Solve so the gap closes' });
    await expect(solve).toBeVisible();
    await solve.getByRole('button', { name: 'Solve for this' }).click();
    const result = solve.getByTestId('solve-result');
    await expect(result).toBeVisible({ timeout: 20_000 });
    await expect(result).toHaveText(/^(Value found|Not reachable in range\. Best value): \S*\d/);
    const run = t2.run('goal_seek');
    expect(run, 'a finished goal_seek run').toBeDefined();
    const d = run!.result!.detail;
    if (d?.problem !== 'goal_seek') throw new Error('goal_seek detail missing');
    expect(run!.spec.params).toMatchObject({ var: `${TARGET}[]`, output: 'res.gap[]' });
    await expect(result).toHaveAttribute('data-reachable', String(d.reachable));
    await page.keyboard.press('Escape');
    await expect(edits(page)).toHaveAccessibleName('0 edits: open changeset');
    t2.stop();
  });

  test('suite_finishes_within_the_g9_budget', () => {
    expect(Date.now() - STARTED).toBeLessThan(BUDGET_MS);
  });
});
