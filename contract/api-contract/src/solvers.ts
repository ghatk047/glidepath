import { z } from 'zod';
import {
  CellKey,
  InputHash,
  JobId,
  MemberKey,
  OneLine,
  ScenarioId,
  TenantSlug,
  Timestamp,
  UserId,
  Version,
} from './ids';
import { Problem } from './problem';
import { Outputs, VariableChange } from './changeset';
import { JobProgressFraction, JobStatus } from './ws';

/**
 * Solver runs (CON-03): `POST /solver-runs` (worker job), `POST /solver-runs/quick` (≤ 2 s in
 * the `logic` process), `GET` / `DELETE /solver-runs/:id` (status and result / cancel).
 * Problem ids, objective, constraint, decision-set and method names are verbatim from
 * `docs/spec/solvers.json`; the result is `SolverResult` of 03 §3.
 *
 * Optional parameters are tier 2's to default (from the spec bundle and registry), never tier 1's:
 * tier 1 sends only what the user chose.
 */

/**
 * Problems the product adds beyond `solvers.json` (which is read-only): `wave_plan`, the SRC epic's
 * wave planner (F10). Listed after the spec's ids in `ProblemId`.
 */
export const extensionProblems = ['wave_plan'] as const;

/** `solvers.json` `problems[].id`, in spec order, then `extensionProblems`. */
export const ProblemId = z.enum([
  'goal_seek',
  'breakeven',
  'scenario_blend',
  'min_risk_mix',
  'pareto',
  'vp_feasible',
  'monte_carlo',
  'sensitivity',
  'stress_presets',
  ...extensionProblems,
]);
export type ProblemId = z.infer<typeof ProblemId>;

/** `solvers.json` `decision_variable_sets` keys: which inputs an optimiser may move. */
export const DecisionSet = z.enum(['lever_intensity', 'lever_timing', 'lever_switch', 'funding']);
export type DecisionSet = z.infer<typeof DecisionSet>;

/** `min_risk_mix.objective_options` keys. */
export const SolverObjective = z.enum([
  'min_risk_exposure',
  'max_risk_adjusted_net',
  'min_one_time',
  'min_people_impact',
  'min_change',
]);
export type SolverObjective = z.infer<typeof SolverObjective>;

/** `min_risk_mix.constraints` keys (the "(optional)" suffix dropped). */
export const SolverConstraintId = z.enum([
  'total',
  'per_vp',
  'one_time_cap',
  'rate_share',
  'us_floor',
  'gcc_hiring',
  'eps',
  'bounds',
]);
export type SolverConstraintId = z.infer<typeof SolverConstraintId>;

/** `min_risk_mix.methods`: `explainable` (default in UI) or `production`. */
export const OptimiserMethod = z.enum(['explainable', 'production']);
export type OptimiserMethod = z.infer<typeof OptimiserMethod>;

/** `sensitivity.methods` keys. */
export const SensitivityMethod = z.enum(['tornado', 'elasticity', 'sobol', 'spider']);
export type SensitivityMethod = z.infer<typeof SensitivityMethod>;

/**
 * Colour class of a tornado / elasticity row, classified by tier 2 from the registry: `policy` (the target
 * and its funding rules), `timing` (start, ramp, phasing), `lever` (everything else). Tier 1 only maps the
 * word to a colour; it never classifies an input itself.
 */
export const TornadoCategory = z.enum(['lever', 'policy', 'timing']);
export type TornadoCategory = z.infer<typeof TornadoCategory>;

const Bounds = z
  .tuple([z.number(), z.number()])
  .refine(([lo, hi]) => lo <= hi, { message: 'bounds must be [lo, hi] with lo ≤ hi' });

/**
 * One constraint of an optimiser run. `total` is always applied (`res.net ≥ res.bar`, or
 * `≥ res.target` when `g.absorb_growth = 0`); `bounds` always come from the decision sets.
 * `per_vp` may name the VPs (members of `vp`); absent = every VP. The others carry their cap
 * or floor in the unit of the constrained node.
 */
