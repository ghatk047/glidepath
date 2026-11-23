/**
 * Public types of the solvers: `SolverResult`, `Change` and the parameters of every problem of
 * `docs/spec/solvers.json`, as in docs/architecture/03_engine_and_solvers.md §3.
 *
 * Shapes mirror `contract/api-contract` `solvers.ts` (CON-03) field for field, so tier 2's server maps a
 * result onto the wire without reshaping, with two deliberate differences: the solvers may not import the
 * contract (02 §1: solvers → engine, spec), so ids are plain strings; and cells are the engine's
 * `CellKey` (`res.net`, `lev.start[L03]`), not the contract's bracketed form (`res.net[]`). The server
 * converts between the two.
 */
import type { CellKey, Change as EngineChange } from '@glidepath/engine';
import type { ProblemId } from '@glidepath/spec/generated';

export type { CellKey, ProblemId };

/** `solvers.json` `decision_variable_sets` keys: which inputs an optimiser may move. */
export type DecisionSetId = 'lever_intensity' | 'lever_timing' | 'lever_switch' | 'funding';

/** 03 §3 `SolverResult.status`. */
export type SolverStatus = 'optimal' | 'feasible' | 'infeasible' | 'unreachable' | 'cancelled';

/**
 * One move of a result: set an input cell. 03 §3 `Change`, the engine's variable `Change` (a solver never
 * pins a node), so it feeds `rerun` directly and becomes a changeset on a new scenario.
 */
export type Change = Extract<EngineChange, { readonly target: 'variable' }>;

/** A move with its effect on the problem's output, for the ranked move list (03 §3 `ranked`). */
export interface RankedMove {
  readonly cell: CellKey;
  readonly from: number;
  readonly to: number;
  /** Change of the ranked output caused by the move (see `rankMoves`). */
  readonly impact: number;
}

export interface BindingConstraint {
  /** A constraint id of `min_risk_mix.constraints`, with the member for per-VP rows, e.g. `per_vp[v1]`. */
  readonly constraint: string;
  readonly shadowPrice: number;
}

export interface SolverDiagnostics {
  /** Iterations (batches or steps) the solver ran. */
  readonly iterations: number;
  /** Wall time of the run. */
  readonly ms: number;
  /** Seed of a seeded run (Monte Carlo, multi-start). */
  readonly seed?: number;
}

// ---------------------------------------------------------------------------------------------------
// Parameters per problem (solvers.json `inputs` / `do`). Optional fields are tier 2's to default.
// ---------------------------------------------------------------------------------------------------

/** `[lo, hi]` with `lo <= hi`. */
export type Bounds = readonly [number, number];

/** `min_risk_mix.objective_options` keys. */
export type SolverObjective =
  | 'min_risk_exposure'
  | 'max_risk_adjusted_net'
  | 'min_one_time'
  | 'min_people_impact'
  | 'min_change';

/** `min_risk_mix.methods`: `explainable` (default in UI) or `production`. */
export type OptimiserMethod = 'explainable' | 'production';

/** `sensitivity.methods` keys. */
export type SensitivityMethod = 'tornado' | 'elasticity' | 'sobol' | 'spider';

/** `min_risk_mix.constraints` (the "(optional)" suffix dropped); `total` and `bounds` always apply. */
export type SolverConstraint =
  | { readonly id: 'total' }
  | { readonly id: 'per_vp'; readonly vps?: readonly string[] }
  | { readonly id: 'one_time_cap'; readonly value: number }
  | { readonly id: 'rate_share'; readonly value: number }
  | { readonly id: 'us_floor'; readonly value: number }
  | { readonly id: 'gcc_hiring'; readonly value: number }
  | { readonly id: 'eps'; readonly value: number };

/** `goal_seek`: solve one input cell so that `output` hits `target`. */
export interface GoalSeekParams {
  readonly var: CellKey;
  readonly output: CellKey;
  readonly target: number;
  /** Search range; absent = the variable's registry min/max. */
  readonly bounds?: Bounds;
}

/** `breakeven`: goal seek each lever-intensity input alone until `output` = `target`. */
export interface BreakevenParams {
  readonly output?: CellKey;
  readonly target?: number;
  /** Inputs to try; absent = the `lever_intensity` decision set. */
  readonly inputs?: readonly CellKey[];
}

