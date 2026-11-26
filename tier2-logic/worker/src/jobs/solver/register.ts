import type { JsonValue } from '@glidepath/domain';
import { defaultRegistry } from '../../runtime';
import type { HandlerRegistry, JobContext } from '../../runtime';
import { defaultSolverDeps } from './deps';
import { runSolverJob } from './run';
import type { SolverHandlerSpec } from './run';
import {
  NO_FLAGS,
  QUEUE_MIN_RISK_MIX,
  QUEUE_MONTE_CARLO,
  QUEUE_PARETO,
  QUEUE_SENSITIVITY,
  QUEUE_VP_FEASIBLE,
  QUEUE_WAVE_PLAN,
  solverFlagsFromEnv,
} from './types';
import type { SolverFlags, SolverJobDeps, SolverJobPayload } from './types';

interface QueueDef {
  readonly queue: string;
  readonly handler: SolverHandlerSpec;
}

/** The queues every build has. */
export const CORE_QUEUES: readonly QueueDef[] = [
  { queue: QUEUE_MIN_RISK_MIX, handler: { problem: 'min_risk_mix' } },
  { queue: QUEUE_VP_FEASIBLE, handler: { problem: 'vp_feasible' } },
  { queue: QUEUE_MONTE_CARLO, handler: { problem: 'monte_carlo' } },
  { queue: QUEUE_WAVE_PLAN, handler: { problem: 'wave_plan' } },
];
/** Queues that wait for their solver: SOL-09 (pareto) and SOL-10 (Sobol), each behind a flag. */
export const PARETO_QUEUE: QueueDef = { queue: QUEUE_PARETO, handler: { problem: 'pareto' } };
export const SOBOL_QUEUE: QueueDef = { queue: QUEUE_SENSITIVITY, handler: { problem: 'sensitivity', method: 'sobol' } };

const defsFor = (flags: SolverFlags): QueueDef[] => [
  ...CORE_QUEUES,
  ...(flags.pareto ? [PARETO_QUEUE] : []),
  ...(flags.sobol ? [SOBOL_QUEUE] : []),
];

/** Queue names `registerSolverHandlers` registers for `flags`. */
export const solverQueues = (flags: SolverFlags = NO_FLAGS): string[] => defsFor(flags).map((q) => q.queue);

/**
 * Registers the solver handlers on `registry`: `solver.min_risk_mix`, `solver.vp_feasible`,
 * `solver.monte_carlo`, `solver.wave_plan` (SRC-15), and with the flags `solver.pareto` (SOL-09) and `solver.sensitivity` (SOL-10, Sobol
 * only). `deps` is resolved on the first job, so importing the module touches no spec files.
 */
export function registerSolverHandlers(
  registry: HandlerRegistry,
  deps: () => SolverJobDeps,
  flags: SolverFlags = NO_FLAGS,
): void {
  for (const { queue, handler } of defsFor(flags)) {
    registry.registerHandler<SolverJobPayload>(queue, async (ctx: JobContext<SolverJobPayload>) => {
      const out = await runSolverJob(ctx, handler, deps());
      return out.stored as JsonValue;
    });
  }
}

let shared: SolverJobDeps | undefined;
registerSolverHandlers(defaultRegistry, () => (shared ??= defaultSolverDeps()), solverFlagsFromEnv());
