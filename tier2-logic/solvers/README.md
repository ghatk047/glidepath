# @glidepath/solvers

Goal seek to Monte Carlo and Sobol: pure functions over a `CompiledModel` (docs/architecture/03_engine_and_solvers.md §3). No IO. Depends on `engine` and `spec` only.

## Status

SOL-01 framework (this package's skeleton for every problem):

- `src/types.ts`: `SolverResult<P>`, `Change` (the engine's variable change), `RankedMove`, `SolverSpec` and `SolverParamsMap` (params of every `solvers.json` problem), `SolverDetailMap`. Shapes mirror `contract/api-contract` `solvers.ts`; ids are plain strings and cells are engine `CellKey`s (`res.net`, `lev.start[L03]`), which the server maps to the contract's `res.net[]` form.
- `src/decision-sets.ts`: `decisionSet(model, set)` / `decisionSets(model, sets)` for `lever_intensity`, `lever_timing`, `lever_switch`, `funding`. Estimates and simulation inputs are never in a set. `lever_intensity` bounds are `[registry min, min(registry max, max over model.stretch)]`; `model.caps` widens an upper bound.
- `src/run.ts`: `runSolver(model, { problem, params }, { signal, progress })`. Problems check the signal at each batch (`run.batch()` / `run.evaluateBatch()`); a fired signal ends the run at the next batch with status `cancelled` and the last `run.partial(...)` result. `progress(fraction, note)` is throttled to one call per 250 ms. Results that move a cell their problem may not move (an estimate, for an optimiser) reject with `ILLEGAL_MOVE`.
- `src/ranked.ts`: `rankMoves(model, changes, output, { mode: 'alone' | 'path', order })`, one batch evaluation pricing every move (also `run.rank`).
- `src/problems/index.ts`: one entry per problem; each rejects with `NOT_IMPLEMENTED` naming its item (SOL-02 … SOL-09) until that item replaces it.

```ts
import { runSolver, type SolverModel } from '@glidepath/solvers';

const model: SolverModel = { compiled, base: compiled.evaluate(values, overrides), bundle, members, stretch: [presetC, presetD] };
const result = await runSolver(model, { problem: 'min_risk_mix', params: {} }, { signal, progress });
```

## Tests

`pnpm turbo run typecheck lint test --filter=@glidepath/solvers... --concurrency=1` (G1, G2 with >= 90% line coverage). `test/fixtures/dec.json` is the DEC/lo/hi of `docs/spec/reference/solvers_demo.py`, dumped by `python3 -I tier2-logic/solvers/test/fixtures/dump_dec.py .`.