export const SolverConstraint = z.discriminatedUnion('id', [
  z.object({ id: z.literal('total') }),
  z.object({ id: z.literal('per_vp'), vps: z.array(MemberKey).min(1).optional() }),
  z.object({ id: z.literal('one_time_cap'), value: z.number() }),
  z.object({ id: z.literal('rate_share'), value: z.number() }),
  z.object({ id: z.literal('us_floor'), value: z.number() }),
  z.object({ id: z.literal('gcc_hiring'), value: z.number() }),
  z.object({ id: z.literal('eps'), value: z.number() }),
]);
export type SolverConstraint = z.infer<typeof SolverConstraint>;

// ---------------------------------------------------------------------------
// Parameters per problem (solvers.json `inputs` / `do`)
// ---------------------------------------------------------------------------

/** Solve one input cell (`var_key[member]`) so that `output` hits `target`. */
export const GoalSeekParams = z.object({
  var: CellKey,
  output: CellKey,
  target: z.number(),
  /** Search range; absent = the variable's registry min/max. */
  bounds: Bounds.optional(),
});
/** Goal seek each lever-intensity input alone until `output` = `target` (`res.gap[]` = 0). */
export const BreakevenParams = z.object({
  output: CellKey.optional(),
  target: z.number().optional(),
  /** Inputs to try; absent = every lever-intensity input. */
  inputs: z.array(CellKey).min(1).optional(),
});
/** `x = from + λ (to − from)` over the scenario-varying inputs; solve λ for `output` = `target`. */
export const ScenarioBlendParams = z.object({
  from: ScenarioId,
  to: ScenarioId,
  output: CellKey.optional(),
  target: z.number().optional(),
});
const optimiserShape = {
  objective: SolverObjective.optional(),
  decisionSets: z.array(DecisionSet).min(1).optional(),
  constraints: z.array(SolverConstraint).optional(),
  method: OptimiserMethod.optional(),
  /** Multi-start seed; absent = tier 2's seeded default (reproducible). */
  seed: z.number().int().nonnegative().optional(),
};
export const MinRiskMixParams = z.object(optimiserShape);
/** ε-constraint sweep of `min_risk_mix` over bar levels `from..to` step `step`. */
export const ParetoParams = z.object({
  ...optimiserShape,
  /** Second axis of the frontier: risk (default) or one-time cost. */
  axis: z.enum(['risk', 'one_time']).optional(),
  sweep: z
    .object({ from: z.number(), to: z.number(), step: z.number().positive() })
    .refine((s) => s.from <= s.to, { message: 'sweep.from must be ≤ sweep.to' })
    .optional(),
});
/** `min_risk_mix` with every VP bar as a constraint; if infeasible, maximise min coverage. */
export const VpFeasibleParams = z.object(optimiserShape);
/** Seeded batch run; absent fields take the solvers.json defaults held by tier 2. */
export const MonteCarloParams = z.object({
  iterations: z.number().int().positive().optional(),
  seed: z.number().int().nonnegative().optional(),
  /** Cells to report P10/P50/P90 for; absent = the solvers.json default outputs. */
  outputs: z.array(CellKey).min(1).optional(),
  /** Editable correlation groups (Gaussian copula) over lever members. */
  correlation: z
    .array(z.object({ levers: z.array(MemberKey).min(2), rho: z.number().min(-1).max(1) }))
    .optional(),
});
export const SensitivityParams = z.object({
  method: SensitivityMethod,
  outputs: z.array(CellKey).min(1),
  /** Inputs to vary; absent = tier 2's choice (all scenario inputs; Sobol: top of tornado). */
  inputs: z.array(CellKey).min(1).optional(),
  /** Swing: registry min/max (default) or ± a fraction of the current value. */
  range: z
    .discriminatedUnion('mode', [
      z.object({ mode: z.literal('registry') }),
      z.object({ mode: z.literal('relative'), fraction: z.number().positive() }),
    ])
    .optional(),
  /** Sobol sample size N. */
  samples: z.number().int().positive().optional(),
});
/** `wave_plan.objective`: CY27 net (`res.net[]`), or net less the risk exposure of the plan. */
export const WavePlanObjective = z.enum(['net', 'risk_adjusted']);
export type WavePlanObjective = z.infer<typeof WavePlanObjective>;

/** A month of 2027, as `lev.start` holds it (1 = Jan). */
const StartMonth = z.number().int().min(1).max(12);

