# 03 · Engine and solvers (tier 2)

The engine and solvers live only in tier 2 (`tier2-logic/engine`, `tier2-logic/solvers`). Tier 1 never evaluates a formula.

The engine is the heart of the app. It turns `formula_graph.json` + `variables.json` + a tenant's resolved inputs into ~3,400 cell values. It must give the same answer as `model-spec/reference/engine.py` (245/245 parity, `golden_results.json` to 1e-6 relative) and run fast enough for a 60 fps slider.

## 1. Package `tier2-logic/engine`

### Public interface

```ts
export interface ModelBundle {            // one model_version
  variables: VariableDef[];               // from variables.json
  nodes: NodeDef[];                       // from formula_graph.json
  dimensions: DimensionDef[];
}
export interface TenantData {             // from v_inputs_resolved + dimension members
  members: Record<DimId, Member[]>;       // with attributes (line.pool, line.domain, …)
  values: Map<CellKey, number>;           // resolved inputs, CellKey = `${var}[${memberKey}]`
  overrides: Map<CellKey, number>;        // node_override pins
}
export function compile(bundle: ModelBundle, members: TenantData['members']): CompiledModel;

export interface CompiledModel {
  evaluate(values, overrides?): Evaluation;              // full, < 50 ms
  rerun(prev: Evaluation, changes: Change[]): Evaluation; // incremental, < 10 ms
  evaluateBatch(base: Evaluation, vectors: BatchInput): BatchResult; // N vectors, SoA
  upstream(cell: CellKey, depth?: number): CellKey[];     // "what feeds this number"
  downstream(cell: CellKey): CellKey[];                   // "what this input moves"
  explain(cell: CellKey): Explanation;                    // expression, inputs, values, words
  inputHash(values, overrides): string;                   // SHA-256 of sorted cells + model version
}
```

### Compilation pipeline

1. **Parse** each expression once (Pratt parser, port of `Parser` in `engine.py`). AST nodes: number, ref, call, binary, unary, aggregate (`SUM/COUNT/MAXOVER/MINOVER … where`), cases.
2. **Expand** each node over the cartesian product of its dims (or its `members` subset); select the first matching case per cell; resolve implicit indexing and bound variables; resolve static `where` filters against member attributes. Output: a list of cells, each with a resolved AST whose refs are cell indices.
3. **Topologically sort** the cells; cycles are a load-time error.
4. **Lower** to a flat program: each cell gets a slot in one `Float64Array`; each instruction reads slots and writes one slot. Aggregates become index lists. `IF` keeps laziness in scalar mode.
5. **Index dependencies**: forward and reverse adjacency arrays (CSR) for `rerun`, `upstream`, `downstream`.

### Modes

| Mode | Use | Implementation |
|---|---|---|
| Full | Load, scenario switch | Run the whole program |
| Incremental | Slider drag, single edit | Mark changed input slots dirty, walk reverse adjacency in topological order, re-run only dirty cells; early stop when a recomputed value is unchanged (bitwise) |
| Batch | Monte Carlo, finite-difference gradients, Sobol, Pareto sampling | Structure-of-arrays: one `Float64Array(N)` per slot touched by the varying inputs; `IF` becomes elementwise select; only the downstream closure of the varied inputs is computed |
| Explain | Trace drawer, ⌘K, "what feeds this" | Uses the AST + current values to render formula in words (labels from the spec) and top drivers by local sensitivity |

### Determinism and parity

- IEEE float64 everywhere; same evaluation order as the Python reference where order matters (sums in member order).
- CI job `parity:golden` loads the AA seed, evaluates the five presets and compares with `golden_results.json` (1e-6 relative, 1e-9 absolute near zero).
- CI job `parity:fuzz` (tools/parity) draws 200 random input vectors within registry bounds, runs both engines and compares every output node. This catches porting bugs the presets do not exercise.
- Tier 2 stores `calc_run` by `inputHash`, so a repeated view or solver run on unchanged inputs is free.

## 2. Where the engine runs: what-if sessions in tier 2

```
Browser (tier 1) ──WS /ws/session──▶ logic (tier 2): SessionManager
                                          ├─ Session(user, tenant, scenario): CompiledModel ref + current Evaluation + pending previews
                                          └─ ModelCache: CompiledModel per (tenant, model_version, members_hash)
worker (tier 2): CompiledModel + long solvers + batch mode
```

