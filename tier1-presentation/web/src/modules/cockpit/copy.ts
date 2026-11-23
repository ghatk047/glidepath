/**
 * Cockpit copy and the spec ids it binds (03_screens "Path to the bar"). Ids are verbatim from
 * `docs/spec`; words are UX copy. No numbers: every value on the screen comes from tier 2.
 */

/** Net savings panel (gauge, hero, stat row). */
export const NET_NODES = {
  net: 'res.net',
  bar: 'res.bar',
  target: 'res.target',
  gap: 'res.gap',
  risk: 'res.risk',
  runRate: 'res.tot_rr',
  oneTimeIt: 'res.tot_ot_it',
} as const;

/** The input behind `res.target` (edited from the "of $X bar" number, as in the prototype). */
export const TARGET_VARIABLE = 'g.target_net';

/** Cells the `bridge` view (ADR-021, DOM-06) carries, in step order. */
export const BRIDGE_CELLS = [
  'base.total',
  'base.headwinds',
  'res.tot_iy',
  'res.tot_ot_it',
  'res.cy27_outlay',
] as const;

/**
 * Short labels of the hero inputs as the Cockpit render shows them. Which inputs are hero comes
 * from the registry (`ui.hero`, via the bundle); an id not listed here shows its registry label.
 */
export const HERO_LABELS: Readonly<Record<string, string>> = {
  'g.target_net': 'Net target',
  'g.ot_out_share': 'One-time funded outside IT',
  'hc.us': 'US FTE',
  'hc.gcc': 'GCC FTE',
  'hc.ctr': 'Contractors',
};

/** Registry units drawn as a stepper (head counts); every other hero input is a slider. */
export const STEPPER_UNITS: ReadonlySet<string> = new Set(['FTE']);

/** Two-digit calendar year label (`2027` → `CY27`). Text only. */
export const cy = (year: number): string => `CY${String(year).slice(-2)}`;

export const COPY = {
  module: 'Cockpit',
  netLabel: (year: string) => `Net savings · ${year}`,
  bridgeLabel: (from: string, to: string) => `${from} → ${to} outlay`,
  inputsLabel: 'Your inputs',
  axisNote: (floor: string) => `axis starts at ${floor}`,
  of: 'of',
  bar: 'bar',
  risk: 'Risk-adjusted',
  /** The run-rate is the exit rate of the target year, read in the year after it. */
  runRate: (year: number | null) => (year === null ? 'Run-rate' : `${String(year)} run-rate`),
  oneTimeIt: 'One-time in IT',
  allInputs: (count: number | null) => (count === null ? 'All inputs' : `All ${String(count)}`),
  allInputsName: (count: number | null) =>
    count === null ? 'Find any input' : `Find any of the ${String(count)} inputs`,
  edited: 'edited',
  editTarget: 'Edit the net target',
} as const;
