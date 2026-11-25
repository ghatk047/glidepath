import type { TourPlacement } from '@glidepath/ui/overlays/tour';
import type { ModuleId } from '../../app/modules';

/** Bump to show the Tour button's dot again after the copy changes. */
export const TOUR_VERSION = '1';

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
   * Presentation copy. Numbers only as placeholders: `{res.net}`, `{base.locked_share|pct}`,
   * `{vp.net[vp_x]}` (member), `{tenant}` (tenant name from tier 2). See `body.tsx`.
   */
  body: string;
}

/** The 14 steps (07 §4.2). Steps 1 to 11 follow storyline beats 1 to 11. */
export const TOUR_STEPS: readonly TourStepDef[] = [
  {
    id: 'bar',
    module: 'cockpit',
    anchor: '[data-testid="cockpit-net"]',
    placement: 'right',
    title: 'The bar',
    body: 'Net {res.net} against a bar of {res.bar}: the target {res.target} plus cost growth {base.headwinds}.',
  },
  {
    id: 'baseline',
    module: 'baseline',
    anchor: '.gp-treemap',
    placement: 'right',
    title: 'Where the money is',
    body: '{base.locked_share|pct} of {base.total} is locked: it cannot move this year.',
  },
  {
    id: 'rates',
    module: 'cockpit',
    anchor: '.gp-seg',
    placement: 'bottom',
    title: 'Scenarios',
    body: 'Try R: squeezing vendor rates alone is not a plan.',
  },
  {
    id: 'levers',
    module: 'levers',
    anchor: '[data-lever-detail]',
    placement: 'left',
    title: 'Levers',
    body: 'Each lever has its own timing and confidence. Watch the strip below.',
  },
  {
    id: 'vps',
    module: 'vps',
    anchor: '.gp-vps-rows',
    placement: 'top',
    title: 'Who owns what',
    body: 'Drag a domain toward another VP. Every VP bar follows.',
  },
  {
    id: 'path',
    module: 'path',
    anchor: '.gp-path-actions',
    placement: 'top',
    title: 'Find a path',
    body: 'The least risky way to {res.bar}, as ranked moves.',
  },
  {
    id: 'odds',
    module: 'path',
    anchor: '[data-testid="path-odds"]',
    placement: 'left',
    title: 'Odds',
    body: 'If each lever only delivers its confidence, how often is the bar cleared?',
  },
  {
    id: 'market',
    module: 'market',
    anchor: '[data-testid="market-trace"]',
    placement: 'right',
    title: 'Shareholders',
    body: 'IT net becomes {br.eps27|eps} of EPS, about {br.px27} a share.',
  },
  {
    id: 'handover',
    module: 'cockpit',
    anchor: '[data-testid="cockpit-inputs"]',
    placement: 'left',
    title: 'Your numbers',
    body: 'Outside funding and the target are yours to change.',
  },
  {
    id: 'excel',
    module: 'excel',
    anchor: '[data-module="excel"] .gp-xl-chips',
    placement: 'bottom',
    title: 'Excel',
    body: 'Export, work offline, import. The app shows exactly what changed.',
  },
  {
    id: 'airlines',
    module: 'airlines',
    anchor: '[data-testid="airlines-grid"]',
    placement: 'top',
    title: 'Airlines',
    body: '{tenant} is the first airline on it, not the only one.',
  },
  {
    id: 'wizard',
    module: 'wizard',
    anchor: '[data-wizard-stepper]',
    placement: 'bottom',
    title: 'Build a plan',
    body: 'Pick levers, tune them, set policy, see the result.',
  },
  {
    id: 'optimize',
    module: 'wizard',
    anchor: '[data-wizard-optimize]',
    placement: 'bottom',
    title: 'Optimize',
    body: 'From any step, let the solver find the least risky path.',
  },
  {
    id: 'restart',
    module: null,
    anchor: '[data-tour-button]',
    placement: 'bottom',
    title: 'Any time',
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
  wizard: 'wizard',
  close: 'restart',
} as const satisfies Record<string, string>;
export type TourChapter = keyof typeof TOUR_CHAPTERS;

export const stepIndex = (id: string): number => TOUR_STEPS.findIndex((s) => s.id === id);
