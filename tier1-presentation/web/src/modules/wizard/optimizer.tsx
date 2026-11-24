import { createContext, useContext, type ReactNode } from 'react';
import type { RankedMove, SolverObjective, SolverResult, SolverRun } from '@glidepath/api-contract';

export interface WizardOptimizer {
  objective: SolverObjective;
  setObjective(objective: SolverObjective): void;
  perVp: boolean;
  setPerVp(on: boolean): void;
  /** A run is starting or running. */
  busy: boolean;
  /** Active job id (for JobHeader); null before the first job message and after the end. */
  jobId: string | null;
  /** The run on the current scenario as tier 2 last reported it. */
  run: SolverRun | null;
  /** Result of the last finished run; kept across `apply()`'s scenario switch. */
  result: SolverResult | null;
  /** `result.ranked`, tier 2's order; kept across `apply()`. */
  moves: readonly RankedMove[];
  /** Variable ids (cell key without `[member]`) of `moves`, for accent dots. */
  moved: ReadonlySet<string>;
  error: string | null;
  find(): void;
  applying: boolean;
  apply(): void;
  discard(): void;
}

const INERT: WizardOptimizer = {
  objective: 'min_risk_exposure',
  setObjective: () => undefined,
  perVp: false,
  setPerVp: () => undefined,
  busy: false,
  jobId: null,
  run: null,
  result: null,
  moves: [],
  moved: new Set(),
  error: null,
  find: () => undefined,
  applying: false,
  apply: () => undefined,
  discard: () => undefined,
};

const OptimizerContext = createContext<WizardOptimizer>(INERT);

/** Stub (WIZ-02). WIZ-06 replaces the body with the real provider; the signature stays. */
export function OptimizerProvider({ children }: { children: ReactNode }) {
  return <OptimizerContext value={INERT}>{children}</OptimizerContext>;
}

export const useWizardOptimizer = (): WizardOptimizer => useContext(OptimizerContext);
