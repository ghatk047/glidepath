import { config } from '@glidepath/int';
import { fmt } from '@glidepath/ui/format';
import type { Page } from '@playwright/test';
import { PEOPLE_LEVERS, solverDemo } from '../src/storyline';
import {
  STEP_LABELS,
  WZ,
  cellsOfLever,
  expectedInYear,
  leverSliders,
  numberIn,
  registryVariable,
} from '../src/wizard';
import { edits, scenarioButton } from './cockpit';
import { expect, goldenOf, test } from './fixtures';

/**
 * WIZ-11: the Build wizard in a browser against the compose stack (`docs/ux/07_wizard_tour_plan.md` §3, §7.2).
 * Black box like the G9 smoke: signed in through the INT magic link, every expected number read from the
 * spec bundle (`golden_results.json`, `solver_demo_results.json`, `variables.json`) and formatted with the
 * UI's own `fmt`. Each test opens the wizard on the locked preset C itself, so a failing one does not hide
 * the next; an edit forks `Custom (from C)` like in the room.
 *
 * `INT_COMPOSE_PROJECT=<project> pnpm e2e:wizard -- --trace off`.
 *
 * Tier-2 finding checked here: a lever switched off must get no `lev.<Lxx>.*` move from the optimizer
 * (plan §3.6 "Switched-off levers stay off").
 */

const SHELF = 'lev.L10.shelf';
const OUTSIDE = 'g.ot_out_share';
const ANY_EDITS = /^[1-9]\d* edits?: open changeset$/;
const FIND_TIMEOUT = 90_000;

async function openWizard(page: Page, scenario: string, search = ''): Promise<void> {
  await page.goto(`/${config.tenant}/${scenario}/wizard${search}`);
  await expect(page.locator(WZ.module)).toBeVisible();
  await expect(page.locator(WZ.step(1))).toBeVisible();
}

const tape = (page: Page, term: string) => page.locator(WZ.tapeValue(term)).first();
const tapeNumber = async (page: Page, term: string): Promise<number> =>
  Number(await tape(page, term).getAttribute('data-value'));
const range = (page: Page, id: string) =>
  page.getByRole('slider', { name: registryVariable(id).label, exact: true }).first();
const onStep = (page: Page, n: number) =>
  expect(page.locator(WZ.stepButton(n))).toHaveAttribute('aria-current', 'step');
const leverRow = (page: Page, lever: string) =>
  page.locator(WZ.leverRow).filter({ has: page.locator(WZ.lever(lever)) });
const moveCells = (page: Page) =>
  page.locator(`${WZ.optimizer} li[data-cell]`).evaluateAll((els) =>
    els.map((e) => e.getAttribute('data-cell') ?? ''),
  );

/** Records whether an indicator was ever mounted from now on (a run may finish within a frame). */
async function watchCompute(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __sawCompute: boolean };
    w.__sawCompute = document.querySelector('[data-compute]') !== null;
    new MutationObserver(() => {
      if (document.querySelector('[data-compute]')) w.__sawCompute = true;
    }).observe(document.body, { childList: true, subtree: true });
  });
}
const sawCompute = (page: Page): Promise<boolean> =>
  page.evaluate(() => (window as unknown as { __sawCompute: boolean }).__sawCompute);

/** Waits until the optimizer's moves have landed (the list stops being busy). */
async function waitForMoves(page: Page): Promise<void> {
  await expect(page.locator(WZ.found)).toBeVisible({ timeout: FIND_TIMEOUT });
  await expect(page.locator(`${WZ.found} ${WZ.moves}[aria-busy="false"]`)).toBeVisible({
    timeout: 30_000,
  });
}

/** Pointer drag of a native range input to `to`; `during` runs while the button is still down. */
async function dragRange(
  page: Page,
  input: ReturnType<typeof range>,
  to: number,
  during?: () => Promise<void>,
): Promise<void> {
  await input.scrollIntoViewIfNeeded();
  const box = (await input.boundingBox())!;
  const min = Number(await input.getAttribute('min'));
  const max = Number(await input.getAttribute('max'));
  const from = Number(await input.inputValue());
  const y = box.y + box.height / 2;
  const at = (v: number) => box.x + ((v - min) / (max - min)) * box.width;
  await page.mouse.move(at(from), y);
  await page.mouse.down();
  const frames = 8;
  for (let i = 1; i <= frames; i++) await page.mouse.move(at(from + ((to - from) * i) / frames), y);
  await during?.();
  await page.mouse.up();
}

test.describe.configure({ mode: 'default' });

