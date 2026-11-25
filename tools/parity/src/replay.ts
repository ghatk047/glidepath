/**
 * Parity replay (PORTING.md §6): each of the 245 checks of parity_report.json names an engine value
 * of one run; the replay table R01-R22 says which run and which cells. The TS value, after Python
 * round(x, 6), must equal the check's `engine` value within 1e-6 absolute.
 */
import type { Evaluation } from '@glidepath/engine';
import { pyRound, REFERENCE_DECIMALS, replayClose } from './round';
import { cbOffRun, parityRun, plainRun, type RunConfig, type Runner } from './runs';

/** Shape of `docs/spec/reference/parity_report.json`. */
export interface ParityReportFile {
  readonly checks: readonly { readonly check: string; readonly engine: number }[];
  readonly parity_overrides: Readonly<Record<string, number>>;
}

/** Placeholders of the replay table (PORTING.md §6). */
const SID = '(rates|A|B|C|D)';
const LEVER_COUNT = 17;
const LEVERS = Array.from({ length: LEVER_COUNT }, (_, i) => `L${String(i + 1).padStart(2, '0')}`);
const L = `(${LEVERS.join('|')})`;
const VP = '(vp_commercial|vp_operations|vp_corporate|vp_infra)';
const FEED = '(g27|o27|c27|ot27_it|e27|d27|ebit27|cash27|cash27_co|o28|c28|d28|ebit28|cash28)';
const CORP = '(rev|ebitda|ebitdar|ni|eps|fcf|net_debt)';
const Y = '(FY2025A|FY2026E|FY2027E_base)';
const BR27 = '(ebitda|ni|eps|fcf)';
const BR28 = '(ebitda|eps|px)';
/** R02: feed keys whose cell is not `pnl.<key>`. */
const FEED_CELLS: Readonly<Record<string, string>> = {
  g27: 'res.tot_iy',
  ot27_it: 'res.tot_ot_it',
};
/** R15: report year → year member. */
const YEARS: Readonly<Record<string, string>> = {
  FY2025A: 'fy25',
  FY2026E: 'fy26',
  FY2027E_base: 'fy27b',
};
const PARITY_PRESET = 'C';

type RunKind = 'PARITY' | 'CB_OFF' | 'PLAIN';

export interface ReplayRule {
  readonly id: string;
  readonly pattern: RegExp;
  readonly run: RunKind;
  /** Preset of the run: a capture group's value, or a fixed preset. */
  readonly preset: (m: RegExpMatchArray) => string;
  /** The engine value the check names. */
  readonly value: (ev: Evaluation, m: RegExpMatchArray) => number;
}

const captured = (m: RegExpMatchArray, i: number): string => m[i]!;
const sidOf = (m: RegExpMatchArray): string => captured(m, 1);
const presetC = (): string => PARITY_PRESET;
const cell =
  (f: (m: RegExpMatchArray) => string) =>
  (ev: Evaluation, m: RegExpMatchArray): number =>
    ev.get(f(m));
const rule = (
  id: string,
  source: string,
  run: RunKind,
  preset: ReplayRule['preset'],
  value: ReplayRule['value'],
): ReplayRule => ({ id, pattern: new RegExp(`^${source}$`), run, preset, value });

/** Python `max` over a sequence: the first value, replaced only by a strictly larger one. */
function pyMaxOf(xs: readonly number[]): number {
  let r = xs[0]!;
  for (const x of xs.slice(1)) if (x > r) r = x;
  return r;
}

