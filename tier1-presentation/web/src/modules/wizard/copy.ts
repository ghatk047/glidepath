import type { WizardStep } from './store';

/** Wizard copy for the frame and steps 1-2 (plan §3.8). Short on purpose. */
export const COPY = {
  steps: { 1: 'Levers', 2: 'Tune', 3: 'Policy', 4: 'Result' } as Record<WizardStep, string>,
  stepsLabel: 'Steps',
  back: 'Back',
  next: 'Next',
  tape: {
    label: 'Running total',
    inYear: 'In-year',
    oneTime: 'One-time',
    net: 'Net',
    bar: 'Bar',
    minus: '−',
    equals: '=',
    vs: 'vs',
    find: 'Find a path',
    starting: 'Starting…',
  },
  levers: 'Levers',
  families: 'Families',
  total: 'Total',
  title: 'Build a plan',
  chosen: 'Chosen',
  decisions: 'Decisions',
  assumptions: 'Assumptions',
  switchedOff: 'Switched off',
  switchOn: 'Switch on',
  inYear: 'In-year',
  runRate: 'Run-rate',
  oneTime: 'One-time',
  confidence: 'Confidence',
  moved: 'Moved by the optimizer',
  none: 'No levers on',
} as const;

/** Variable id prefix of a lever's controls (`lev.L10.`), spec ids verbatim. */
export const leverPrefix = (lever: string): string => `lev.${lever}.`;

/** Scenario keys shown as ghost ticks on the lever sliders. */
export const GHOSTS = ['C', 'D'] as const;
