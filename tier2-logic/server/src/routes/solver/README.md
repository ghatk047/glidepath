# Solver routes (API-09)

`registerSolverRoutes(app, deps)` mounts the solver half of 04 section 3 on `/api/t/:tenant/*`, after the tenant middleware and the role guards (every POST and DELETE is owner or editor). `createApp({ solver })` calls it (its `hub`, when none is given, is the session hub); without `solver` the routes are not mounted.

| Route | Answer (`@glidepath/api-contract`) |
|---|---|
| `POST solver-runs/quick` | 200 `SolverRun` (`quick: true`, `done`, result inline). Over the 2 s limit: 202 `SolverRun` of the queued job (its id is the job id; `quick: false`). 404 unknown scenario or blend scenario; 422 bad parameters; 501 a method without an implementation (`spider`) |
| `POST solver-runs` | 201 `SolverRun`, `queued` (or `done` and `cached` when an identical finished run exists); the job is sent to `solver.<problem>` with `{tenantId, userId, runId, save}`; `save` is the request's flag, false when absent (JOB-03 saves a result as a scenario only for `save !== false`), and a `save: true` request skips the result cache |
| `GET solver-runs/lookup?scenarioId&problem[&params]` | 200 `SolverLookup {run, current, trials}` (API-13): the newest finished run for `(scenario, problem, params)` from `findLatestRun`, a read that never enqueues, runs, saves or writes a row (so no queued or cancelled `solver_run` comes of looking). `current`: computed from the scenario's present inputs (its `scenarioVersion` is then the scenario's present version, as for a cache hit); false: the latest older result, as stored, or `run: null`. `trials`: `params.iterations` or `MONTE_CARLO_DEFAULTS.iterations` for `monte_carlo`, else null. Any member may call it (GET). 404 unknown scenario; 422 bad query |
| `GET solver-runs/:id` | `SolverRun`: status, progress, note, cancel flag, and `result` once `done` (or partial when `cancelled`), `error` when `failed`; 404 |
| `DELETE solver-runs/:id` | Sets `cancel_requested` on a queued or running run and answers it; a finished (or already cancelling) run is answered unchanged, 200; 404 |

## Quick runs

- The model is the session's: `deps.loader` is the `dbScenarioLoader` the WebSocket hub uses (same `ModelCache`), so a quick run starts from the compiled model and the committed evaluation of the scenario, no recompile. Tenant data the solvers are handed (`SolverModel`): the C and D presets' resolved inputs as `stretch` (breakeven, per `solvers.json` "stretch cap default = max(C, D)"), the resolved inputs of a blend's two scenarios, the named shocks of `solvers.json` `stress_presets.examples` (from `SPEC_DIR`, else `docs/spec`).
- Decision bounds (SOL-12): every quick-run model gets `withDecisionBounds(model, decisionBoundsFor(bundle.specVersion))`, the decision set and bounds of `docs/spec/reference/solvers_demo.py` generated into `@glidepath/spec`, exactly as the worker's jobs build theirs, so a quick breakeven and a job that a quick run falls back to bound the same inputs alike.
- Limit: `QUICK_LIMIT_MS` = 2000 (03 section 2). An `AbortSignal` fires at the limit and the solver stops at its next batch; a run that finishes after the limit (a synchronous stretch cannot be interrupted) counts as over it too. Over the limit the same spec is submitted as a job through the JOB-02 submitter (cache first). A cache hit answers 200 with the finished run (`cached: true`) instead of 202, since the answer is there.
- A finished quick run is stored (`solver_run`, `done`, the contract result in `result`) with its cache key, so GET answers it and an identical job later is a cache hit.
- `save: true` (quick): when the status is `optimal` or `feasible` and the result has moves, a `solver` scenario below the start point is created with `createScenario` and the moves go in through `applyChangeset` with origin `solver`; `resultScenarioId` names it. Breakeven (alternatives, no moves) saves nothing. For worker jobs the worker saves, when the job data says `save: true` (API-13).

## Contract readings

- `solver_run` has no columns for `quick`, `save`, `scenarioVersion` or `inputHash`: the route stores `spec.run = {quick, save, scenarioVersion}` beside the spec (as JOB-02 keeps `spec.cache`); `inputHash` is `spec.cache.inputHash`. Runs without them read back as `quick: false`, `save: false`, version 0, hash null. `createdBy` is always null (no author column).
- Problem id to `solver_run.kind` (`kinds.ts`): goal_seek, breakeven, scenario_blend to `blend`, min_risk_mix and vp_feasible to `optimize`, pareto, monte_carlo, sensitivity; `stress_presets` has no kind of its own and is stored as `sensitivity`. Only `spec.problem` decides what runs.
- Cells: the contract names `res.net[]`, the solvers `res.net`. `toEngineSpec` maps the request in, `toContractResult` maps the result out (moves `{target, cell, value}` to `{target, key, member, value}`, ranked rows, detail rows, stress outputs, Monte Carlo cells; non-finite metrics dropped), and keys a metric whose name is a spec node id by its wire cell key: `wireMetricKey`, the one place that decides it (API-13; `res.net` becomes `res.net[]`, `risk_exposure` and `res.net.p50` stay as the solver named them). The mapping is idempotent, so a result a worker stored in either form is served in the wire form.
- The 202 body is the job's `SolverRun`; `assertContract('solverRunQuick', res, 202)` cannot check it (202 is neither the route's 200 nor an error), tests parse it with `SolverRun`.
- A viewer or advisor cannot call `POST .../quick` (the role guard denies every state-changing method; a quick run stores a `solver_run` row).
- Job failures: `QueueUnavailableError` (pg-boss schema missing, queue unreachable) is a 503 problem; the submitter marks the run `failed` first.

## Files

`routes.ts` (handlers), `model.ts` (SolverModel and the solvers.json shocks), `params.ts`, `result.ts`, `run.ts` (row to `SolverRun`, the `spec.run` extras), `kinds.ts`.

## Tests

`solver.pg.test.ts` on the AA test database as `glidepath_app` (RLS applies), one test per acceptance line plus failure paths; `solver.test.ts` for the mappings and config. Composition tests: `src/compose/` (`queue.pg.test.ts` on real pg-boss, `start.pg.test.ts` through `startServer`).