/** The replay table R01-R22 of PORTING.md §6. */
export const REPLAY_RULES: readonly ReplayRule[] = [
  rule(
    'R01',
    `levers v0\\.3 ${SID} ${L} in-year`,
    'PARITY',
    sidOf,
    cell((m) => `lev.iy[${captured(m, 2)}]`),
  ),
  rule(
    'R02',
    `levers v0\\.3 ${SID} pnl_feed\\.${FEED}`,
    'PARITY',
    sidOf,
    cell((m) => FEED_CELLS[captured(m, 2)] ?? `pnl.${captured(m, 2)}`),
  ),
  rule(
    'R03',
    `levers v0\\.3 ${SID} risk-adjusted net`,
    'PARITY',
    sidOf,
    cell(() => 'res.risk'),
  ),
  rule(
    'R04',
    `levers v0\\.3 ${SID} bar`,
    'PARITY',
    sidOf,
    cell(() => 'res.bar'),
  ),
  rule(
    'R05',
    `levers v0\\.3 ${SID} end-state GCC FTE`,
    'PARITY',
    sidOf,
    cell(() => 'res.fte_gcc'),
  ),
  rule(
    'R06',
    `levers v0\\.3 VP ${VP} target`,
    'PARITY',
    presetC,
    cell((m) => `vp.target[${captured(m, 1)}]`),
  ),
  rule(
    'R07',
    `levers v0\\.3 VP ${VP} net C`,
    'PARITY',
    presetC,
    cell((m) => `vp.net[${captured(m, 1)}]`),
  ),
  rule(
    'R08',
    `levers v0\\.3 VP ${VP} gap C`,
    'PARITY',
    presetC,
    cell((m) => `vp.gap[${captured(m, 1)}]`),
  ),
  rule(
    'R09',
    `baseline VP ${VP} CY26 outlay`,
    'CB_OFF',
    presetC,
    cell((m) => `vp.outlay[${captured(m, 1)}]`),
  ),
  rule(
    'R10',
    `baseline VP ${VP} CY27 growth`,
    'CB_OFF',
    presetC,
    cell((m) => `vp.growth[${captured(m, 1)}]`),
  ),
  rule(
    'R11',
    `baseline VP ${VP} addressable`,
    'CB_OFF',
    presetC,
    cell((m) => `vp.addressable[${captured(m, 1)}]`),
  ),
  rule(
    'R12',
    `baseline VP ${VP} net target`,
    'CB_OFF',
    presetC,
    cell((m) => `vp.target[${captured(m, 1)}]`),
  ),
  rule(
    'R13',
    'baseline total outlay',
    'CB_OFF',
    presetC,
    cell(() => 'base.total'),
  ),
  rule(
    'R14',
    'baseline headwinds',
    'CB_OFF',
    presetC,
    cell(() => 'base.headwinds'),
  ),
  rule(
    'R15',
    `corporate v0\\.1 ${CORP} ${Y}`,
    'PARITY',
    presetC,
    cell((m) => `pl.${captured(m, 1)}[${YEARS[captured(m, 2)]!}]`),
  ),
  rule(
    'R16',
    'corporate v0\\.1 price FY2027 base',
    'PARITY',
    presetC,
    cell(() => 'val.px[fy27b]'),
  ),
  rule(
    'R17',
    `corporate v0\\.1 bridge ${BR27} FY2027 \\(C\\)`,
    'PARITY',
    presetC,
    cell((m) => `br.${captured(m, 1)}27`),
  ),
  rule(
    'R18',
    'corporate v0\\.1 bridge price FY2027 \\(C\\)',
    'PARITY',
    presetC,
    cell(() => 'br.px27'),
  ),
  rule(
    'R19',
    `corporate v0\\.1 bridge ${BR28} FY2028 run-rate \\(C\\)`,
    'PARITY',
    presetC,
    cell((m) => `br.${captured(m, 1)}28`),
  ),
  rule('R20', `invariant ${SID} pool effects sum to run-rate`, 'PLAIN', sidOf, (ev) =>
    pyMaxOf(LEVERS.map((l) => Math.abs(ev.get(`lev.rr_check[${l}]`)))),
  ),
  rule(
    'R21',
    `invariant ${SID} VP nets sum to total net`,
    'PLAIN',
    sidOf,
    cell(() => 'vp.check'),
  ),
  rule(
    'R22',
    `invariant ${SID} only IT lines differ in FY2027 revenue`,
    'PLAIN',
    sidOf,
    (ev) => ev.get('pl.rev[fy27it]') - ev.get('pl.rev[fy27b]'),
  ),
];

/** The rule a check name falls under, with its match; throws if none or more than one matches. */
export function ruleFor(check: string): { rule: ReplayRule; match: RegExpMatchArray } {
  const hits = REPLAY_RULES.flatMap((r) => {
    const match = check.match(r.pattern);
    return match ? [{ rule: r, match }] : [];
  });
  if (hits.length !== 1) {
    throw new Error(`replay: check '${check}' matches ${hits.length} rules (expected 1)`);
  }
  return hits[0]!;
}

export interface ReplayRow {
  readonly check: string;
  readonly rule: string;
  readonly run: string;
  readonly ts: number;
  readonly rounded: number;
  readonly engine: number;
  readonly diff: number;
  readonly pass: boolean;
}

export interface ReplayReport {
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly rows: readonly ReplayRow[];
}

function runConfig(kind: RunKind, preset: string, report: ParityReportFile): RunConfig {
  if (kind === 'PARITY') return parityRun(preset, report.parity_overrides);
  if (kind === 'CB_OFF') return cbOffRun();
  return plainRun(preset);
}

/** Replays every check of the report. */
export function runReplay(runner: Runner, report: ParityReportFile): ReplayReport {
  const rows: ReplayRow[] = report.checks.map(({ check, engine }) => {
    const { rule: r, match } = ruleFor(check);
    const config = runConfig(r.run, r.preset(match), report);
    const ts = r.value(runner.run(config), match);
    const rounded = pyRound(ts, REFERENCE_DECIMALS);
    return {
      check,
      rule: r.id,
      run: config.name,
      ts,
      rounded,
      engine,
      diff: rounded - engine,
      pass: replayClose(rounded, engine),
    };
  });
  const passed = rows.filter((r) => r.pass).length;
  return { total: rows.length, passed, failed: rows.length - passed, rows };
}
