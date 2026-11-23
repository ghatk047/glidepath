import { createSolverRun, getLatestCalcRun, listScenarios, listSolverRuns, withTenant } from '@glidepath/data-access';
import type { Db, SolverRunKind, TenantTx } from '@glidepath/data-access';
import type { JsonValue } from '@glidepath/domain';
import { HandlerRegistry, runJob, silentLogger, systemClock } from '../runtime';
import { registerSolverHandlers } from '../jobs/solver/register';
import { runSolverJob } from '../jobs/solver/run';
import { QUEUE_SENSITIVITY } from '../jobs/solver/types';
import type { SolverJobDeps, SolverJobPayload } from '../jobs/solver/types';
import { cacheKeyOf, sameKey, storedKey, withCacheKey } from './cache-key';
import type { CacheKey } from './cache-key';

/** One result to pre-run: a solver problem from a preset scenario, with the parameters the cockpit sends. */
export interface WarmJob {
  readonly problem: 'monte_carlo' | 'min_risk_mix' | 'vp_feasible' | 'sensitivity';
  /** `solver_run.kind` of the problem. */
  readonly kind: SolverRunKind;
  /** Key of the locked preset the run starts from (tenant data: a tenant without it is skipped). */
  readonly preset: string;
  /** Sent as `spec.params`; empty means tier 2's defaults (the spec bundle and registry), as the cockpit sends. */
  readonly params: Readonly<Record<string, unknown>>;
}

/**
 * The Path screen's tornado: quick `sensitivity` as a tornado on net. These are the exact params the screen's
 * look-up sends (`tier1-presentation/web/src/modules/path/params.ts` `tornadoSpec`, wire cell `res.net[]`), so the
 * look-up (API-13) hashes to the key the warmer files the run under; `warm.pg.test.ts` proves the hit.
 */
export const PATH_TORNADO_PARAMS: Readonly<Record<string, unknown>> = { method: 'tornado', outputs: ['res.net[]'] };

/**
 * The demo storyline's "Before the day" (docs/ux/05_demo_storyline.md): Monte Carlo for C and D so the odds
 * appear at once, the min-risk and VP-feasible plans from C (09 section 4, min-risk row) so the fastest path
 * is there when asked, and the Path screen's tornado for D (SOL-13: with the odds above, Path shows its results
 * without a Run click). Monte Carlo and the optimisers use tier 2's defaults; no business number lives here.
 */
export const WARM_JOBS: readonly WarmJob[] = [
  { problem: 'monte_carlo', kind: 'monte_carlo', preset: 'C', params: {} },
  { problem: 'monte_carlo', kind: 'monte_carlo', preset: 'D', params: {} },
  { problem: 'min_risk_mix', kind: 'optimize', preset: 'C', params: {} },
  { problem: 'vp_feasible', kind: 'optimize', preset: 'C', params: {} },
  { problem: 'sensitivity', kind: 'sensitivity', preset: 'D', params: PATH_TORNADO_PARAMS },
];

export type WarmStatus = 'ran' | 'hit' | 'skipped' | 'failed';

export interface WarmEntry {
  readonly problem: string;
  readonly preset: string;
  readonly status: WarmStatus;
  readonly runId?: string;
  readonly ms: number;
  readonly reason?: string;
}

export interface WarmReport {
  readonly entries: readonly WarmEntry[];
  readonly ran: number;
  readonly hits: number;
  readonly failed: number;
  readonly skipped: number;
}

export interface WarmOptions {
  /** A connection whose role the tenant's RLS applies to (or the owner role, which sees everything). */
  readonly db: Db;
  readonly tenantId: string;
  readonly userId: string;
  readonly deps: SolverJobDeps;
  readonly jobs?: readonly WarmJob[];
  readonly signal?: AbortSignal;
  readonly log?: (message: string) => void;
}

const SCAN_LIMIT = 200;

