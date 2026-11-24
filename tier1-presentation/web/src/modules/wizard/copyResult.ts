/**
 * Wizard steps 3 and 4: copy and the spec ids they bind (07_wizard_tour_plan §3.4, §3.5, §3.8).
 * Ids are verbatim from `docs/spec`; words are UX copy. No numbers: every value on screen is
 * tier 2's (a node, a variable or a solver result).
 */

export const COPY = {
  // Step 3
  policy: 'Policy',
  target: 'Target',
  funding: 'Funding',
  timing: 'Timing',
  ownership: 'Ownership',
  absorbGrowth: 'Absorb growth',
  growth: 'Growth',
  bar: 'Bar',
  onIt: 'On IT',
  outsideIt: 'Outside IT',
  headStart: 'Head start',
  start: 'Start',
  ramp: 'Ramp',
  outlay: 'Outlay',
  // Step 4
  result: 'Result',
  netVsBar: 'Net vs bar',
  vpSplit: 'VP split',
  risk: 'Risk',
  odds: 'Odds',
  optimizer: 'Optimizer',
  barParts: 'Bar = target + growth',
  notAbsorbed: 'not absorbed',
  riskAdjusted: 'Risk-adjusted net',
  gapRisk: 'Gap, risk-adjusted',
  eps: 'EPS',
  pClear: 'P(clear)',
  everyVp: 'Every VP clears',
  barCleared: 'Bar cleared',
  barShort: 'Bar not cleared',
  usePath: 'Use this path',
  applying: 'Applying…',
  discard: 'Discard',
  applied: 'Path applied',
  findPath: 'Find a path',
  objective: 'Objective',
  moves: 'Moves',
  riskExposure: 'Risk exposure',
  oneTime: 'One-time',
  net: 'Net',
  failed: 'The run failed.',
  runTrials: (trials: string | null) => (trials === null ? 'Run trials' : `Run ${trials} trials`),
} as const;

/** Policy variables of step 3, ids verbatim. */
export const POLICY = {
  targetNet: 'g.target_net',
  targetPct: 'g.target_pct',
  targetMode: 'g.target_mode',
  absorb: 'g.absorb_growth',
  otOutShare: 'g.ot_out_share',
  headStart: 'g.head_start',
  start: 'lev.start',
  ramp: 'lev.ramp',
  leverOn: 'lev.on',
  domShare: 'org.dom_share',
} as const;

/** `g.target_mode` value for "target as a percentage" (registry enum). */
export const TARGET_MODE_PCT = 2;

/** Output nodes read by steps 3 and 4. */
export const NODES = {
  target: 'res.target',
  headwinds: 'base.headwinds',
  bar: 'res.bar',
  net: 'res.net',
  gap: 'res.gap',
  coverage: 'res.coverage',
  risk: 'res.risk',
  gapRisk: 'res.gap_risk',
  eps: 'br.eps27',
  otIt: 'res.tot_ot_it',
  otOut: 'res.tot_ot_out',
} as const;

export const VP = {
  dim: 'vp',
  net: 'vp.net',
  bar: 'vp.bar',
  gap: 'vp.gap',
  outlay: 'vp.outlay',
} as const;

/** Dimensions of the member lists the steps read. */
export const DIM = { lever: 'lever', vp: 'vp', domain: 'domain' } as const;