/**
 * Wave planner (SRC-14): choose each lever's start month (`lev.start[lever]`, decision set
 * `lever_timing`) to maximise `objective` under a quarterly one-time budget and a launch capacity.
 * Absent fields take tier 2's defaults (the `sourcing_param` members and the registry bounds).
 */
export const WavePlanParams = z.object({
  /** Start-month window every lever must start in; absent = the registry bounds of `lev.start`. */
  window: z
    .object({ from: StartMonth, to: StartMonth })
    .refine((w) => w.from <= w.to, { message: 'window.from must be ≤ window.to' })
    .optional(),
  /** Cap on one-time cost incurred per quarter of 2027, $M. */
  quarterlyOneTimeCap: z.number().nonnegative().optional(),
  /** Most levers that may start in one quarter. */
  maxLaunchesPerQuarter: z.number().int().positive().optional(),
  objective: WavePlanObjective.optional(),
  /** Levers (`lever` members) the planner may move; absent = every active lever. */
  levers: z.array(MemberKey).min(1).optional(),
});

/** Bounds of a stress shock's scale (a schema limit: 0 = no shock, 3 = three times the written shock). */
export const STRESS_SCALE_MIN = 0;
export const STRESS_SCALE_MAX = 3;

/**
 * Named corporate-driver shocks, by name; tier 2 holds their definitions (and lists them in the result's
 * `detail.catalog`). `presets` absent or empty = every shock. `scales`: the size of a shock by name, a
 * multiplier on its moves from the start point (absent = 1, the shock as written).
 */
export const StressPresetsParams = z.object({
  presets: z.array(z.string().trim().min(1)).optional(),
  scales: z.record(z.string().trim().min(1), z.number().min(STRESS_SCALE_MIN).max(STRESS_SCALE_MAX)).optional(),
});

const spec = <P extends string, S extends z.ZodType>(problem: P, params: S) =>
  z.object({ problem: z.literal(problem), params });

/** `solver_run.spec`: one problem of solvers.json and its parameters. */
export const SolverSpec = z.discriminatedUnion('problem', [
  spec('goal_seek', GoalSeekParams),
  spec('breakeven', BreakevenParams),
  spec('scenario_blend', ScenarioBlendParams),
  spec('min_risk_mix', MinRiskMixParams),
  spec('pareto', ParetoParams),
  spec('vp_feasible', VpFeasibleParams),
  spec('monte_carlo', MonteCarloParams),
  spec('sensitivity', SensitivityParams),
  spec('stress_presets', StressPresetsParams),
  spec('wave_plan', WavePlanParams),
]);
export type SolverSpec = z.infer<typeof SolverSpec>;

/**
 * Problems that may run synchronously in the session (03 §3 "Runs: logic", ≤ 2 s).
 * `sensitivity` only as tornado, elasticity or spider; Sobol is a worker job.
 */
export const quickProblems = [
  'goal_seek',
  'breakeven',
  'scenario_blend',
  'sensitivity',
  'stress_presets',
] as const satisfies readonly ProblemId[];

export const QuickSolverSpec = z.discriminatedUnion('problem', [
  spec('goal_seek', GoalSeekParams),
  spec('breakeven', BreakevenParams),
  spec('scenario_blend', ScenarioBlendParams),
  spec('sensitivity', SensitivityParams.extend({ method: SensitivityMethod.exclude(['sobol']) })),
  spec('stress_presets', StressPresetsParams),
]);
export type QuickSolverSpec = z.infer<typeof QuickSolverSpec>;

const requestShape = {
  /** Start point: the solver runs on this scenario's committed state. */
  scenarioId: ScenarioId,
  /**
   * true: tier 2 saves the result as a new scenario (`kind = solver`, through
   * `applyChangeset`, origin `solver`) and reports `resultScenarioId`. Absent = false: tier 2
   * hands the flag to the worker job as well, so a job without it never adds a scenario. A
   * `save: true` request is never answered from the result cache (the save is a side effect
   * the cached run did not have).
   */
  save: z.boolean().optional(),
};

