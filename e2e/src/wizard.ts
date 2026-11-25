import { readRepoJson } from '@glidepath/int';

/**
 * Selectors and expected values of the wizard and tour specs (WIZ-11, `docs/ux/07_wizard_tour_plan.md`
 * §3.9 data attributes, §4.2 tour steps). Pure: nothing here reads the page. Numbers come from the
 * spec bundle (`golden_results.json`, `variables.json`), never from code.
 */

/** Stable hooks of the wizard (plan §3.9, as built in `web/src/modules/wizard`). */
export const WZ = {
  module: 'main[data-module="wizard"]',
  stepper: '[data-wizard-stepper]',
  tape: '[data-wizard-tape]',
  tapeFind: '[data-wizard-optimize]',
  next: '[data-wizard-next]',
  back: '[data-wizard-back]',
  optimizer: '[data-wizard-optimizer]',
  find: '[data-wizard-find]',
  use: '[data-wizard-use]',
  step: (n: number) => `[data-wizard-step="${n}"]`,
  stepButton: (n: number) => `.gp-wz-step[data-step="${n}"]`,
  lever: (lever: string) => `button[data-lever="${lever}"]`,
  leverRow: 'li.gp-wz-row',
  leverDetail: (lever: string) => `[data-lever-detail="${lever}"]`,
  /** The value inside a tape term (`inyear`, `onetime`, `net`, `bar`). */
  tapeValue: (term: string) => `[data-wizard-tape] [data-term="${term}"] [data-value]`,
  compute: '[data-compute]',
  flow: '[data-testid="wizard-flow"]',
  found: '[data-testid="wizard-found"]',
  moves: 'ol.gp-wzr-moves',
  variable: (id: string) => `[data-variable-id="${id}"]`,
} as const;

/** Step labels of the stepper (plan §3.8). */
export const STEP_LABELS = ['Levers', 'Tune', 'Policy', 'Result'] as const;

/** One tour step as the plan's table (§4.2) fixes it: id, screen and highlighted element. */
export interface TourStepSpec {
  readonly id: string;
  /** Screen (module route) the step lives on; `null` = stays where it is. */
  readonly module: string | null;
  /** CSS selector of the spotlight target; `null` = centred card. */
  readonly anchor: string | null;
}

export const TOUR_STEP_SPECS: readonly TourStepSpec[] = [
  { id: 'bar', module: 'cockpit', anchor: '[data-testid="cockpit-net"]' },
  { id: 'baseline', module: 'baseline', anchor: '.gp-treemap' },
  { id: 'rates', module: 'cockpit', anchor: '.gp-seg' },
  { id: 'levers', module: 'levers', anchor: '[data-lever-detail]' },
  { id: 'vps', module: 'vps', anchor: '.gp-vps-rows' },
  { id: 'path', module: 'path', anchor: '.gp-path-actions' },
  { id: 'odds', module: 'path', anchor: '[data-testid="path-odds"]' },
  { id: 'market', module: 'market', anchor: '[data-testid="market-trace"]' },
  { id: 'handover', module: 'cockpit', anchor: '[data-testid="cockpit-inputs"]' },
  { id: 'excel', module: 'excel', anchor: '[data-module="excel"] .gp-xl-chips' },
  { id: 'airlines', module: 'airlines', anchor: '[data-testid="airlines-grid"]' },
  { id: 'wizard', module: 'wizard', anchor: '[data-wizard-stepper]' },
  { id: 'optimize', module: 'wizard', anchor: '[data-wizard-optimize]' },
  { id: 'restart', module: null, anchor: '[data-tour-button]' },
];

/** Chapter names of the `?tour=` deep link and the step each opens (`global/tour/steps.ts`). */
export const TOUR_CHAPTER_STEPS: Readonly<Record<string, string>> = {
  main: 'bar',
  levers: 'levers',
  wizard: 'wizard',
  close: 'restart',
};

/** `lev.L10.shelf[]` → `lev.L10.shelf`; `lev.start[L03]` → `lev.start`. */
export const variableOfCell = (cell: string): string => /^(.*)\[.*\]$/.exec(cell)?.[1] ?? cell;

/** The cells of `cells` that belong to lever `lever`: the controls `lev.<Lxx>.*` (spec ids, verbatim). */
export const cellsOfLever = (cells: readonly string[], lever: string): string[] =>
  cells.filter((c) => variableOfCell(c).startsWith(`lev.${lever}.`));

/** The number in a displayed text (`$119.3M` → 119.3, `−$4.9M short` → −4.9); NaN when nothing is drawn ("—"). */
export const numberIn = (text: string): number => {
  const m = /[−-]?\$?([\d,]+(?:\.\d+)?)/.exec(text);
  if (!m) return Number.NaN;
  return Number(m[1]!.replace(/,/g, '')) * (/^[−-]/.test(m[0]) ? -1 : 1);
};

export const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

interface GoldenLevers {
  scenarios: Record<
    string,
    Record<string, number | Record<string, Record<string, number>>> & {
      levers: Record<string, Record<'rr' | 'iy' | 'ot' | 'cx', number>>;
    }
  >;
}
const goldenFile = () =>
  readRepoJson<GoldenLevers>('docs', 'spec', 'reference', 'golden_results.json');

/** `lev.iy[lever]` of a preset in the golden results ($M). */
export function goldenLeverInYear(letter: string, lever: string): number {
  const v = goldenFile().scenarios[letter]?.levers[lever]?.iy;
  if (typeof v !== 'number') throw new Error(`golden_results.json has no ${letter}.levers.${lever}.iy`);
  return v;
}

/**
 * The tape's In-year (`res.tot_iy`) of preset `letter` with the levers in `off` switched off: the
 * golden total less each switched-off lever's golden `lev.iy` (the in-year total is their sum).
 */
export function expectedInYear(letter: string, goldenTotal: number, off: readonly string[]): number {
  return off.reduce((total, lever) => total - goldenLeverInYear(letter, lever), goldenTotal);
}

interface RegistryVariable {
  id: string;
  label: string;
  min: number | null;
  max: number | null;
  step: number | null;
  kind: string;
  ui: { control?: string };
}
const registry = () => readRepoJson<{ variables: RegistryVariable[] }>('docs', 'spec', 'variables.json');

/** A registry variable by its spec id. */
export function registryVariable(id: string): RegistryVariable {
  const v = registry().variables.find((x) => x.id === id);
  if (!v) throw new Error(`the registry has no ${id}`);
  return v;
}

/**
 * Slider controls of a lever as the Tune step lists them (`lev.<Lxx>.*` with `ui.control: slider`);
 * `decisions` keeps the ones shown open, the rest sit under the collapsed Assumptions.
 */
export const leverSliders = (lever: string, decisions = false): string[] =>
  registry()
    .variables.filter(
      (v) =>
        v.id.startsWith(`lev.${lever}.`) &&
        v.ui.control === 'slider' &&
        (!decisions || v.kind === 'decision'),
    )
    .map((v) => v.id);

/** `br.eps27` of the oracle's minimum-risk path (`solver_demo_results.json`, `min_risk_total_bar.eps27`). */
export function demoPathEps27(): number {
  const v = readRepoJson<{ min_risk_total_bar: { eps27?: number } }>(
    'docs',
    'spec',
    'reference',
    'solver_demo_results.json',
  ).min_risk_total_bar.eps27;
  if (typeof v !== 'number') throw new Error('solver_demo_results.json has no min_risk_total_bar.eps27');
  return v;
}