- **Session.** Opened when a user opens a scenario. Holds the current `Evaluation` and the set of cells the open screen subscribes to. Closed after 15 minutes idle (configurable input `sys.session_idle_min`); state is rebuilt from tier 3 on reconnect, so sessions are a cache, never the source of truth.
- **Preview.** `preview {var, member, value, seq}` → coalesce (latest `seq` per cell wins) → `rerun()` on a scratch copy → send `delta {seq, cells}` for subscribed cells whose value changed. Nothing is written to tier 3. Releasing or cancelling a drag drops the scratch copy.
- **Commit.** REST `POST /changesets` → domain applies and persists → session adopts the committed values → `delta` pushed to every session open on that scenario (other users see the change).
- **Short solvers** (goal seek, breakeven, blend, tornado, stress) run inside the `logic` process on the session's model with a time limit of 2 s; anything longer is a `worker` job.
- **Scale.** One `logic` container handles ~200 concurrent sessions (AA compiled model ~5 MB). For more, run several `logic` replicas behind Caddy with sticky routing by session id; any replica can rebuild a session from tier 3.

## 3. Package `tier2-logic/solvers`

All solvers are pure functions over a `CompiledModel`, honour `kind`: only `decision` variables move, `estimate` variables are held fixed, and every solver returns a `SolverResult` that the API can save as a scenario.

```ts
interface SolverResult {
  problem: ProblemId; status: 'optimal'|'feasible'|'infeasible'|'unreachable'|'cancelled';
  changes: Change[];                 // the moves, to become a changeset on a new scenario
  ranked: { cell: CellKey; from: number; to: number; impact: number }[];
  binding?: { constraint: string; shadowPrice: number }[];
  metrics: Record<string, number>;   // net, risk, one-time, P(clear) …
  diagnostics: { iterations: number; ms: number; seed?: number };
}
```

| Problem (solvers.json) | Method | Runs | Target |
|---|---|---|---|
| `goal_seek` | 11-point monotonicity scan, then Brent; "not reachable" with closest value | logic | < 1 s |
| `breakeven` | goal seek per lever-intensity input | logic | < 2 s |
| `scenario_blend` | 1-D blend C→D on decision inputs, goal seek on α | logic | < 1 s |
| `min_risk_mix` | Continuous relaxation by projected gradient on the vectorised engine (finite differences), multi-start; binary lever switches by greedy + local swap; total and per-VP bars as penalty → exact feasibility check | worker job | < 10 s |
| `pareto` | ε-constraint sweep on savings, min-risk at each ε | worker job | < 30 s |
| `vp_feasible` | min-risk with all VP bars as constraints | worker job | < 10 s |
| `monte_carlo` | Batch mode, 2,000 draws (delivery Bernoulli/Beta by confidence, timing slips, estimate ranges), seeded; returns P(clear), P10/P50/P90, histogram | worker job | < 10 s |
| `sensitivity` | Tornado: ±range one at a time in batch mode; Sobol (Saltelli) as job | Tornado logic, Sobol worker | < 2 s / < 60 s |
| `stress_presets` | Apply named corporate-driver shocks, evaluate | logic | < 1 s |

Acceptance: `reference/solver_demo_results.json` (min-risk reaches $143.0M, risk $42.0M, people levers unchanged; all-VP bars $148.1M; Monte Carlo P(clear) C 0%, D 4.5% within ±1.5 pp for seeded runs).

All solvers take an `AbortSignal` and a `progress(fraction, note)` callback, so the same code serves the `logic` process and the `worker`.

## 4. Job runtime

- Table `solver_run` (spec) holds problem, inputs, status, progress, result, `scenario_id` of the start point and of the result.
- `tier2-logic/worker` consumes `solver.*` queues with pg-boss; concurrency 2 per vCPU; each job writes progress at most every 250 ms; job updates are pushed to tier 1 over the same WebSocket (`job` messages).
- Results are cached per `(problem, params, inputHash)`: re-running an unchanged scenario returns instantly (helps rehearsals and the demo).
- Cancel = set `cancel_requested`, the job's `AbortSignal` fires at the next batch.

## 5. Performance budget and how to hold it

| Item | Budget | Guard |
|---|---|---|
| Compile AA | < 150 ms | Vitest bench, CI fails at +30% |
| Full eval | < 50 ms (target 10 ms) | bench |
| Incremental (one lever slider) | < 10 ms (target 2 ms) | bench |
| Batch 2,000 | < 10 s in `worker` (2 vCPU) | bench |
| Preview round trip | p95 < 25 ms local Docker | WS bench in e2e; deltas carry changed subscribed cells only |

If a budget fails, the escape hatch is to move the lowered program to WASM (AssemblyScript or Rust) behind the same `CompiledModel` interface. Not expected to be needed: 3,400 cells is small.
