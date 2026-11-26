import type { TourPlacement } from '@glidepath/ui/overlays/tour';
import type { ModuleId } from '../../app/modules';

/** Bump to show the Tour button's dot again after the copy changes. */
export const TOUR_VERSION = '3';

export interface TourStepDef {
  /** Narrative id (`06_walkthrough_narrative.md` is keyed by it). */
  id: string;
  /** Screen the step lives on; `null` = any screen (stay where you are). */
  module: ModuleId | null;
  /** CSS selector of the highlighted element; `null` = centred card. */
  anchor: string | null;
  placement: TourPlacement;
  title: string;
  /**
   * For a first-time viewer (UIX-02): what this screen or control is for, in plain words, shown
   * above the body. No numbers, no placeholders, at most 22 words.
   */
  about: string;
  /**
   * Presentation copy. Numbers only as placeholders: `{res.net}`, `{base.locked_share|pct}`,
   * `{vp.net[vp_x]}` (member), `{tenant}` (tenant name from tier 2). See `body.tsx`.
   */
  body: string;
}

/** The 24 steps (07 §4.2 plus SRC-20). Steps follow storyline beats; Sourcing and Plan sit after Path. */
export const TOUR_STEPS: readonly TourStepDef[] = [
  {
    id: 'bar',
    module: 'cockpit',
    anchor: '[data-testid="cockpit-net"]',
    placement: 'right',
    title: 'The bar',
    about:
      'The Cockpit is the one-page answer. Every number is live and recalculates the moment anything changes.',
    body: 'Net {res.net} against a bar of {res.bar}: the target {res.target} plus cost growth {base.headwinds}.',
  },
  {
    id: 'baseline',
    module: 'baseline',
    anchor: '.gp-treemap',
    placement: 'right',
    title: 'Where the money is',
    about:
      "Baseline is this year's IT spend, line by line. Boxes are sized by cost and shaded by how much can move.",
    body: '{base.locked_share|pct} of {base.total} is locked: it cannot move this year.',
  },
  {
    id: 'rates',
    module: 'cockpit',
    anchor: '.gp-seg',
    placement: 'bottom',
    title: 'Scenarios',
    about:
      'Scenarios are ready-made plans, from vendor rates only to a full stretch. Switching is instant and saves nothing.',
    body: 'Try R: squeezing vendor rates alone is not a plan.',
  },
  {
    id: 'levers',
    module: 'levers',
    anchor: '[data-lever-detail]',
    placement: 'left',
    title: 'Levers',
    about:
      'Lever studio holds every savings idea with its own size, confidence and timing. Pick one on the left to tune it.',
    body: 'Each lever has its own timing and confidence. Watch the strip below.',
  },
  {
    id: 'vps',
    module: 'vps',
    anchor: '.gp-vps-rows',
    placement: 'top',
    title: 'Who owns what',
    about:
      'VPs shows how the bar splits across the technology VPs who own the spend, and whether each one clears.',
    body: 'Drag a domain toward another VP. Every VP bar follows.',
  },
  {
    id: 'path',
    module: 'path',
    anchor: '.gp-path-actions',
    placement: 'top',
    title: 'Find a path',
    about:
      'Find a path asks the solver for the lowest-risk mix of levers that reaches the bar.',
    body: 'The least risky way to {res.bar}, as ranked moves.',
  },
  {
    id: 'odds',
    module: 'path',
    anchor: '[data-testid="path-odds"]',
    placement: 'left',
    title: 'Odds',
    about:
      'Odds replays the year thousands of times, each lever delivering only what its confidence says.',
    body: 'If each lever only delivers its confidence, how often is the bar cleared?',
  },
  {
    id: 'frontier',
    module: 'path',
    anchor: '[data-testid="path-scatter"]',
    placement: 'left',
    title: 'Savings vs risk',
    about:
      'Savings vs risk plots each plan by net savings and risk, with a curve of the best trade-offs.',
    body: 'Each point on the curve is the most net for that much risk.',
  },
  {
    id: 'spend',
    module: 'sourcing',
    anchor: '[data-tour="sourcing-vendors"]',
    placement: 'right',
    title: 'Spend by vendor',
    about:
      'Sourcing is the procurement view. The spend cube shows who is paid how much, by category and contract.',
    body: 'Start with the vendors that carry the most spend.',
  },
  {
    id: 'renewals',
    module: 'sourcing',
    anchor: '[data-tour="sourcing-renewals"]',
    placement: 'left',
    title: 'Renewal calendar',
    about:
      'The renewal calendar shows when each contract can next be renegotiated, and how much notice is needed.',
    body: 'A saving only counts if the notice date is not missed.',
  },
  {
    id: 'benchmarks',
    module: 'sourcing',
    anchor: '[data-tour="sourcing-benchmarks"]',
    placement: 'right',
    title: 'Should-cost',
    about:
      'Should-cost compares what each contract pays with market benchmarks, to show where the price gap is.',
    body: 'The gap to the benchmark is the negotiating room.',
  },
  {
    id: 'consolidation',
    module: 'sourcing',
    anchor: '[data-tour="sourcing-consolidation"]',
    placement: 'left',
    title: 'Consolidation',
    about:
      'The consolidation optimizer tests moving spend to fewer vendors, trading volume discounts against concentration risk.',
    body: 'Fewer vendors can mean better prices, and more dependence.',
  },
  {
    id: 'breakeven',
    module: 'plan',
    anchor: '[data-tour="plan-breakeven"]',
    placement: 'right',
    title: 'Breakeven',
    about:
      'Plan is the IT leadership view. Breakeven asks how far one lever can fall short before the bar is missed.',
    body: 'See how much slack each lever has before the plan fails.',
  },
  {
    id: 'stress',
    module: 'plan',
    anchor: '[data-tour="plan-stress"]',
    placement: 'left',
    title: 'Stress tests',
    about:
      'Stress tests apply a shock, such as slower delivery or higher prices, and show what it does to net.',
    body: 'Change a shock size and see the plan absorb it.',
  },
  {
    id: 'case',
    module: 'plan',
    anchor: '[data-tour="plan-business-case"]',
    placement: 'right',
    title: 'Business case',
    about:
      'The business case turns the plan into cost, savings and payback over the years, as finance would read it.',
    body: 'Savings, one-time cost and payback in one view.',
  },
  {
    id: 'waves',
    module: 'plan',
    anchor: '[data-tour="plan-wave"]',
    placement: 'left',
    title: 'Wave planner',
    about:
      'The wave planner sequences the levers into delivery waves that respect capacity and dependencies.',
    body: 'Pick the order that lands savings soonest.',
  },
  {
    id: 'market',
    module: 'market',
    anchor: '[data-testid="market-trace"]',
    placement: 'right',
    title: 'Shareholders',
    about:
      'Market turns the IT savings into earnings per share and an implied share price.',
    body: 'IT net becomes {br.eps27|eps} of EPS, about {br.px27} a share.',
  },
  {
    id: 'handover',
    module: 'cockpit',
    anchor: '[data-testid="cockpit-inputs"]',
    placement: 'left',
    title: 'Your numbers',
    about:
      'Your inputs are the few numbers leadership sets. Change one and the whole app follows.',
    body: 'Outside funding and the target are yours to change.',
  },
  {
    id: 'solve',
    module: 'cockpit',
    anchor: '.gp-cockpit-bar',
    placement: 'bottom',
    title: 'Solve for this',
    about:
      'Any editable number can be solved backwards: tell the app the goal and it finds the input value.',
    body: 'Click the bar, then choose Solve for this to find the target that closes the gap.',
  },
  {
    id: 'excel',
    module: 'excel',
    anchor: '[data-module="excel"] .gp-xl-chips',
    placement: 'bottom',
    title: 'Excel',
    about:
      'Excel takes the model offline as a workbook and brings your edits back with a line-by-line diff.',
    body: 'Export, work offline, import. The app shows exactly what changed.',
  },
  {
    id: 'airlines',
    module: 'airlines',
    anchor: '[data-testid="airlines-grid"]',
    placement: 'top',
    title: 'Airlines',
    about:
      'Airlines: the same model runs for any carrier, each with its own data and its own access.',
    body: '{tenant} is the first airline on it, not the only one.',
  },
  {
    id: 'wizard',
    module: 'wizard',
    anchor: '[data-wizard-stepper]',
    placement: 'bottom',
    title: 'Build a plan',
    about:
      'Build is a guided way to assemble a plan in four steps, with a running total along the top.',
    body: 'Pick levers, tune them, set policy, see the result.',
  },
  {
    id: 'optimize',
    module: 'wizard',
    anchor: '[data-wizard-optimize]',
    placement: 'bottom',
    title: 'Optimize',
    about:
      'Optimize hands the plan to the solver, which proposes the least risky set of moves.',
    body: 'From any step, let the solver find the least risky path.',
  },
  {
    id: 'restart',
    module: null,
    anchor: '[data-tour-button]',
    placement: 'bottom',
    title: 'Any time',
    about:
      'Explore freely: every edit lands in the changeset tray, where it can be undone or discarded.',
    body: 'Restart the tour here. ⌘K finds any number.',
  },
];

/**
 * Chapters: named entry points for a presenter who needs to jump (`tourStore.startAt`). Each
 * value is a step id. The main run is steps 1 to 11, the wizard segment replaces 4 to 6.
 */
export const TOUR_CHAPTERS = {
  main: 'bar',
  levers: 'levers',
  sourcing: 'spend',
  plan: 'breakeven',
  wizard: 'wizard',
  close: 'restart',
} as const satisfies Record<string, string>;
export type TourChapter = keyof typeof TOUR_CHAPTERS;

export const stepIndex = (id: string): number => TOUR_STEPS.findIndex((s) => s.id === id);
