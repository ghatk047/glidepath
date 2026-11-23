# ENG · Engine

The TypeScript port of `docs/spec/reference/engine.py`. All items opus/xhigh by product-owner decision. **ENG-06 is the hard gate**: no DOM/SOL/API item that consumes engine numbers starts before it is merged green (ADR-020).

11 items. Fields and status values: see [README](README.md). Rubric: `docs/architecture/10_backlog_conventions.md` §2.

| id | title | ms | model/effort | size | depends on |
|---|---|---|---|---|---|
| ENG-01 | Engine port map (PORTING.md) and package skeleton | M0 | opus/xhigh | S | SPEC-02 |
| ENG-02 | Tokenizer and Pratt parser | M0 | opus/xhigh | S | ENG-01 |
| ENG-03 | Expander: cells, cases, implicit indexing, where-filters, deps | M1 | opus/xhigh | M | ENG-02, SPEC-03 |
| ENG-04 | Topological sort, lowering to a flat program, CSR adjacency | M1 | opus/xhigh | M | ENG-03 |
| ENG-05 | Full evaluation with overrides and inputHash | M1 | opus/xhigh | M | ENG-04 |
| ENG-06 | PARITY GATE: golden 760/760 and parity replay 245/245 | M1 | opus/xhigh | M | ENG-05 |
| ENG-07 | Incremental rerun with dirty propagation | M1 | opus/xhigh | M | ENG-06 |
| ENG-08 | Batch mode (structure of arrays) | M1 | opus/xhigh | M | ENG-06 |
| ENG-09 | Explain and upstream/downstream queries | M1 | opus/xhigh | M | ENG-06 |
| ENG-10 | Fuzz parity against the Python reference | M1 | opus/xhigh | M | ENG-07 |
| ENG-11 | Engine benches and budget guard | M1 | opus/xhigh | S | ENG-07, ENG-08 |

## ENG-01 · Engine port map (PORTING.md) and package skeleton

```yaml
id: ENG-01
title: "Engine port map (PORTING.md) and package skeleton"
epic: ENG
milestone: M0
priority: must
status: done
stream: A
model: opus
effort: xhigh
depends_on: [SPEC-02]
tier: 2
package: "tier2-logic/engine"
contract: "CompiledModel / ModelBundle / TenantData interfaces of 03 §1"
inputs:
  - "docs/architecture/03_engine_and_solvers.md#1. Package `tier2-logic/engine`"
  - "docs/architecture/prompts/00_architecture_planning.md#Your tasks (task 4)"
  - "docs/spec/reference/engine.py (whole file, 344 lines)"
  - "docs/spec/03_formula_graph.md#2. Expression language"
  - "docs/spec/03_formula_graph.md#5. Contract for the app's calc engine"
acceptance:
  - "PORTING.md maps every def/class in engine.py (tokenize, Parser.*, parse, Model.key/combos/pick_expr/_idx/resolve/where_ok/deps/ev/_expand/input_cells/run/rerun) to a TS module + function (test: porting-map.spec.ts lists engine.py defs and asserts each appears)"
  - "PORTING.md lists the semantics that are easy to get wrong, each with the planned test name: implicit indexing (innermost bound var per dim), lazy IF, SAFEDIV alt default 0, '/' by zero raises, static where-filters, member order of sums, MAXOVER/MINOVER of empty = 0, first matching case, member subsets, symbol ids win over attribute access, '^' right-assoc, unary minus bp 40, comparisons return 1/0, string literal indices, node override replaces a cell"
  - "src/index.ts exports the 03 §1 interfaces with stubs that throw 'not implemented'; typecheck green (test)"
  - "parity harness design section: tolerance 1e-6 rel / 1e-9 abs, 760 golden values, 245 parity replays, 200-vector fuzz (test: headings present)"
gates: [G1, G2]
size: S
notes: "Engine work order: ENG-02 → 03 → 04 → 05 → 06 (gate)."
merged_at: "2026-11-23"
```

The engine port plan from prompt 00, as the first engine item.

## ENG-02 · Tokenizer and Pratt parser

