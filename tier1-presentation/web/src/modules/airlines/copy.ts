import type { OnboardingState, ReconfigJob } from '@glidepath/api-contract';

/** Words of the Airlines screen (03_screens "Airlines"; airlines-dark-1440.jpg). */
export const COPY = {
  module: 'Airlines',
  tiles: 'Airlines',
  live: 'Live',
  draft: 'Draft',
  notStarted: 'Not started',
  newTag: 'New',
  continueSetup: 'Continue setup',
  setUpWithAi: 'Set up with AI',
  addAirline: 'Add an airline',
  addBlurb: 'Describe it. The AI drafts every input with a source, then waits for your review.',
  reconfigure: 'Reconfigure with AI',
  nothingWritten: 'nothing is written until you accept',
  promptLabel: 'Describe the airline or the change',
  promptPlaceholder: 'Set up Alaska Airlines for CY27, target 10% of base',
  draftButton: 'Draft',
  startJob: 'Start job',
  cancelEstimate: 'Not now',
  estimate: 'Cost estimate',
  review: 'Review',
  apply: 'Apply',
  applying: 'Applying…',
  applied: 'Applied',
  plan: 'Plan',
  sources: 'Sources',
  openQuestions: 'Open questions',
  blocking: 'blocks apply',
  calibration: 'Calibration',
  calibrationPassed: 'Ties to the 10-K',
  calibrationFailed: 'Does not tie yet',
  changesets: 'Changesets',
  noSource: 'no source',
  global: ['Global', 'Formulas, levers, pools, solvers, Excel template'],
  perAirline: ['Per airline', 'Lines, org, vendors, headcount, corporate drivers'],
  upgrades: ['Upgrades', 'Pinned per airline; golden tests before and after'],
  onboarding: 'Onboarding',
  onboardingEmpty: 'Draft an airline to see its onboarding steps.',
  parity: 'parity',
  done: 'Done',
  inReview: 'In review',
  toDo: 'To do',
  note: 'Prototype. Scenario numbers are the engine’s golden results for the reference tenant. Live slider edits use the spec’s exact identities where they exist (target, outside funding, VP ownership) and proportional estimates elsewhere until the engine is connected.',
} as const;

/** The four visible steps of 03_screens, each a group of tier 2's pipeline steps (06 §2). */
export const PIPELINE = [
  { id: 'plan', label: 'Plan members & values' },
  { id: 'validate', label: 'Validate · ties to the 10-K' },
  { id: 'review', label: 'Review one changeset' },
  { id: 'apply', label: 'Apply · undo any time' },
] as const;
export type PipelineId = (typeof PIPELINE)[number]['id'];

/**
 * Words of the onboarding steps (07 section 2), by the step id tier 2 sends on the job
 * (`job.onboarding.steps[].id`). Which steps a job has, in what order and in which state is tier 2's;
 * an id this table does not know is shown by its own words.
 */
const STEP_LABEL: Readonly<Record<string, string>> = {
  tenant_record: 'Tenant record',
  baseline_lines: 'Baseline lines (outside-in)',
  org: 'Org & domain ownership',
  workforce: 'Workforce & rates',
  vendors: 'Vendors',
  corporate_drivers: 'Corporate drivers · tie to the 10-K',
  target: 'Target & funding',
  scenarios: 'Scenarios from presets',
  sources: 'Sources & confidence',
};

export const stepLabel = (id: string): string => {
  const known = STEP_LABEL[id];
  if (known) return known;
  const words = id.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
};

export type StepState = OnboardingState;

export const cyLabel = (year: number): string => `CY${String(year).slice(-2)}`;

export const jobIsLive = (j: Pick<ReconfigJob, 'status'> | null): boolean =>
  j?.status === 'queued' || j?.status === 'running';