async function cached(tx: TenantTx, scenarioId: string, key: CacheKey): Promise<string | null> {
  const runs = await listSolverRuns(tx, { scenarioId, status: 'done', limit: SCAN_LIMIT });
  return (
    runs.find((r) => {
      const k = storedKey(r.spec);
      return k !== null && sameKey(k, key);
    })?.id ?? null
  );
}

/**
 * Pre-runs the demo's solver jobs for one tenant through the worker's own handlers (`runJob`, so run status,
 * progress and result are the runtime's) and files each result under the JOB-02 cache key
 * `(problem, params hash, inputHash)` of its start scenario. A job whose key already has a finished run is a
 * hit and is not run again, so a second warm is all hits and cheap. Results are not saved as scenarios
 * (`save: false`): the demo tenant stays as seeded. A failing job is reported and the rest still run.
 */
export async function warmTenant(options: WarmOptions): Promise<WarmReport> {
  const { db, tenantId, userId, deps } = options;
  const log = options.log ?? (() => undefined);
  const registry = new HandlerRegistry();
  registerSolverHandlers(registry, () => deps);
  // The tornado is a quick run in the API; the worker's own sensitivity queue is Sobol only, so the warmer runs the
  // tornado through the same job runner (run row, progress, result) under a handler of its own.
  registry.registerHandler<SolverJobPayload>(QUEUE_SENSITIVITY, async (ctx) => {
    const out = await runSolverJob(ctx, { problem: 'sensitivity' }, deps);
    return out.stored as JsonValue;
  });
  const inTenant = <T>(fn: (tx: TenantTx) => Promise<T>): Promise<T> => withTenant(db, tenantId, userId, fn);
  const shutdown = options.signal ?? new AbortController().signal;
  const entries: WarmEntry[] = [];

  for (const job of options.jobs ?? WARM_JOBS) {
    const started = Date.now();
    const entry = (status: WarmStatus, extra: { runId?: string; reason?: string } = {}): WarmEntry => ({
      problem: job.problem,
      preset: job.preset,
      status,
      ms: Date.now() - started,
      ...extra,
    });
    let result: WarmEntry;
    try {
      const spec = { problem: job.problem, params: job.params };
      const staged = await inTenant(async (tx) => {
        const scenario = (await listScenarios(tx)).find((s) => s.key === job.preset);
        if (!scenario) return { kind: 'skip' as const, reason: `no preset ${job.preset}` };
        const inputHash = (await getLatestCalcRun(tx, scenario.id))?.input_hash;
        if (!inputHash) return { kind: 'skip' as const, reason: `preset ${job.preset} has no calc_run, so no cache key` };
        const key = cacheKeyOf(spec, inputHash);
        const hit = await cached(tx, scenario.id, key);
        if (hit !== null) return { kind: 'hit' as const, runId: hit };
        const run = await createSolverRun(tx, { kind: job.kind, scenario_id: scenario.id, spec: withCacheKey(spec, key) });
        return { kind: 'run' as const, runId: run.id };
      });
      if (staged.kind === 'skip') result = entry('skipped', { reason: staged.reason });
      else if (staged.kind === 'hit') result = entry('hit', { runId: staged.runId });
      else {
        await runJob(
          { db, clock: systemClock, logger: silentLogger, cancelPollMs: 1000, shutdown },
          registry.get(`solver.${job.problem}`)!,
          {
            id: `warm-${staged.runId}`,
            data: { tenantId, userId, runId: staged.runId, save: false },
            signal: new AbortController().signal,
          },
        );
        result = entry('ran', { runId: staged.runId });
      }
    } catch (err) {
      result = entry('failed', { reason: err instanceof Error ? err.message : String(err) });
    }
    entries.push(result);
    log(`warm: ${job.problem} from ${job.preset}: ${result.status} (${result.ms} ms)${result.reason ? `, ${result.reason}` : ''}`);
    if (shutdown.aborted) break;
  }

  const count = (s: WarmStatus): number => entries.filter((e) => e.status === s).length;
  return { entries, ran: count('ran'), hits: count('hit'), failed: count('failed'), skipped: count('skipped') };
}