```yaml
id: ENG-02
title: "Tokenizer and Pratt parser"
epic: ENG
milestone: M0
priority: must
status: done
stream: A
model: opus
effort: xhigh
depends_on: [ENG-01]
tier: 2
package: "tier2-logic/engine"
contract: "parse(expr): Ast"
inputs:
  - "docs/spec/reference/engine.py (TOK, tokenize, Parser, parse)"
  - "docs/spec/03_formula_graph.md#2. Expression language"
  - "tier2-logic/engine/PORTING.md"
acceptance:
  - "tokenizer matches engine.py TOK: numbers with exponent and leading dot, single-quoted strings, dotted identifiers, operators == != <= >= + - * / ^ ( ) [ ] , < > (test: tokenizer.spec.ts table)"
  - "binding powers identical: comparisons 10, + - 20, * / 30, unary 40, ^ 50 right-assoc (test: precedence.spec.ts)"
  - "AST kinds num, str, neg, bin, call, agg(fn, var, dim, where, body), ref(name, idx) (test)"
  - "every expr and case expr in formula_graph.json parses and its AST equals the Python AST dumped by test/fixtures/dump_ast.py (test: ast-parity.spec.ts, all 307 nodes)"
  - "syntax errors carry position and source text (test)"
gates: [G1, G2]
size: S
notes: ""
merged_at: "2026-11-23"
```

Line-by-line port of the ~100-line reference parser.

## ENG-03 · Expander: cells, cases, implicit indexing, where-filters, deps

```yaml
id: ENG-03
title: "Expander: cells, cases, implicit indexing, where-filters, deps"
epic: ENG
milestone: M1
priority: must
status: done
stream: A
model: opus
effort: xhigh
depends_on: [ENG-02, SPEC-03]
tier: 2
package: "tier2-logic/engine"
contract: "expand(bundle, members): Cell[]"
inputs:
  - "docs/spec/reference/engine.py (Model.key, combos, pick_expr, _idx, resolve, where_ok, deps, _expand)"
  - "docs/spec/03_formula_graph.md#2. Expression language (Engine rules 1)"
  - "tier2-logic/engine/PORTING.md"
acceptance:
  - "each node expands over the cartesian product of its dims in member order, or its `members` subset; keys `id[m1,m2]` as Model.key; cell count equals the Python count from fixture (test)"
  - "first matching case per cell (test: per-lever cases fixture)"
  - "implicit index by innermost bound variable per dim; explicit index by bound var, attribute (l.domain) or string literal; symbol ids win over attribute access (one test per rule)"
  - "where-filters resolved statically against member attributes; a cell reference inside where is a load-time error (test)"
  - "per-cell dependency sets equal Python cdeps for every cell (test: deps-parity.spec.ts with fixture from test/fixtures/dump_deps.py)"
gates: [G1, G2]
size: M
notes: ""
merged_at: "2026-11-23"
```

The part of the port with the subtle semantics; parity at dependency level before any numbers.

## ENG-04 · Topological sort, lowering to a flat program, CSR adjacency

```yaml
id: ENG-04
title: "Topological sort, lowering to a flat program, CSR adjacency"
epic: ENG
milestone: M1
priority: must
status: done
stream: A
model: opus
effort: xhigh
depends_on: [ENG-03]
tier: 2
package: "tier2-logic/engine"
contract: "compile(bundle, members): CompiledModel (structure)"
inputs:
  - "docs/architecture/03_engine_and_solvers.md#Compilation pipeline"
  - "docs/spec/reference/engine.py (Model._expand topo order)"
  - "tier2-logic/engine/PORTING.md"
acceptance:
  - "Kahn toposort; a cycle is a load-time error naming up to 10 cells (test: cyclic fixture)"
  - "one Float64Array slot per cell and input; each instruction reads slots and writes one; aggregates as index lists in member order; IF stays lazy in scalar mode (test: instruction dump for 5 sample nodes)"
  - "forward and reverse CSR adjacency; raw upstream/downstream correct on a 10-node fixture (test)"
  - "compile(AA) < 150 ms (bench engine.compile)"
gates: [G1, G2, G8]
size: M
notes: ""
merged_at: "2026-11-23"
```

Turns the expanded graph into the fast program all modes share.

## ENG-05 · Full evaluation with overrides and inputHash