test.describe('Build wizard (WIZ-11)', () => {
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

  test('opens_on_step_1_with_the_tape_at_the_golden_values_of_c', async () => {
    await openWizard(page, presetC);
    await expect(page.getByRole('main', { name: 'Build a plan' })).toBeVisible();
    await expect(page.locator(`${WZ.stepper} .gp-wz-step-label`)).toHaveText([...STEP_LABELS]);
    await onStep(page, 1);
    await expect(page.locator(WZ.back)).toBeDisabled();
    // the tape: In-year − One-time = Net vs Bar, tier 2's nodes of preset C
    for (const [term, cell] of [
      ['inyear', 'res.tot_iy'],
      ['onetime', 'res.tot_ot_it'],
      ['net', 'res.net'],
      ['bar', 'res.bar'],
    ] as const) {
      await expect(tape(page, term)).toHaveText(fmt.money(goldenOf('C', cell)));
      await expect.poll(() => tapeNumber(page, term)).toBeCloseTo(goldenOf('C', cell), 6);
    }
    await expect(page.locator(`${WZ.tape} [data-node="res.gap"] .gp-chip`)).toContainText(
      fmt.money(Math.abs(goldenOf('C', 'res.gap'))),
    );
    await expect(page.locator(WZ.tapeFind)).toHaveText('Find a path');
    await expect(edits(page)).toHaveAccessibleName('0 edits: open changeset');
  });

  test('stepper_next_and_back_walk_the_four_steps_and_any_step_can_be_clicked', async () => {
    await openWizard(page, presetC);
    for (const n of [2, 3, 4]) {
      await page.locator(WZ.next).click();
      await onStep(page, n);
      await expect(page.locator(WZ.step(n))).toBeVisible();
    }
    await expect(page.locator(WZ.next)).toHaveCount(0); // Next is hidden on the last step
    await page.locator(WZ.back).click();
    await onStep(page, 3);
    await page.locator(WZ.stepButton(1)).click();
    await onStep(page, 1);
    await page.locator(WZ.stepButton(4)).click();
    await onStep(page, 4);
    await expect(page.locator(WZ.tape)).toBeVisible(); // the tape stays on every step
    // reading and walking never edits
    await expect(edits(page)).toHaveAccessibleName('0 edits: open changeset');
  });

  test('step_1_switching_a_lever_off_and_on_moves_the_tape_live', async () => {
    const lever = 'L11';
    const row = leverRow(page, lever);
    await openWizard(page, presetC);
    const tot = goldenOf('C', 'res.tot_iy');
    await expect(row.locator('[data-id="lev.iy"], [data-node="lev.iy"]').first()).toBeVisible();
    await row.getByRole('switch').click();
    await expect(row.getByRole('switch')).not.toBeChecked();
    await expect(page).not.toHaveURL(new RegExp(presetC)); // tier 2 forked Custom (from C)
    await expect(edits(page)).toHaveAccessibleName(ANY_EDITS);
    // In-year drops by the lever's own in-year value, Net follows
    await expect
      .poll(() => tapeNumber(page, 'inyear'))
      .toBeLessThan(tot);
    // about the lever's own in-year value: the levers overlap a little, so not to the cent
    await expect
      .poll(() => tapeNumber(page, 'inyear'))
      .toBeCloseTo(expectedInYear('C', tot, [lever]), 0);
    expect(await tapeNumber(page, 'net')).toBeLessThan(goldenOf('C', 'res.net'));
    await expect(row.locator('[data-value]').first()).toHaveText(fmt.money(0));
    await row.getByRole('switch').click();
    await expect(row.getByRole('switch')).toBeChecked();
    await expect.poll(() => tapeNumber(page, 'inyear')).toBeCloseTo(tot, 3);
    await expect.poll(() => tapeNumber(page, 'net')).toBeCloseTo(goldenOf('C', 'res.net'), 3);
  });

  test('pick_a_lever_tune_it_set_policy_and_read_the_result', async () => {
    const shelf = registryVariable(SHELF);
    const outside = registryVariable(OUTSIDE);
    await openWizard(page, presetC);

    // 1 Levers: pick Software (L10), which takes the wizard to Tune with that lever in focus
    await page.locator(WZ.lever('L10')).first().click();
    await onStep(page, 2);
    const detail = page.locator(WZ.leverDetail('L10'));
    await expect(detail).toBeVisible();
    // the lever's decision sliders are the registry's `lev.L10.*` controls
    for (const id of leverSliders('L10', true)) {
      await expect(
        detail.getByRole('slider', { name: registryVariable(id).label, exact: true }).first(),
      ).toBeAttached();
    }

    // 2 Tune: the tape moves before the pointer is released (the preview), and settles on commit
    const slider = range(page, SHELF);
    const before = Number(await slider.inputValue());
    const inYear0 = await tapeNumber(page, 'inyear');
    await dragRange(page, slider, Math.min(shelf.max!, before + 4 * shelf.step!), async () => {
      await expect.poll(() => tapeNumber(page, 'inyear')).toBeGreaterThan(inYear0);
    });
    await expect(page).not.toHaveURL(new RegExp(presetC));
    await expect(edits(page)).toHaveAccessibleName(ANY_EDITS);
    expect(Number(await slider.inputValue())).toBeGreaterThan(before);
    const inYear1 = await tapeNumber(page, 'inyear');
    expect(inYear1).toBeGreaterThan(inYear0);

    // 3 Policy: outside funding takes cost off IT's one-time line (a CFO's lever)
    await page.locator(WZ.next).click();
    await onStep(page, 3);
    const oneTime0 = await tapeNumber(page, 'onetime');
    const outsideRange = range(page, OUTSIDE);
    const from = Number(await outsideRange.inputValue());
    await outsideRange.focus();
    await page.keyboard.press(from + outside.step! <= outside.max! ? 'ArrowRight' : 'ArrowLeft');
    await expect.poll(() => tapeNumber(page, 'onetime')).not.toBeCloseTo(oneTime0, 3);
    const oneTime1 = await tapeNumber(page, 'onetime');
    await expect(page.locator('[data-testid="wizard-funding"] [data-node="res.tot_ot_it"]')).toContainText(
      fmt.money(oneTime1),
    );
    await expect(page.locator('[data-testid="wizard-ownership"]')).toBeVisible();

    // 4 Result: the same net and bar the tape shows, with the gap against it
    await page.locator(WZ.next).click();
    await onStep(page, 4);
    const net = await tapeNumber(page, 'net');
    await expect(page.locator('[data-testid="wizard-net"] [data-node="res.net"]').first()).toContainText(
      fmt.money(net).replace(/M$/, ''),
    );
    await expect(page.locator('[data-testid="wizard-net"]')).toContainText(
      fmt.money(await tapeNumber(page, 'bar')),
    );
    expect(numberIn(await tape(page, 'net').innerText())).toBeCloseTo(net, 1);
    await expect(page.locator('[data-testid="wizard-vps"] [data-member]').first()).toBeVisible();
    await expect(page.locator('[data-testid="wizard-risk"] [data-node="res.risk"]')).toBeVisible();
  });

  test('find_a_path_shows_the_math_flow_then_the_moves_land_on_the_bar', async () => {
    const demo = solverDemo().min_risk_total_bar;
    await openWizard(page, presetC);
    await watchCompute(page);
    await page.locator(WZ.tapeFind).click(); // from step 1, in the tape
    await onStep(page, 4); // Find a path takes the wizard to Result
    await expect(page.locator(WZ.optimizer)).toBeVisible();
    expect(await sawCompute(page), 'the math-flow indicator was shown while the solver ran').toBe(true);
    await waitForMoves(page);
    await expect(page.locator(`${WZ.optimizer} ${WZ.flow}`)).toHaveCount(0); // the flow ends with the run
    const found = page.locator(WZ.found);
    await expect(found).toHaveAttribute('data-status', /^(optimal|feasible)$/);
    await expect(found).toContainText('Bar cleared');
    // "The least risky way to one forty-three": the oracle's numbers, through the UI's fmt
    await expect(found.locator('[data-metric="Net"] dd')).toHaveText(fmt.money(demo.net));
    await expect(found.locator('[data-metric="One-time"] dd')).toHaveText(fmt.money(demo.one_time_it));
    await expect(found.locator('[data-metric="Risk exposure"] dd')).toHaveText(
      fmt.money(demo.risk_exposure),
    );
    const cells = await moveCells(page);
    expect(cells.length).toBeGreaterThan(0);
    for (const lever of PEOPLE_LEVERS) {
      expect(cellsOfLever(cells, lever), `${lever} untouched`).toEqual([]);
    }
    // finding a path writes nothing: the scenario is still C, unedited
    await expect(page).toHaveURL(new RegExp(`/${presetC}/wizard`));
    await expect(edits(page)).toHaveAccessibleName('0 edits: open changeset');
    // Discard drops the answer
    await found.getByRole('button', { name: 'Discard' }).click();
    await expect(page.locator(WZ.found)).toHaveCount(0);
  });

  test('find_a_path_from_the_result_step_button_runs_the_same_solver', async () => {
    await openWizard(page, presetC);
    await page.locator(WZ.stepButton(4)).click();
    await page.locator(WZ.find).click();
    await waitForMoves(page);
    await expect(page.locator(WZ.found)).toHaveAttribute('data-status', /^(optimal|feasible)$/);
    expect((await moveCells(page)).length).toBeGreaterThan(0);
  });

  test('use_this_path_switches_to_the_saved_scenario_and_marks_what_moved', async ({ stack }) => {
    const demo = solverDemo().min_risk_total_bar;
    await openWizard(page, presetC);
    await page.locator(WZ.tapeFind).click();
    await waitForMoves(page);
    const cells = await moveCells(page);
    await page.locator(WZ.use).click();

    await expect(page.getByText('Path applied')).toBeVisible({ timeout: 30_000 });
    await expect(page).not.toHaveURL(new RegExp(`/${presetC}/`));
    const id = new URL(page.url()).pathname.split('/')[2]!;
    // tier 2 wrote a `solver` scenario and the app is on it, still in the wizard on the Result step
    const { scenarios } = await stack.api.scenarios({ params: { tenant: config.tenant } });
    expect(scenarios.find((s) => s.id === id)?.kind).toBe('solver');
    await expect(page).toHaveURL(new RegExp(`/${id}/wizard`));
    await onStep(page, 4);
    await expect(scenarioButton(page, presetC)).toHaveAttribute('aria-pressed', 'false');
    // every bound number now shows the new scenario: net on the bar
    await expect.poll(() => tapeNumber(page, 'net')).toBeCloseTo(demo.net, 1);
    await expect(tape(page, 'net')).toHaveText(fmt.money(demo.net));
    // the moves stay in the list, and the controls they moved carry the accent mark in Tune
    expect(await moveCells(page)).toEqual(cells);
    const moved = page.locator('[data-moved]');
    await page.locator(WZ.stepButton(2)).click();
    const lever = /^lev\.(L\d+)\./.exec(cells[0]!)?.[1] ?? 'L10';
    await page.locator(WZ.lever(lever)).first().click();
    await expect(moved.first()).toBeVisible();
    await page.locator(WZ.stepButton(4)).click();
    await expect(page.locator(WZ.found)).toBeVisible();
  });

  test('switching_a_lever_off_gets_it_no_move_from_the_optimizer_l06', async () => {
    // L06 is on in C and off here: tier 2 must not move any of its controls (plan §3.6)
    await openWizard(page, presetC);
    const row = leverRow(page, 'L06');
    await row.getByRole('switch').click();
    await expect(row.getByRole('switch')).not.toBeChecked();
    await expect(page).not.toHaveURL(new RegExp(presetC));
    await page.locator(WZ.tapeFind).click();
    await waitForMoves(page);
    const cells = await moveCells(page);
    expect(cells.length).toBeGreaterThan(0);
    expect(cellsOfLever(cells, 'L06'), 'no lev.L06.* move for a lever that is off').toEqual([]);
  });

  test('switching_a_lever_the_oracle_moves_off_gets_it_no_move_either_l11', async () => {
    // Cloud FinOps (`lev.L11.pct`) is among the minimum-risk path's moves from C: off, it must stay put
    await openWizard(page, presetC);
    const row = leverRow(page, 'L11');
    await row.getByRole('switch').click();
    await expect(row.getByRole('switch')).not.toBeChecked();
    await page.locator(WZ.tapeFind).click();
    await waitForMoves(page);
    const cells = await moveCells(page);
    expect(cells.length).toBeGreaterThan(0);
    expect(cellsOfLever(cells, 'L11'), 'no lev.L11.* move for a lever that is off').toEqual([]);
  });
});