/** `POST /api/t/:tenant/solver-runs`: start a worker job (any problem). */
export const SolverRunRequest = z.object({ ...requestShape, spec: SolverSpec });
export type SolverRunRequest = z.infer<typeof SolverRunRequest>;

/** `POST /api/t/:tenant/solver-runs/quick`: run in the session, answer when done. */
export const QuickSolverRunRequest = z.object({ ...requestShape, spec: QuickSolverSpec });
export type QuickSolverRunRequest = z.infer<typeof QuickSolverRunRequest>;

export const SolverRunParams = z.object({ tenant: TenantSlug, id: JobId });

// ---------------------------------------------------------------------------
// SolverResult (03 §3)
// ---------------------------------------------------------------------------

export const SolverOutcome = z.enum([
  'optimal',
  'feasible',
  'infeasible',
  'unreachable',
  'cancelled',
]);
export type SolverOutcome = z.infer<typeof SolverOutcome>;

/** One move, ranked by `impact` on the problem's output (tier 2 sorts). */
export const RankedMove = z.object({
  cell: CellKey,
  from: z.number(),
  to: z.number(),
  impact: z.number(),
});
export type RankedMove = z.infer<typeof RankedMove>;

export const BindingConstraint = z.object({
  /** A `SolverConstraintId`, with the member for per-VP rows, e.g. `per_vp[vp_x]`. */
  constraint: z.string().min(1),
  shadowPrice: z.number(),
});
export type BindingConstraint = z.infer<typeof BindingConstraint>;

export const SolverDiagnostics = z.object({
  iterations: z.number().int().nonnegative(),
  ms: z.number().nonnegative(),
  seed: z.number().int().nonnegative().optional(),
});

const Percentiles = z.object({ cell: CellKey, p10: z.number(), p50: z.number(), p90: z.number() });
const Histogram = z.object({
  cell: CellKey,
  bins: z.array(
    z.object({ lo: z.number(), hi: z.number(), count: z.number().int().nonnegative() }),
  ),
});

/**
 * Display series a problem returns beyond 03 §3's flat `metrics` (CON-03 addition, optional),
 * so tier 1 draws curves, histograms and tables without arithmetic. `problem` repeats the
 * result's problem.
 */
