import { WS_PROTOCOL_VERSION } from '@glidepath/api-contract';
import type { ScenarioId, ServerMessage, TenantId, UserId } from '@glidepath/api-contract';
import { listSolverRuns } from '@glidepath/data-access';
import type { SolverRunRecord } from '@glidepath/data-access';
import type { Logger } from '../app/logger';
import type { WithTenant } from '../app/tenant';
import { systemClock } from '../session/clock';
import type { Clock, Timer } from '../session/clock';

/**
 * JobRelay (JOB-02, ADR-024): job updates reach tier 1 over the session WebSocket as `job` messages, by polling
 * `solver_run` (no LISTEN/NOTIFY: a transaction pooler has no session connection). Each tick, for every
 * (tenant, scenario) with an open session, the runs of that scenario are read in one tenant transaction and
 * every session on it is sent the runs that changed since it last heard of them (status, progress, note,
 * cancel flag). Latency is at most one poll interval plus a query.
 *
 * A session's first tick is its baseline: finished runs already there are not replayed, queued and running
 * ones are sent (a reconnecting client learns what is in flight); later changes, and runs created after
 * the baseline, are sent in any state. A session that switches scenario gets a fresh baseline.
 */

/** Poll interval default (ms): well inside the 500 ms the UI is promised. Setting `JOB_RELAY_POLL_MS`. */
export const DEFAULT_JOB_RELAY_POLL_MS = 250;
export const MIN_JOB_RELAY_POLL_MS = 50;
export const MAX_JOB_RELAY_POLL_MS = 400;
/** Runs read per scenario per tick. */
export const RELAY_RUNS_PER_SCENARIO = 50;

/** The poll interval from `JOB_RELAY_POLL_MS` (integer ms, clamped to the range that keeps the 500 ms promise). */
export function jobRelayPollMs(env: Record<string, string | undefined> = process.env): number {
  const raw = env.JOB_RELAY_POLL_MS?.trim();
  if (raw === undefined || raw === '') return DEFAULT_JOB_RELAY_POLL_MS;
  if (!/^\d+$/.test(raw)) throw new Error(`JOB_RELAY_POLL_MS must be a whole number of milliseconds, got '${raw}'`);
  return Math.min(MAX_JOB_RELAY_POLL_MS, Math.max(MIN_JOB_RELAY_POLL_MS, Number(raw)));
}

/** What the relay needs of a session (the session hub's `Session` fits). */
export interface JobTarget {
  readonly tenant: { readonly tenantId: TenantId };
  readonly userId: UserId;
  readonly scenarioId: ScenarioId;
  readonly isClosed: boolean;
  deliver(message: ServerMessage): void;
}

/** The runs of one scenario of one tenant (newest first). */
export type JobSource = (tenantId: TenantId, userId: UserId, scenarioId: ScenarioId) => Promise<readonly SolverRunRecord[]>;

/** `solver_run` through a tenant transaction (RLS applies). */
export function dbJobSource(withTenant: WithTenant): JobSource {
  return (tenantId, userId, scenarioId) =>
    withTenant(tenantId, userId, (tx) => listSolverRuns(tx, { scenarioId, limit: RELAY_RUNS_PER_SCENARIO }));
}

export interface JobRelayDeps {
  /** The sessions open now. */
  readonly targets: () => Iterable<JobTarget>;
  readonly source: JobSource;
  readonly logger?: Logger;
  readonly clock?: Clock;
  readonly intervalMs?: number;
}

export interface JobRelay {
  /** Starts polling (idempotent). */
  start(): void;
  /** Stops polling; a tick in flight finishes but arms no further one. */
  stop(): Promise<void>;
  /** One poll now; resolves when its messages were delivered. */
  tick(): Promise<void>;
}

/** The `job` message of a run (`solver_run.progress_note` is `note`). */
export function jobMessage(run: SolverRunRecord): ServerMessage {
  const live = run.status === 'queued' || run.status === 'running';
  return {
    v: WS_PROTOCOL_VERSION,
    type: 'job',
    id: run.id,
    status: run.status,
    progress: run.progress,
    note: run.progress_note,
    kind: 'solver',
    cancelRequested: run.cancel_requested && live,
  } as ServerMessage;
}

const signature = (run: SolverRunRecord): string =>
  `${run.status}|${run.progress}|${run.progress_note ?? ''}|${run.cancel_requested ? 1 : 0}`;

interface Heard {
  scenarioId: string;
  sigs: Map<string, string>;
}

export function createJobRelay(deps: JobRelayDeps): JobRelay {
  const clock = deps.clock ?? systemClock;
  const interval = Math.max(1, deps.intervalMs ?? DEFAULT_JOB_RELAY_POLL_MS);
  const heard = new WeakMap<JobTarget, Heard>();
  let running = false;
  let timer: Timer | null = null;
  let inflight: Promise<void> | null = null;

  async function pollGroup(tenantId: TenantId, scenarioId: ScenarioId, group: JobTarget[]): Promise<void> {
    let runs: readonly SolverRunRecord[];
    try {
      runs = await deps.source(tenantId, group[0]!.userId, scenarioId);
    } catch (err) {
      deps.logger?.warn('job relay poll failed', { err, scenario: scenarioId });
      return;
    }
    for (const target of group) {
      if (target.isClosed) continue;
      let h = heard.get(target);
      const baseline = !h || h.scenarioId !== scenarioId;
      if (baseline) {
        h = { scenarioId, sigs: new Map() };
        heard.set(target, h);
      }
      // Oldest first, so a client sees runs in the order they started.
      for (const run of [...runs].reverse()) {
        const sig = signature(run);
        if (h!.sigs.get(run.id) === sig) continue;
        const live = run.status === 'queued' || run.status === 'running';
        h!.sigs.set(run.id, sig);
        if (baseline && !live) continue;
        target.deliver(jobMessage(run));
      }
    }
  }

  async function tick(): Promise<void> {
    const groups = new Map<string, { tenantId: TenantId; scenarioId: ScenarioId; targets: JobTarget[] }>();
    for (const t of deps.targets()) {
      if (t.isClosed) continue;
      const k = `${t.tenant.tenantId}/${t.scenarioId}`;
      const g = groups.get(k) ?? { tenantId: t.tenant.tenantId, scenarioId: t.scenarioId, targets: [] };
      g.targets.push(t);
      groups.set(k, g);
    }
    await Promise.all([...groups.values()].map((g) => pollGroup(g.tenantId, g.scenarioId, g.targets)));
  }

  const arm = () => {
    if (!running) return;
    timer = clock.after(interval, () => {
      timer = null;
      inflight = tick()
        .catch((err: unknown) => deps.logger?.error('job relay tick failed', { err }))
        .finally(() => {
          inflight = null;
          arm();
        });
    });
  };

  return {
    start() {
      if (running) return;
      running = true;
      arm();
    },
    async stop() {
      running = false;
      timer?.cancel();
      timer = null;
      await inflight;
    },
    tick,
  };
}