/** `scenario_blend`: `x = from + λ (to − from)`; solve λ for `output` = `target`. */
export interface ScenarioBlendParams {
  readonly from: string;
  readonly to: string;
  readonly output?: CellKey;
  readonly target?: number;
}

/** Shared by `min_risk_mix`, `pareto` and `vp_feasible`. */
export interface OptimiserParams {
  readonly objective?: SolverObjective;
  readonly decisionSets?: readonly DecisionSetId[];
  readonly constraints?: readonly SolverConstraint[];
  readonly method?: OptimiserMethod;
  /** Multi-start seed; absent = a seeded default (reproducible). */
  readonly seed?: number;
}

export type MinRiskMixParams = OptimiserParams;
export type VpFeasibleParams = OptimiserParams;

/** `pareto`: ε-constraint sweep of `min_risk_mix` over bar levels `from..to` step `step`. */
export interface ParetoParams extends OptimiserParams {
  readonly axis?: 'risk' | 'one_time';
  readonly sweep?: { readonly from: number; readonly to: number; readonly step: number };
}

/** Where a distribution's draw lands: the value itself, a multiplier of the start value, or an offset to it. */
export type DistBasis = 'absolute' | 'relative' | 'shift';

/**
 * A Monte Carlo input distribution (04 §4: "Triangular, PERT, Normal, Lognormal or discrete on any input";
 * `variable_def.dist`). `basis` (default `absolute`) says how a draw `d` becomes the input: `d`,
 * `start × d` or `start + d`. `confidence_beta` is the spec's default realisation:
 * `scale × Beta(K·c/scale, K·(1 − c/scale))` with `c` the same member's cell of the `confidence` variable.
 */
export type MonteCarloDist =
  | { readonly type: 'triangular'; readonly min: number; readonly mode: number; readonly max: number; readonly basis?: DistBasis }
  | {
      readonly type: 'pert';
      readonly min: number;
      readonly mode: number;
      readonly max: number;
      /** Shape weight of the mode; absent = the classic PERT 4. */
      readonly lambda?: number;
      readonly basis?: DistBasis;
    }
  | { readonly type: 'normal'; readonly mean: number; readonly sd: number; readonly basis?: DistBasis }
  /** `exp(mu + sigma·Z)`. */
  | { readonly type: 'lognormal'; readonly mu: number; readonly sigma: number; readonly basis?: DistBasis }
  | { readonly type: 'uniform'; readonly min: number; readonly max: number; readonly basis?: DistBasis }
  | {
      readonly type: 'discrete';
      readonly values: readonly number[];
      /** Relative weights, one per value; absent = equally likely. */
      readonly weights?: readonly number[];
      readonly basis?: DistBasis;
    }
  | { readonly type: 'confidence_beta'; readonly concentration: number; readonly scale: number; readonly confidence: string };

/** `monte_carlo`: seeded batch run. */
export interface MonteCarloParams {
  readonly iterations?: number;
  readonly seed?: number;
  readonly outputs?: readonly CellKey[];
  /** Editable correlation groups (Gaussian copula) over `lever` members. */
  readonly correlation?: readonly { readonly levers: readonly string[]; readonly rho: number }[];
  /**
   * Distribution overrides by variable id (every cell of it) or cell key; `null` holds that input at its
   * start value. Precedence: cell, then variable, then `variable_def.dist`, then the 04 §4 defaults.
   */
  readonly dist?: Readonly<Record<string, MonteCarloDist | null>>;
  /** Histogram bins per output. */
  readonly bins?: number;
  /** Lanes per engine batch (a cancel lands between batches). */
  readonly batchSize?: number;
}

/** `sensitivity`. */
export interface SensitivityParams {
  readonly method: SensitivityMethod;
  readonly outputs: readonly CellKey[];
  readonly inputs?: readonly CellKey[];
  readonly range?: { readonly mode: 'registry' } | { readonly mode: 'relative'; readonly fraction: number };
  /** Sobol sample size N. */
  readonly samples?: number;
}

/** `stress_presets`: named shocks of `solvers.json`, by name. */
export interface StressPresetsParams {
  readonly presets: readonly string[];
}

/** Parameters of each problem id. */
export interface SolverParamsMap {
  readonly goal_seek: GoalSeekParams;
  readonly breakeven: BreakevenParams;
  readonly scenario_blend: ScenarioBlendParams;
  readonly min_risk_mix: MinRiskMixParams;
  readonly pareto: ParetoParams;
  readonly vp_feasible: VpFeasibleParams;
  readonly monte_carlo: MonteCarloParams;
  readonly sensitivity: SensitivityParams;
  readonly stress_presets: StressPresetsParams;
}

