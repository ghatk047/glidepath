# Jobs: relay and result cache (JOB-02)

| File | What |
|---|---|
| `relay.ts` | `createJobRelay({ targets, source, intervalMs })`: polls `solver_run` and pushes `job` messages to the sessions of that tenant/scenario (ADR-024, no LISTEN/NOTIFY). `dbJobSource(withTenant)`, `jobRelayPollMs(env)` (`JOB_RELAY_POLL_MS`, default 250, clamped 50..400). |
| `cache.ts`, `params-hash.ts` | Cache key `(problem, paramsHash, inputHash)`, stored as `spec.cache` on the run; `findCachedRun` over `done` runs. |
| `submit.ts` | `createSolverSubmitter({ withTenant, enqueue, inputHashOf })`: cache lookup, then create the run and `enqueue('solver.<problem>', {tenantId,userId,runId})` after commit. |

Relay: one query per (tenant, scenario) with an open session per tick; a session gets runs that changed since it last heard (status, progress, note, cancel flag). A session's first look replays only queued/running runs. `hub.sessions` is the `targets` source (`Session.deliver`). Wired in `app/start.ts` (API-09): started after the server listens, stopped first on shutdown.

Cache: a hit writes a new `done` run with the cached result (no `result_scenario_id`) and enqueues nothing. `inputHashOf` defaults to the scenario's latest `calc_run.input_hash`; null disables caching for that call. Only `done` runs are reused.

Tests: `relay.test.ts` (fake clock), `jobs.pg.test.ts` (real sockets, RLS, cache).