```yaml
id: ENG-05
title: "Full evaluation with overrides and inputHash"
epic: ENG
milestone: M1
priority: must
status: done
stream: A
model: opus
effort: xhigh
depends_on: [ENG-04]
tier: 2
package: "tier2-logic/engine"
contract: "CompiledModel.evaluate(values, overrides?), inputHash()"
inputs:
  - "docs/spec/reference/engine.py (Model.ev, Model.run)"
  - "docs/spec/03_formula_graph.md#2. Expression language (Engine rules 3)"
  - "tier2-logic/engine/PORTING.md"
  - "docs/spec/01_data_model.md#5. Concurrency, history and caching"
acceptance:
  - "evaluate runs the program in topological order; an override replaces the cell's value (test)"
  - "'/' by zero throws with the cell key; SAFEDIV returns alt (default 0); comparisons 1/0; MIN, MAX, ABS, AND, OR, NOT; SUM/COUNT as float; MAXOVER/MINOVER of empty set = 0 (one test per function)"
  - "missing input cell → error naming the cell being computed (test)"
  - "smoke: C preset res.net, res.gap, res.risk, br.eps27 within 1e-6 relative of golden_results.json (test; full gate is ENG-06)"
  - "inputHash(values, overrides) = SHA-256 of sorted cells + model version; order-independent; a one-ulp change changes it (test)"
  - "full eval < 50 ms on AA (bench engine.evaluate)"
gates: [G1, G2, G8]
size: M
notes: ""
merged_at: "2026-11-23"
```

Scalar evaluation, the basis of parity, plus the input hash used for calc_run caching.

## ENG-06 · PARITY GATE: golden 760/760 and parity replay 245/245

```yaml
id: ENG-06
title: "PARITY GATE: golden 760/760 and parity replay 245/245"
epic: ENG
milestone: M1
priority: must
status: done
stream: A
model: opus
effort: xhigh
depends_on: [ENG-05]
tier: 2
package: "tools/parity"
contract: "`pnpm parity:golden` (G3)"
inputs:
  - "docs/spec/reference/golden_results.json"
  - "docs/spec/reference/parity_report.json (checks, parity_overrides)"
  - "docs/spec/reference/run_tests.py (PARITY values, check-name → node mapping)"
  - "docs/architecture/03_engine_and_solvers.md#Determinism and parity"
  - "docs/architecture/08_quality_and_testing.md#1. Gates (G3)"
acceptance:
  - "`pnpm parity:golden` evaluates the five presets (rates, A, B, C, D) from docs/spec/seed/aa and matches all 760 values in golden_results.json (scalars, levers.*, vp.*) within 1e-6 relative / 1e-9 absolute: 760/760 (G3)"
  - "replays the 245 checks of parity_report.json using the replay table in tier2-logic/engine/PORTING.md §6 (212 with parity_overrides + {corp.it_swb_mode: 0}, 18 chargeback-off without overrides, 15 invariants on plain presets) and matches each check's `engine` value within 1e-6 absolute after Python-style round(x, 6): 245/245 (test: parity-replay.spec.ts)"
  - "writes tools/parity/out/golden-report.json with per-value diffs; non-zero exit on any miss (test)"
  - "CI job parity-golden enabled and required for PRs touching docs/spec, tier2-logic/engine, tier3-data/seed (FND-04 job flipped on)"
gates: [G1, G2, G3]
size: M
notes: "HARD GATE (ADR-020): no DOM/SOL/API item that consumes engine numbers starts before this merges green."
merged_at: "2026-11-23"
```

The first hard gate after foundations. Everything numeric downstream trusts this.

## ENG-07 · Incremental rerun with dirty propagation

```yaml
id: ENG-07
title: "Incremental rerun with dirty propagation"
epic: ENG
milestone: M1
priority: must
status: done
stream: A
model: opus
effort: xhigh
depends_on: [ENG-06]
tier: 2
package: "tier2-logic/engine"
contract: "CompiledModel.rerun(prev, changes)"
inputs:
  - "docs/spec/reference/engine.py (Model.rerun)"
  - "docs/architecture/03_engine_and_solvers.md#Modes"
  - "docs/spec/03_formula_graph.md#2. Expression language (Engine rules 4)"
acceptance:
  - "rerun bitwise equals evaluate on 500 seeded random single-input changes and 100 multi-input changes (test: rerun-equivalence.spec.ts)"
  - "dirty walk over reverse CSR in topological order with early stop when a recomputed value is bitwise unchanged (test counts recomputed cells)"
  - "adding or removing an override marks it dirty (test)"
  - "one lever slider rerun < 10 ms on AA (bench engine.rerun.lever)"
gates: [G1, G2, G3, G8]
size: M
notes: "Early stop when value unchanged."
merged_at: "2026-11-23"
```

What makes the slider live.

## ENG-08 · Batch mode (structure of arrays)