export const SolverDetail = z.discriminatedUnion('problem', [
  z.object({
    problem: z.literal('goal_seek'),
    /** The solution, or the closest value within range when `unreachable`. */
    value: z.number(),
    output: z.number(),
    reachable: z.boolean(),
  }),
  z.object({
    problem: z.literal('breakeven'),
    rows: z.array(
      z.object({
        cell: CellKey,
        current: z.number(),
        /** Value needed to close the gap alone; `null` when no value in any range does. */
        needed: z.number().nullable(),
        min: z.number().nullable(),
        max: z.number().nullable(),
        feasible: z.boolean(),
        /**
         * A row that is not feasible: the value in its range (the registry range when it has none) whose output
         * comes closest to the target, and that output (`res.gap[]` by default); null on a feasible row. Absent
         * on runs stored before SRC-18.
         */
        best: z.number().nullable().optional(),
        bestOutput: z.number().nullable().optional(),
      }),
    ),
  }),
  z.object({ problem: z.literal('scenario_blend'), lambda: z.number().nullable() }),
  z.object({ problem: z.literal('min_risk_mix') }),
  z.object({
    problem: z.literal('pareto'),
    points: z.array(
      z.object({
        bar: z.number(),
        net: z.number(),
        risk: z.number(),
        oneTime: z.number(),
        feasible: z.boolean(),
        /** The scenario saved at this point, when the run saves. */
        scenarioId: ScenarioId.nullable(),
      }),
    ),
  }),
  z.object({
    problem: z.literal('vp_feasible'),
    /** Coverage per VP (`vp.coverage[v]`), e.g. when no plan clears every bar. */
    coverage: z.array(z.object({ vp: MemberKey, coverage: z.number() })),
  }),
  z.object({
    problem: z.literal('monte_carlo'),
    iterations: z.number().int().positive(),
    seed: z.number().int().nonnegative(),
    percentiles: z.array(Percentiles),
    /** P(`cell` ≥ `against`), e.g. `res.net[]` vs `res.bar[]`, per VP `vp.net[v]` vs `vp.bar[v]`. */
    probabilities: z.array(
      z.object({ cell: CellKey, against: CellKey, p: z.number().min(0).max(1) }),
    ),
    histograms: z.array(Histogram),
    /** Variance contribution by lever (`lever` member), shares summing to ≤ 1. */
    contributions: z.array(z.object({ lever: MemberKey, share: z.number() })),
  }),
  z.object({
    problem: z.literal('sensitivity'),
    method: SensitivityMethod,
    output: CellKey,
    rows: z.array(
      z.object({
        cell: CellKey,
        /** tornado / elasticity: tier 2's colour class for the input (SOL-13). Absent on a Sobol row. */
        category: TornadoCategory.optional(),
        /**
         * tornado / elasticity: the bar length, |high.output − low.output| (or the one side's distance from
         * the base output), non-negative and already the sort key of `rows` (SOL-13). Tier 1 draws it as is.
         */
        swing: z.number().nonnegative().optional(),
        /** tornado / spider: output at the low and high input. */
        low: z.object({ input: z.number(), output: z.number() }).nullable(),
        high: z.object({ input: z.number(), output: z.number() }).nullable(),
        /** elasticity: d output / d input × input / output. */
        elasticity: z.number().nullable(),
        /** sobol: first-order and total indices. */
        first: z.number().nullable(),
        total: z.number().nullable(),
      }),
    ),
  }),
  z.object({
    problem: z.literal('stress_presets'),
    presets: z.array(
      z.object({
        name: z.string().min(1),
        /** The scale the shock ran at (1 = as written); absent on runs stored before SRC-18. */
        scale: z.number().optional(),
        outputs: Outputs,
        delta: Outputs,
      }),
    ),
    /**
     * Every shock tier 2 knows, in spec order, with its definition as written in `solvers.json` (variable ids →
     * value, or signed text such as `"+0.30"`; `shift`: months or units added). Labels for tier 1, never applied
     * there. Absent on runs stored before SRC-18.
     */
    catalog: z
      .array(
        z.object({
          name: z.string().min(1),
          set: z.record(z.string(), z.union([z.number(), z.string()])).optional(),
          shift: z.record(z.string(), z.number()).optional(),
        }),
      )
      .optional(),
  }),
  z.object({
    problem: z.literal('wave_plan'),
    /** Every planned lever: start month before and after (`lev.start`), and its quarter after (1-4). */
    levers: z.array(
      z.object({
        lever: MemberKey,
        from: StartMonth,
        to: StartMonth,
        quarter: z.number().int().min(1).max(4),
      }),
    ),
    /** The four quarters of 2027 under the plan: one-time $M and launches against their caps. */
    quarters: z.array(
      z.object({
        quarter: z.number().int().min(1).max(4),
        oneTime: z.number(),
        launches: z.number().int().nonnegative(),
        /** The quarterly one-time cap applied, $M; null when uncapped. */
        cap: z.number().nullable(),
        /** The launch capacity applied; null when uncapped. */
        launchCap: z.number().int().nonnegative().nullable(),
      }),
    ),
    /** CY27 net (`res.net[]`), $M, at the start point and under the plan. */
    netBefore: z.number(),
    netAfter: z.number(),
  }),
]);
export type SolverDetail = z.infer<typeof SolverDetail>;

/**
 * 03 §3 `SolverResult`. `changes` are the moves (decision inputs only), ready to become a
 * changeset on a new scenario; `metrics` are headline numbers keyed by tier 2 (net, risk,
 * one-time, P(clear) …). A metric that is a model cell is keyed by its wire cell key
 * (`res.net[]`, `vp.gap[vp_x]`, as `CellKey`), whichever solver produced it and wherever the
 * run was stored; the others keep the solver's own name (`risk_exposure`, `lambda`).
 *
 * `min_risk_mix` also reports the reference points of the Path screen's savings-vs-risk scatter, one
 * (net, risk) pair for each key `C`, `D` and `allvps` (the all-VP plan): `net[<key>]` and
 * `risk_exposure[<key>]` (SOL-13). They sit beside the run's own `res.net[]` and `risk_exposure`,
 * so one run draws all four dots; a tenant without the C and D presets has none.
 */
