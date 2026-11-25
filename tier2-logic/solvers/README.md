# @glidepath/solvers

Goal seek to Monte Carlo and Sobol: pure functions over a `CompiledModel` (docs/architecture/03_engine_and_solvers.md §3). No IO. Depends on `engine` and `spec` only.

## Status

SOL-01 framework (this package's skeleton for every problem):

- `src/types.ts`: `SolverResult<P>`, `Change` (the engine's variable change), `RankedMove`, `SolverSpec` and `SolverParamsMap` (params of every `solvers.json` problem), `SolverDetailMap`. Shapes mirror `contract/api-contract` `solvers.ts`; ids are plain strings and cells are engine `CellKey`s (`res.net`, `lev.start[L03]`), which the server maps to the contract's `res.net[]` form.
- `src/decision-sets.ts`: `decisionSet(model, set)` / `decisionSets(model, sets)` for `lever_intensity`, `lever_timing`, `lever_switch`, `funding`. Estimates and simulation inputs are never in a set. `lever_intensity` bounds are `[registry min, min(registry max, max over model.stretch)]`; `model.caps` widens an upper bound.
- `src/run.ts`: `runSolver(model, { problem, params }, { signal, progress })`. Problems check the signal at each batch (`run.batch()` / `run.evaluateBatch()`); a fired signal ends the run at the next batch with status `cancelled` and the last `run.partial(...)` result. `progress(fraction, note)` is throttled to one call per 250 ms. Results that move a cell their problem may not move (an estimate, for an optimiser) reject with `ILLEGAL_MOVE`.
- `src/ranked.ts`: `rankMoves(model, changes, output, { mode: 'alone' | 'path', order })`, one batch evaluation pricing every move (also `run.rank`).
- `src/problems/index.ts`: one entry per problem; each rejects with `NOT_IMPLEMENTED` naming its item (SOL-02 … SOL-09) until that item replaces it.

SOL-02 goal seek and breakeven (`goalSeek()`, `breakeven()` in `src/goal-seek.ts`; problems in `src/problems/goal-seek.ts`):

- `src/problems/seek.ts`: the 1-D search as a generator (yields points, receives outputs): an 11-point scan in one request, then Brent on the bracketing scan interval. A non-monotone scan (or a point that does not evaluate) or a target outside the scanned outputs ends `unreachable` with the closest scan value. `seekScalar(f, lo, hi, target)` runs it on a plain function.
- `goal_seek`: bounds default to the variable's registry min/max; status `optimal` (solved) or `unreachable`; `changes` sets the input to the solution (or the closest value); `detail` `{ value, output, reachable }`.
- `breakeven`: one row per `lever_intensity` input (or per given input) on `res.gap = 0` by default. All searches run in lockstep, one engine batch per round. A row searches the decision bounds (`feasible`), then the registry range (`needed`, not feasible); `needed` is null when neither holds it. `min`/`max` are the feasibility range. `changes` is empty (the rows are alternatives, not one plan); status `optimal` when any row is feasible, else `unreachable`.
- `pnpm --filter ./tier2-logic/solvers bench` reports goal seek and breakeven timings; the budgets (< 1 s, < 2 s) are asserted in `goal-seek.spec.ts`.
SOL-06 Monte Carlo (`src/problems/monte-carlo/`, problem `monte_carlo`):

- `drawMonteCarlo(model, params, seed)`: seeded draws by inverse transform. Defaults (04 §4, `defaults.ts`, checked against the spec text): `lev.realize` = 1.2·Beta(K·c/1.2, K·(1 − c/1.2)), K = 4, c = `lev.conf`; `lev.start` + U{0,1,2} (capped at the registry max); `pool.growth` Triangular(0.7g, g, 1.4g). Overrides: `params.dist` by cell, then by variable, then `variable_def.dist` (triangular, PERT, normal, lognormal, uniform, discrete; basis absolute / relative / shift; `null` holds an input). One-factor Gaussian copula on `lev.realize` per lever family (default L01–L08 and L09–L17 at ρ = 0.5; `params.correlation` replaces them). Each cell has its own xoshiro128** stream keyed by seed and cell, so draws are reproducible bit for bit.
- `monteCarlo` runs the draws through `evaluateBatch` in batches of `batchSize` lanes (cancel lands between batches; partial result = the draws so far) and returns P10/P50/P90 and histograms (`res.net`, `res.bar`, `res.gap`, `br.eps27`, `val.px[fy27it]`), P(net ≥ bar), P(net ≥ target), P(clear) per VP, Spearman contribution per lever and the seed (`diagnostics.seed`, `detail.seed`). Lanes the engine fails are left out and counted (`metrics.failed`).
- Bench (G8): `pnpm --filter ./tier2-logic/solvers bench` (`solvers.mc.2000` < 10 s; the engine's guard in check mode against `bench/baseline.json`).

SOL-03 scenario blend (`blend()` in `src/blend.ts`; problem in `src/problems/blend.ts`):

- `blend(model, A, B, target = 0, { output = 'res.gap', ...runOptions })`: A and B are scenario ids of `model.scenarios` (resolved inputs the caller supplies) or resolved input maps. `x = A + λ (B − A)` over every cell of a `scenario_varies` variable, member by member; other inputs keep the start point's value.
- λ is searched on [0, 1] with the SOL-02 seek (11-point scan in one batch, then Brent). Status `optimal` with `detail.lambda`, or `unreachable` with `detail.lambda` null and the closest scan λ in `metrics.lambda` and `changes`.
- `metrics`: the output, target, residual, λ, `res.net`, `res.bar`, `res.risk`, `res.tot_ot_it`, `br.eps27`, `vp.gap[<vp>]`. Budget < 1 s asserted in `blend.spec.ts`.

SOL-04 minimum-risk lever mix (`minRiskMix()` in `src/min-risk.ts`; problem in `src/problems/min-risk.ts`):

- `explainable` (default): greedy marginal analysis as `optimise` in `docs/spec/reference/solvers_demo.py`. Each round prices every one-step move in one engine batch and takes the best `constraint gain / max(Δobjective, COST_FLOOR)`; a tie keeps the first move in decision order. Lever-intensity inputs step up only (toward the stretch cap); other sets step either way. Values accumulate `x ± step` like the reference, which keeps the plan (moved set, end values, first-move order) equal to the reference's; inside a group of levers whose scores tie up to rounding, single steps may interleave differently. Result values are rounded back onto the step grid.
- Objectives (`solvers.json` `objective_options`): `min_risk_exposure` (Σ `lev.iy`·(1 − `lev.conf`), default), `max_risk_adjusted_net`, `min_one_time`, `min_people_impact` (`(hc.us − res.fte_us) + w·(lv.on0 − res.fte_on)`, `w` = `params.peopleWeight`, default 1), `min_change`.
- Constraints: `total` (`res.net ≥ res.bar`) always; optional `per_vp`, `one_time_cap`, `rate_share`, `us_floor`, `gcc_hiring`, `eps` add their violation. `binding` lists held constraints the last improving step was needed for, shadow price = Δobjective per unit of slack on that step.
- `production`: the explainable plan, then a seeded refinement stepping moved inputs back toward the start while feasible and the objective falls; `diagnostics.seed` records the seed.
- `ranked`: one row per moved input in the order the optimiser first moved it, impacts on `res.net` along that path. `metrics`: `res.net`, `res.bar`, `res.risk`, `res.tot_ot_it`, … plus `risk_exposure`, `objective`, `violation`, `steps`, `evaluations`.
- `test/fixtures/min_risk_path.json` is the reference greedy path, dumped by `python3 -I tier2-logic/solvers/test/fixtures/dump_min_risk.py .`. The reference bounds intensity inputs by max(C, D) alone, above the registry max for `lev.L01.cut`, `lev.L01.rel`, `lev.L03.pct` and `lev.L15.pct`; the spec widens those to the reference bounds through `model.caps` (SOL-12: `withDecisionBounds`, below; with SOL-01's default bounds the mix still clears the bar from C: risk exposure 42.54, one-time IT 20.34, no people levers, but `lev.L08.cut` replaces `lev.L12.tpm`).

SOL-05 constraints, VP-feasible plan, binding constraints (`vpFeasible()` in `src/vp-feasible.ts`; problem in `src/problems/vp-feasible.ts`; search shared with SOL-04 via `solveMix`):

- `minRiskMix(model, { constraints })`: `total` and `per_vp` violations are summed as in the reference (the demo paths are unchanged). The optional `one_time_cap`, `rate_share`, `us_floor`, `gcc_hiring`, `eps` are guards: no step may worsen their violation. Lever intensities only step up, so a cap crossed for a gain on the bar could never be undone; with a summed violation, `one_time_cap` at C's value from C ended infeasible.
- Binding constraints and shadow prices (feasible plans): a held constraint is active when its slack is within δ, the largest slack change one step from the plan makes (forward, or back toward the start). It is relaxed by δ (then 2δ, 4δ) and re-solved with the same method; binding when the relaxed objective is lower, shadow price = objective saved / δ (objective units per unit of the constraint). The re-solve is warm and exact: it restarts at the first greedy round where the constraint was within δ of holding at the current point or any priced candidate (until then every score is unchanged). The prices are local: a greedy is not monotone in its constraints.
- `vpFeasible(model, params)` (`vp_feasible`): `min_risk_mix` with `per_vp` added (all VPs unless the caller's `per_vp` names some). Feasible: that plan, binding and shadow prices. Infeasible: leximin ascent on `vp.coverage[v]` capped at 1 (lowest first), guards held, ties to the cheaper objective; run from the start and from the mix's end, the better kept. Status `infeasible`, `binding: []`. `detail.coverage` per VP and `metrics.min_coverage` in both cases.
- From C with widened caps (as SOL-04): net 148.13, every VP clears, risk exposure 43.63, Operations binding by $0.01M; moved inputs equal `min_risk_total_and_vp_bars.inputs_moved_from_C` in 95 steps.

SOL-12 production decision bounds (`withDecisionBounds()` in `src/decision-sets.ts`):

- `withDecisionBounds(model, bounds)` sets `model.caps` to the `hi` of `bounds` for every `lever_intensity` cell they name, so the set's bounds are the reference's (`lo` is the registry min on both sides); cells they do not name keep SOL-01's default, a cap already on the model wins, `null` returns the model unchanged.
- `bounds` is `@glidepath/spec` `decisionBoundsFor(bundle.specVersion)`: the DEC/lo/hi/step/NEG of `docs/spec/reference/solvers_demo.py`, generated into `tier2-logic/spec/src/reference/decision-bounds.ts` (checked against the reference by `tier2-logic/spec/src/decision-bounds.test.ts`). The worker's solver jobs, the server's quick runs, the JOB-04 warmer (through the worker's handlers), this package's tests and `pnpm test:solvers` all read that one module.

```ts
import { runSolver, type SolverModel } from '@glidepath/solvers';

const model: SolverModel = { compiled, base: compiled.evaluate(values, overrides), bundle, members, stretch: [presetC, presetD] };
const result = await runSolver(model, { problem: 'min_risk_mix', params: {} }, { signal, progress });
```

## Tests

`pnpm turbo run typecheck lint test --filter=@glidepath/solvers... --concurrency=1` (G1, G2 with >= 90% line coverage). The DEC/lo/hi of `docs/spec/reference/solvers_demo.py` the tests compare with is `@glidepath/spec` `REFERENCE_DECISION_BOUNDS` (SOL-12), the same data production loads.
