import type { JsonValue, ModelCache } from '@glidepath/domain';
import type { CompiledModel } from '@glidepath/engine';
import type { ModelBundle } from '@glidepath/spec';
import type { JobContext, JobPayload } from '../../runtime';

/** Queues of the solver handlers (JOB-01: `solver.<problem>`; JOB-02 enqueues them under that name). */
export const QUEUE_MIN_RISK_MIX = 'solver.min_risk_mix';
export const QUEUE_VP_FEASIBLE = 'solver.vp_feasible';
export const QUEUE_MONTE_CARLO = 'solver.monte_carlo';
/** Registered only with the `pareto` flag (SOL-09). */
export const QUEUE_PARETO = 'solver.pareto';
/** Registered only with the `sobol` flag (SOL-10): `sensitivity` with method `sobol`. */
export const QUEUE_SENSITIVITY = 'solver.sensitivity';

/** Problems whose result is saved as a scenario (UX 02 section 3: "a solver run lands as a new scenario"). */
export const SAVING_PROBLEMS: readonly string[] = ['min_risk_mix', 'vp_feasible'];

/** What the handlers use of the runtime's JobContext (tests pass a plain object). */
export type SolverJobContext = Pick<
  JobContext<SolverJobPayload>,
  'tenantId' | 'userId' | 'withTenant' | 'progress' | 'signal' | 'payload'
>;

/** Job data: the runtime's tenant, user and run id; `save: false` keeps a min-risk or VP-feasible result from becoming a scenario. */
export interface SolverJobPayload extends JobPayload {
  readonly runId: string;
  readonly save?: boolean;
}

/** Optional queues that exist only once their solver does. Off by default; see `solverFlagsFromEnv`. */
export interface SolverFlags {
  /** `solver.pareto` (SOL-09). */
  readonly pareto: boolean;
  /** `solver.sensitivity`, Sobol only (SOL-10). */
  readonly sobol: boolean;
}

export const NO_FLAGS: SolverFlags = { pareto: false, sobol: false };

const truthy = (v: string | undefined): boolean => v !== undefined && /^(1|true|yes|on)$/i.test(v.trim());

/** `JOB_SOLVER_PARETO`, `JOB_SOLVER_SOBOL` (environment only; set them when SOL-09 / SOL-10 are in the build). */
export function solverFlagsFromEnv(env: Readonly<Record<string, string | undefined>> = process.env): SolverFlags {
  return { pareto: truthy(env.JOB_SOLVER_PARETO), sobol: truthy(env.JOB_SOLVER_SOBOL) };
}

/** Everything the handlers take from outside the database. */
export interface SolverJobDeps {
  /** The spec bundle of a pinned `model_version.semver`; null when this worker has none for it. */
  bundle(semver: string): Promise<ModelBundle | null>;
  /** Compiled models shared by the jobs of this process. */
  readonly cache: ModelCache<CompiledModel>;
  /**
   * Keys of the presets whose per-cell maximum is the stretch cap of a lever-intensity input
   * (`solvers.json` decision_variable_sets: "max(C, D) preset value"). Tenant data: presets the tenant lacks are skipped.
   */
  readonly stretchPresets: readonly string[];
}

/** A job fails with a message the user can act on. */
export class SolverJobError extends Error {
  override readonly name = 'SolverJobError';
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** What `solver_run.result` holds: the solver's `SolverResult` plus where it landed. */
export type StoredSolverResult = { readonly [field: string]: JsonValue };