export const SolverResult = z
  .object({
    problem: ProblemId,
    status: SolverOutcome,
    changes: z.array(VariableChange),
    ranked: z.array(RankedMove),
    binding: z.array(BindingConstraint).optional(),
    metrics: z.record(z.string(), z.number()),
    diagnostics: SolverDiagnostics,
    detail: SolverDetail.optional(),
  })
  .refine((r) => !r.detail || r.detail.problem === r.problem, {
    message: 'detail.problem must equal problem',
    path: ['detail', 'problem'],
  });
export type SolverResult = z.infer<typeof SolverResult>;

// ---------------------------------------------------------------------------
// The run (solver_run + DATA-11 progress columns)
// ---------------------------------------------------------------------------

/**
 * Job state as stored on `solver_run` (DATA-11): `progress` 0..1, `progress_note`,
 * `cancel_requested`. The WS `job` message carries the same values (`note` = `progressNote`).
 */
export const JobState = z.object({
  status: JobStatus,
  progress: JobProgressFraction,
  progressNote: OneLine.nullable(),
  cancelRequested: z.boolean(),
});
export type JobState = z.infer<typeof JobState>;

/**
 * A solver run: what `POST`, `POST quick`, `GET` and `DELETE /solver-runs/:id` answer.
 * `result` is set once `status` is `done` (or `cancelled` with a partial result);
 * `error` once it is `failed`. `cached`: answered from the `(problem, params, inputHash)` cache.
 * `DELETE` sets `cancelRequested`; the run stops at its next batch (`status: cancelled`).
 */
export const SolverRun = z
  .object({
    id: JobId,
    scenarioId: ScenarioId,
    /** Scenario version and input hash the run started from; hash `null` until computed. */
    scenarioVersion: Version,
    inputHash: InputHash.nullable(),
    spec: SolverSpec,
    quick: z.boolean(),
    save: z.boolean(),
    ...JobState.shape,
    cached: z.boolean(),
    result: SolverResult.nullable(),
    resultScenarioId: ScenarioId.nullable(),
    error: Problem.nullable(),
    createdBy: UserId.nullable(),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  })
  .refine((r) => !r.result || r.result.problem === r.spec.problem, {
    message: 'result.problem must equal spec.problem',
    path: ['result', 'problem'],
  });
export type SolverRun = z.infer<typeof SolverRun>;

// ---------------------------------------------------------------------------
// Lookup without side effects (API-13)
// ---------------------------------------------------------------------------

const isJsonObject = (text: string): boolean => {
  try {
    const v: unknown = JSON.parse(text);
    return v !== null && typeof v === 'object' && !Array.isArray(v);
  } catch {
    return false;
  }
};

/**
 * `GET /api/t/:tenant/solver-runs/lookup?scenarioId&problem[&params]`: what tier 2 already holds for
 * `(scenario, problem, params)`. Query values are text, so `params` is the JSON of the problem's
 * parameters; absent = `{}`, every parameter left to tier 2's defaults (the key the demo cache
 * warmer files its runs under).
 */
export const SolverLookupQuery = z.object({
  scenarioId: ScenarioId,
  problem: ProblemId,
  params: z
    .string()
    .refine(isJsonObject, { message: 'params must be a JSON object' })
    .optional(),
});
export type SolverLookupQuery = z.infer<typeof SolverLookupQuery>;

/**
 * The answer of a lookup. Reading never enqueues, runs, saves or writes a row.
 *
 * - `run`: the newest finished run of this scenario, problem and params: one computed from the
 *   scenario's present inputs (`current: true`; its `scenarioVersion` is the scenario's present
 *   version, as for a result-cache hit), else the newest finished run of the same problem and
 *   params from earlier inputs (`current: false`, kept as stored: a result to show dimmed).
 *   `null`: none (`current: false`).
 * - `trials`: the draws a Monte Carlo run with these params would make (`params.iterations`, else
 *   the solver default held by tier 2); `null` for the other problems. Tier 1 prints it, never
 *   holds the number.
 */
export const SolverLookup = z.object({
  run: SolverRun.nullable(),
  current: z.boolean(),
  trials: z.number().int().positive().nullable(),
});
export type SolverLookup = z.infer<typeof SolverLookup>;
