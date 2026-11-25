# worker runtime (JOB-01)

pg-boss consumers for the `worker` container (ADR-008, `docs/architecture/03_engine_and_solvers.md` section 4). Entry: `src/worker.ts`, bundled to `dist/worker.js` (`pnpm --filter @glidepath/worker build`).

## Contract

```ts
import { registerHandler } from '@glidepath/worker/src/runtime';
registerHandler('solver.min_risk_mix', async (ctx) => {
  ctx.progress(0.2, 'searching');           // solver_run.progress / progress_note, at most every 250 ms
  if (ctx.signal.aborted) return partial;   // fires on cancel_requested, drain timeout, pg-boss expiry
  await ctx.withTenant((tx) => /* repositories */);
  return { ranked: [] };                    // stored in solver_run.result (omit when the handler saved it)
});
```

- Queue names are `solver.*`, `excel.*`, `ai.*` (anything else is rejected). One handler per queue. Job data must carry `tenantId`, `userId` (uuids) and, on `solver.*`, `runId` (the `solver_run` id); other fields belong to the handler. `enqueueJob(boss, queue, payload)` checks that.
- `ctx.withTenant(fn)` is `withTenant(db, tenantId, userId, fn)` of the job's own tenant; the runtime and the handler touch tenant data only through it (repositories throw `TenantScopeError` otherwise), and RLS applies because the worker connects as the app role. A job whose `runId` is not a run of its tenant fails without running.
- `solver.*` lifecycle on `solver_run`: `running` at start, progress throttled to 250 ms (`ProgressThrottle`, first report immediate, latest value wins), then `done` (progress 1, `result`), `failed` (`result = {error}`, the error is rethrown so pg-boss records it) or `cancelled`. A run already cancelled before it starts is marked `cancelled` and not run. `excel.*` and `ai.*` jobs have no `solver_run`: `progress` is a no-op and their own tables are the handler's business.
- Cancel: `cancel_requested = true` is noticed when a progress write returns and by polling every `JOB_CANCEL_POLL_MS` (default 500); the handler's `signal` aborts with `JobCancelledError` and the run ends `cancelled` (a returned partial result is kept). No LISTEN/NOTIFY (ADR-024).

## Settings (environment only)

| Variable | Default | |
|---|---|---|
| `DATABASE_URL` | required | app role |
| `DATABASE_URL_MIGRATE` | unset | owner role; when set, `worker.ts` runs `installQueueSchema` first |
| `JOB_CONCURRENCY` | 2 per vCPU | jobs running at once in the process, over all queues (a process-wide semaphore on top of pg-boss `localConcurrency`) |
| `JOB_POLL_MS` / `JOB_CANCEL_POLL_MS` | 1000 / 500 | pg-boss polling (min 500) / cancel polling |
| `JOB_SHUTDOWN_TIMEOUT_MS` | 25000 | SIGTERM drain time before signals abort (keep below the container stop grace period) |
| `JOB_EXPIRE_SECONDS` | 3600 | a job active longer is expired by pg-boss |
| `JOB_QUEUE_SCHEMA` | `pgboss` | pg-boss schema |
| `LOG_LEVEL` | `info` | JSON lines on stdout |

Queues are created with `retryLimit 0` unless `registerHandler(queue, fn, { retryLimit })` says otherwise: a solver run is never silently re-run.

## pg-boss schema and the app role (ADR-023 style)

The app role cannot create schemas, so the pg-boss schema is installed as the owner role: `installQueueSchema({ ownerUrl: DATABASE_URL_MIGRATE, queues })` installs or upgrades pg-boss, creates the queues, and grants `glidepath_app` DML on schema `pgboss` (default privileges included). It is idempotent. Call it from the migrate step (DATA-08) or let `worker.ts` do it by giving the worker `DATABASE_URL_MIGRATE`. Without it `start()` fails with a message saying so. The schema holds job envelopes (ids), not tenant rows.

## Shutdown

`installShutdownHandlers(runtime, exit)`: SIGTERM or SIGINT starts one `runtime.stop()`: stop fetching, wait for in-flight jobs up to `JOB_SHUTDOWN_TIMEOUT_MS` (they finish and are recorded), then abort the signals of what is left (those solver runs end `failed`: "worker stopped before the run finished"), close pg-boss and the pool, exit 0. Jobs fetched but not yet started when shutdown begins (waiting for a free slot) fail without running and their solver run is marked `failed`.

## Tests

`progress.test.ts` (fake clock), `units.test.ts`, `runtime.pg.test.ts` (pg-local, two tenants, app role), `entry.pg.test.ts` (spawns `src/worker.ts`, SIGTERM exits 0). `testing/` holds the fake clock and the seeded database.

## G13 note

`boss.ts` is the only file that imports `pg-boss` and carries an eslint-disable for the G13 driver rule; replace it with an exemption in `tools/eslint-config`.
