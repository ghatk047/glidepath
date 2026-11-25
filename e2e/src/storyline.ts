import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readRepoJson, repoRoot } from '@glidepath/int';

/**
 * The numbers the demo storyline quotes (`docs/ux/05_demo_storyline.md`, "Numbers used"), read from
 * the spec bundle so none is written in code (QA-05, G10):
 *
 * - the bar, the cost growth behind it and the locked share: prose of `docs/spec/README.md`
 *   ("Headline numbers"); the table itself is read by `spec-headline.ts` (Rates only, C, D);
 * - the minimum-risk path and the Monte Carlo odds: `docs/spec/reference/solver_demo_results.json`
 *   (the Python oracle's demo results the solver gate G5 checks against);
 * - the fuel equivalent: `golden_results.json` (`br.fuel_equiv_cents`).
 */

const SPEC_README = ['docs', 'spec', 'README.md'];

/**
 * The run of show names the "people levers" (L03 to L05, 05_demo_storyline "Ready for questions":
 * "start month for the people levers (L03–L05)"): relocation, insourcing and the GCC substitution.
 */
export const PEOPLE_LEVERS = ['L03', 'L04', 'L05'] as const;

/**
 * Tolerance of the Monte Carlo odds in percentage points: the solver gate G5 accepts the seeded
 * 2,000 draws within ±1.5 pp of the oracle's P(clear bar) (`monte-carlo.spec.ts`, SOL backlog item).
 * The oracle's 4.5% is a draw of its own random stream, so the storyline's "4.5%" can only be asserted
 * to the precision the gate itself defines.
 */
export const MONTE_CARLO_TOLERANCE_PP = 1.5;

export interface Quoted {
  /** The number as the spec writes it, in the unit it quotes (`143.0` for $143.0M, `20.8` for 20.8%). */
  readonly value: number;
  /** The text around it, as read. */
  readonly text: string;
}

function pick(text: string, re: RegExp, what: string): Quoted {
  const m = re.exec(text);
  if (!m?.[1]) throw new Error(`${SPEC_README.join('/')} no longer says "${what}" (${String(re)})`);
  return { value: Number(m[1].replace(/,/g, '')), text: m[0] };
}

export interface SpecProse {
  /** "Base $1,007.6M" (CY26 normalised outlay, $M). */
  readonly base: Quoted;
  /** "Cost growth to absorb is $43.0M". */
  readonly growth: Quoted;
  /** "the gross bar is **$143.0M**". */
  readonly bar: Quoted;
  /** "20.8% locked" (percent). */
  readonly lockedPct: Quoted;
}

/** The numbers in the sentences under "Headline numbers" of the spec README. */
export function specProse(): SpecProse {
  const text = readFileSync(join(repoRoot, ...SPEC_README), 'utf8');
  return {
    base: pick(text, /Base \$([\d,]+(?:\.\d+)?)M/, 'Base $…M'),
    growth: pick(text, /Cost growth to absorb is \$([\d,]+(?:\.\d+)?)M/, 'Cost growth to absorb is $…M'),
    bar: pick(text, /gross bar is \*\*\$([\d,]+(?:\.\d+)?)M\*\*/, 'the gross bar is **$…M**'),
    lockedPct: pick(text, /(\d+(?:\.\d+)?)% locked/, '…% locked'),
  };
}

interface DemoRun {
  readonly net: number;
  readonly bar: number;
  readonly risk_exposure: number;
  readonly one_time_it: number;
  readonly fte_us: number;
  readonly inputs_moved_from_C: Readonly<Record<string, { from: number; to: number }>>;
}
interface DemoMonteCarlo {
  readonly iterations: number;
  readonly prob_clear_bar: number;
}
interface SolverDemo {
  readonly min_risk_total_bar: DemoRun;
  readonly monte_carlo_C: DemoMonteCarlo;
  readonly monte_carlo_D: DemoMonteCarlo;
}

/** `docs/spec/reference/solver_demo_results.json`, the part the storyline quotes. */
export function solverDemo(): SolverDemo {
  return readRepoJson<SolverDemo>('docs', 'spec', 'reference', 'solver_demo_results.json');
}

/** Variable ids the oracle's minimum-risk path moves (spec ids, verbatim, e.g. `lev.L17.cola`). */
export const movedByMinRisk = (demo: SolverDemo = solverDemo()): string[] =>
  Object.keys(demo.min_risk_total_bar.inputs_moved_from_C);
