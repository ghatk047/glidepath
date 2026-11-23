# JOB · Jobs

pg-boss worker runtime, solver job handlers, relay to WebSocket, result cache, demo cache warmer.

4 items. Fields and status values: see [README](README.md). Rubric: `docs/architecture/10_backlog_conventions.md` §2.

| id | title | ms | model/effort | size | depends on |
|---|---|---|---|---|---|
| JOB-01 | Worker runtime on pg-boss: queues, progress, cancel | M3 | sonnet/high | M | DATA-06, DATA-11 |
| JOB-02 | Job relay to WebSocket and result cache | M3 | sonnet/high | S | JOB-01, API-07 |
| JOB-03 | Solver job handlers and save-as-scenario | M3 | sonnet/high | M | JOB-01, SOL-05, SOL-06, DOM-04, DOM-05 |
| JOB-04 | Demo cache warmer | M4 | sonnet/medium | S | JOB-03, JOB-02 |

## JOB-01 · Worker runtime on pg-boss: queues, progress, cancel

```yaml
id: JOB-01
title: "Worker runtime on pg-boss: queues, progress, cancel"
epic: JOB
milestone: M3
priority: must
status: done
stream: A
model: sonnet
effort: high
depends_on: [DATA-06, DATA-11]
tier: 2
package: "tier2-logic/worker/src/runtime"
contract: "dist/worker.js; registerHandler(queue, fn)"
inputs:
  - "docs/architecture/03_engine_and_solvers.md#4. Job runtime"
  - "docs/adr/ADR-023-manual-migrations.md"
  - "docs/adr/ADR-024-job-relay-polling.md"
  - "docs/architecture/01_architecture_overview.md#4. Key decisions (ADR summary) (ADR-008)"
acceptance:
  - "worker connects with DATABASE_URL, starts pg-boss, consumes solver.*, excel.*, ai.* with concurrency JOB_CONCURRENCY (default 2 per vCPU) (test on pg-local)"
  - "progress written to solver_run.progress at most every 250 ms (test with fake clock)"
  - "cancel: cancel_requested = true makes the handler's AbortSignal fire; status cancelled (test)"
  - "SIGTERM drains in-flight jobs (test); each job runs inside withTenant for its tenant (test: other tenant rows invisible)"
gates: [G1, G2, G7]
size: M
notes: ""
merged_at: "2026-11-23"
```

The worker container's runtime.

## JOB-02 · Job relay to WebSocket and result cache

```yaml
id: JOB-02
title: "Job relay to WebSocket and result cache"
epic: JOB
milestone: M3
priority: must
status: todo
stream: A
model: sonnet
effort: high
depends_on: [JOB-01, API-07]
tier: 2
package: "tier2-logic/server/src/jobs"
contract: "JobRelay; cache lookup on enqueue"
inputs:
  - "docs/architecture/03_engine_and_solvers.md#4. Job runtime"
  - "docs/adr/ADR-024-job-relay-polling.md"
  - "contract/api-contract (job message)"
acceptance:
  - "job updates reach every session of that tenant/scenario as `job` messages within 500 ms by polling solver_run (no LISTEN/NOTIFY) (test)"
  - "result cache keyed (problem, params hash, inputHash): re-running an unchanged scenario returns the cached result without enqueueing (test)"
gates: [G1, G2]
size: S
notes: ""
```

Progress bars and instant re-runs.

## JOB-03 · Solver job handlers and save-as-scenario

```yaml
id: JOB-03
title: "Solver job handlers and save-as-scenario"
epic: JOB
milestone: M3
priority: must
status: todo
stream: A
model: sonnet
effort: high
depends_on: [JOB-01, SOL-05, SOL-06, DOM-04, DOM-05]
tier: 2
package: "tier2-logic/worker/src/jobs/solver"
contract: "handlers solver.min_risk_mix, solver.vp_feasible, solver.monte_carlo"
inputs:
  - "docs/architecture/03_engine_and_solvers.md#4. Job runtime"
  - "docs/architecture/03_engine_and_solvers.md#3. Package `tier2-logic/solvers`"
  - "docs/ux/02_information_architecture.md#3. Objects"
acceptance:
  - "handlers build a CompiledModel from v_inputs_resolved and run the pure solver with the job's signal/progress (test on pg-local + AA seed)"
  - "min-risk and VP-feasible results saved as a new scenario kind=solver via applyChangeset origin=solver, with ranked moves and binding constraints in solver_run.result (test)"
  - "Monte Carlo stores its result on solver_run without creating a scenario (test)"
  - "pareto/sobol queues registered only when SOL-09/10 exist (feature flag) (test)"
gates: [G1, G2, G5]
size: M
notes: ""
```

Long solvers off the request path.

## JOB-04 · Demo cache warmer

```yaml
id: JOB-04
title: "Demo cache warmer"
epic: JOB
milestone: M4
priority: must
status: todo
stream: A
model: sonnet
effort: medium
depends_on: [JOB-03, JOB-02]
tier: 2
package: "tier2-logic/worker/src/warm"
contract: "`pnpm warm --tenant aa`"
inputs:
  - "docs/ux/05_demo_storyline.md#Before the day"
  - "docs/architecture/09_delivery_plan.md#4. Risks and responses (min-risk row)"
acceptance:
  - "pre-runs Monte Carlo for C and D, min-risk and VP-feasible from C; a second run is all cache hits (test)"
  - "migrate runs it when WARM=1 (demo profile) (test)"
  - "Cockpit odds and fastest-path data load from cache in < 200 ms via the API (test)"
gates: [G1, G2]
size: S
notes: ""
```

Odds and paths appear instantly in the room.