```yaml
id: ENG-08
title: "Batch mode (structure of arrays)"
epic: ENG
milestone: M1
priority: must
status: done
stream: A
model: opus
effort: xhigh
depends_on: [ENG-06]
tier: 2
package: "tier2-logic/engine"
contract: "CompiledModel.evaluateBatch(base, vectors)"
inputs:
  - "docs/architecture/03_engine_and_solvers.md#Modes"
  - "docs/spec/solvers.json (engine_contract.vectorised)"
  - "docs/spec/04_solvers_simulation.md#6. Engine requirements these imply"
acceptance:
  - "evaluateBatch computes only the downstream closure of the varied inputs in Float64Array(N) per slot (test)"
  - "each lane equals scalar evaluate within 1e-12 relative for 200 seeded random vectors (test)"
  - "IF is an elementwise select; an error in a non-taken branch does not poison a lane, a taken-branch division by zero marks that lane failed (test)"
  - "2,000 vectors over all lever realisation inputs < 10 s single-threaded (bench engine.batch.2000)"
gates: [G1, G2, G8]
size: M
notes: ""
merged_at: "2026-11-23"
```

Monte Carlo, tornado and gradients run on this.

## ENG-09 · Explain and upstream/downstream queries

```yaml
id: ENG-09
title: "Explain and upstream/downstream queries"
epic: ENG
milestone: M1
priority: must
status: done
stream: A
model: opus
effort: xhigh
depends_on: [ENG-06]
tier: 2
package: "tier2-logic/engine"
contract: "CompiledModel.upstream/downstream/explain"
inputs:
  - "docs/architecture/03_engine_and_solvers.md#Public interface"
  - "docs/architecture/03_engine_and_solvers.md#Modes (Explain)"
  - "docs/spec/01_data_model.md#5. Concurrency, history and caching"
acceptance:
  - "upstream(cell, depth) and downstream(cell) equal the Python cdeps/users closure on 50 sampled cells (test)"
  - "explain(cell) returns expression, resolved inputs with values, formula in words from spec labels, and top drivers by local sensitivity via rerun (test on res.net and br.eps27)"
  - "dependency queries are read-only views over the CSR built in ENG-04 (no second graph) (test)"
gates: [G1, G2]
size: M
notes: "inputHash moved to ENG-05 so DOM-05 does not wait on explain work."
merged_at: "2026-11-23"
```

Feeds the trace drawer and ⌘K.

## ENG-10 · Fuzz parity against the Python reference

```yaml
id: ENG-10
title: "Fuzz parity against the Python reference"
epic: ENG
milestone: M1
priority: must
status: in_progress
stream: A
model: opus
effort: xhigh
depends_on: [ENG-07]
tier: 2
package: "tools/parity"
contract: "`pnpm parity:fuzz` (G4)"
inputs:
  - "docs/architecture/03_engine_and_solvers.md#Determinism and parity"
  - "docs/spec/reference/engine.py"
  - "docs/spec/variables.json (min, max, step)"
  - "docs/architecture/08_quality_and_testing.md#1. Gates (G4)"
acceptance:
  - "200 seeded random vectors within registry min/max (stepped for integers) run through python3 docs/spec/reference/engine.py (stdlib only) and the TS engine; every node cell within 1e-6 rel / 1e-9 abs (G4)"
  - "vectors that make the reference raise must raise in TS too, and vice versa (test)"
  - "runs in < 5 min; CI nightly and on engine PRs (test: job enabled)"
gates: [G1, G2, G4]
size: M
notes: ""
```

Catches porting bugs the five presets do not exercise.

## ENG-11 · Engine benches and budget guard

```yaml
id: ENG-11
title: "Engine benches and budget guard"
epic: ENG
milestone: M1
priority: must
status: todo
stream: A
model: opus
effort: xhigh
depends_on: [ENG-07, ENG-08]
tier: 2
package: "tier2-logic/engine"
contract: "`pnpm bench --filter=./tier2-logic/engine` (G8)"
inputs:
  - "docs/architecture/03_engine_and_solvers.md#5. Performance budget and how to hold it"
  - "docs/architecture/08_quality_and_testing.md#1. Gates (G8)"
acceptance:
  - "benches engine.compile, engine.evaluate, engine.rerun.lever, engine.batch.2000 with budgets 150 ms / 50 ms / 10 ms / 10 s (G8)"
  - "baseline JSON committed; CI fails at +30% vs baseline (test: guard script with a synthetic slow result)"
gates: [G1, G8]
size: S
notes: "Kept at opus/xhigh per the product-owner rule for engine items, though the work is small."
```

Holds the budgets from 03 §5 in CI.