/** One problem and its parameters (`solver_run.spec`). */
export type SolverSpec = { [P in ProblemId]: { readonly problem: P; readonly params: SolverParamsMap[P] } }[ProblemId];

// ---------------------------------------------------------------------------------------------------
// Detail per problem: display series beyond the flat `metrics` (contract `SolverDetail`).
// ---------------------------------------------------------------------------------------------------

export interface SolverDetailMap {
  readonly goal_seek: {
    /** The solution, or the closest value within range when `unreachable`. */
    readonly value: number;
    readonly output: number;
    readonly reachable: boolean;
  };
  readonly breakeven: {
    readonly rows: readonly {
      readonly cell: CellKey;
      readonly current: number;
      readonly needed: number | null;
      readonly min: number | null;
      readonly max: number | null;
      readonly feasible: boolean;
    }[];
  };
  readonly scenario_blend: { readonly lambda: number | null };
  readonly min_risk_mix: Record<string, never>;
  readonly pareto: {
    readonly points: readonly {
      readonly bar: number;
      readonly net: number;
      readonly risk: number;
      readonly oneTime: number;
      readonly feasible: boolean;
      /** The moves at this point (the server saves them as a scenario when asked). */
      readonly changes: readonly Change[];
    }[];
  };
  readonly vp_feasible: { readonly coverage: readonly { readonly vp: string; readonly coverage: number }[] };
  readonly monte_carlo: {
    readonly iterations: number;
    readonly seed: number;
    readonly percentiles: readonly { readonly cell: CellKey; readonly p10: number; readonly p50: number; readonly p90: number }[];
    readonly probabilities: readonly { readonly cell: CellKey; readonly against: CellKey; readonly p: number }[];
    readonly histograms: readonly {
      readonly cell: CellKey;
      readonly bins: readonly { readonly lo: number; readonly hi: number; readonly count: number }[];
    }[];
    /**
     * Variance contribution by lever: `rho` = Spearman rank correlation of the lever's realisation with
     * the net, `share` = rho² / Σ rho² (shares sum to 1, or 0 when nothing correlates).
     */
    readonly contributions: readonly { readonly lever: string; readonly share: number; readonly rho: number }[];
  };
  readonly sensitivity: {
    readonly method: SensitivityMethod;
    readonly output: CellKey;
    readonly rows: readonly {
      readonly cell: CellKey;
      /** tornado / elasticity: colour class from the registry (SOL-07); not yet in the contract. */
      readonly category?: 'policy' | 'timing' | 'lever';
      /** tornado / elasticity: |high.output − low.output|, the sort key; not yet in the contract. */
      readonly swing?: number;
      readonly low: { readonly input: number; readonly output: number } | null;
      readonly high: { readonly input: number; readonly output: number } | null;
      readonly elasticity: number | null;
      readonly first: number | null;
      readonly total: number | null;
    }[];
  };
  readonly stress_presets: {
    readonly presets: readonly {
      readonly name: string;
      readonly outputs: Readonly<Record<CellKey, number>>;
      readonly delta: Readonly<Record<CellKey, number>>;
    }[];
  };
}

/** 03 §3 `SolverResult`, typed by problem. */
export interface SolverResult<P extends ProblemId = ProblemId> {
  readonly problem: P;
  readonly status: SolverStatus;
  /** The moves (decision inputs only for optimisers), to become a changeset on a new scenario. */
  readonly changes: readonly Change[];
  readonly ranked: readonly RankedMove[];
  readonly binding?: readonly BindingConstraint[];
  /** Headline numbers: net, risk, one-time, P(clear) … keyed by node id or a metric name. */
  readonly metrics: Readonly<Record<string, number>>;
  readonly diagnostics: SolverDiagnostics;
  readonly detail?: SolverDetailMap[P];
}

/** What a problem implementation returns; the framework adds `problem` and `diagnostics`. */
export interface SolverOutcome<P extends ProblemId = ProblemId> {
  readonly status: Exclude<SolverStatus, 'cancelled'>;
  readonly changes: readonly Change[];
  readonly ranked?: readonly RankedMove[];
  readonly binding?: readonly BindingConstraint[];
  readonly metrics?: Readonly<Record<string, number>>;
  readonly detail?: SolverDetailMap[P];
  readonly seed?: number;
}