test.describe('Compute indicator with reduced motion (WIZ-11)', () => {
  test('the_math_flow_has_no_running_animation_when_the_viewer_prefers_reduced_motion', async ({
    browser,
    stack,
  }) => {
    // a fresh copy of C, then an edit, so the solver is a real run and the indicator is on screen for a while
    const copy = await stack.api.scenarioCreate({
      params: { tenant: config.tenant },
      body: { mode: 'copy', from: stack.presets.get('C')!.id, label: 'wizard e2e (reduced motion)' },
    });
    const context = await browser.newContext({ reducedMotion: 'reduce', ignoreHTTPSErrors: true });
    const page = await context.newPage();
    try {
      await stack.signInPage(page);
      await openWizard(page, copy.id);
      const row = leverRow(page, 'L06');
      await row.getByRole('switch').click();
      await expect(row.getByRole('switch')).not.toBeChecked();
      await page.locator(WZ.tapeFind).click();
      const compute = page.locator(`${WZ.module} ${WZ.compute}`).first();
      await expect(compute).toBeAttached({ timeout: 15_000 });
      const running = await compute.evaluate((el) => el.getAnimations({ subtree: true }).length);
      expect(running, 'no CSS animation runs on the indicator').toBe(0);
      await waitForMoves(page);
    } finally {
      await context.close();
    }
  });
});
