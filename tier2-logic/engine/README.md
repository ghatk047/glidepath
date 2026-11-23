# @glidepath/engine

Parser, compiler, evaluator (full, incremental, batch), explain. Pure: no IO. TypeScript port of `docs/spec/reference/engine.py` (ADR-005); must match `docs/spec/reference/golden_results.json` (ADR-020).

**Start with [PORTING.md](PORTING.md)**: the map from every def/class of engine.py to a TS module and function, the semantics that are easy to get wrong (each with its planned test), the deliberate deviations, and the parity harness design. Its tables are checked by `src/porting-*.spec.ts`.

## Status

ENG-01 skeleton: `src/index.ts` exports the interfaces of `docs/architecture/03_engine_and_solvers.md` §1 (`compile`, `CompiledModel`, `TenantData`, `Evaluation`, `Change`, `BatchInput`, `BatchResult`, `Explanation`, `EngineError`) and re-exports `ModelBundle` and member types from `@glidepath/spec`. Work order: ENG-02 → 03 → 04 → 05 → 06 (parity gate).

- ENG-02 `src/parse`: `tokenize`, `Parser`, `parse(src, cache?)` → `Ast` (num, str, neg, bin, call, agg, ref); `toPyTuple` gives engine.py's tuple shape. Every spec expression's AST equals Python's (`test/fixtures/dump_ast.py` → `ast.json`). Syntax errors are `EngineError` SYNTAX with `pos` (offset into the expression as written) and `source`.
- ENG-03 `src/expand`: `expand(bundle, members)` → `Cell[]` in expansion order: chosen case per cell, resolved expression (bound variables and attributes folded to constants, refs as cell keys, `where` filtered at compile time, `COUNT` a constant) and deps. Per-cell deps equal Python `cdeps` for all 3,370 cells (`test/fixtures/dump_deps.py` → `deps.json`). `src/eval/pyops.ts` holds the Python float semantics (Neumaier `pySum`, `pyMin`/`pyMax`, `pyPow`, truthiness) shared by static where-filters and evaluation.
- ENG-04 `src/compile`: `compile(bundle, members)` → `EngineModel` (a `CompiledModel`): Kahn toposort equal to `Model.order` (cycle = CYCLE naming up to 10 cells), lowering to one flat program over a `Float64Array` of slots (node cells, inputs, constants, temps; `IF`/`SAFEDIV` lazy via jumps; aggregates as member-ordered slot lists; `disassemble` prints a cell's code), forward and reverse CSR adjacency with raw `upstream`/`downstream`. Methods still to come throw `NOT_IMPLEMENTED` naming their item (`PENDING_METHODS`).
- ENG-05 `src/eval`: `model.evaluate(values, overrides?)` runs the program in topological order (`runCells`, Python float semantics; errors name the cell being computed, with `pos`/`source`); overrides pin node cells without evaluating them, other override keys are ignored and listed in `diagnostics.ignoredOverrides`. `model.inputHash(values, overrides)` = SHA-256 of a model digest (bundle + members in order) and the cells sorted by key as float64 bit patterns. `resolveInputs(bundle, tenantValues, scenario?, extra?)` mirrors `Model.input_cells` (BAD_INPUT). Every cell of preset C equals Python bitwise, plain and with the parity overrides (`test/fixtures/dump_run_c.py` → `run_c.json`).
- ENG-07 `src/eval/rerun.ts`: `model.rerun(prev, changes)` equals `evaluate` of `prev`'s inputs and pins with the changes applied, bitwise and error for error, running only dirty cells: changed inputs dirty their users, override changes (pin, move, unpin) dirty their cell, dirty cells run in topological order over the reverse CSR, and a cell whose float64 bits did not change dirties nothing (early stop). `prev` is never modified. `diagnostics` lists `recomputed` and `changed` node cells; an evaluation of another compiled model is rerun in full (`full: true`). Checked over 700 seeded random edits on the seed tenant (`rerun-equivalence.spec.ts`).

```ts
import { compile, type CompiledModel, type TenantData } from '@glidepath/engine';

const model: CompiledModel = compile(bundle, tenant.members); // members in evaluation order
const result = model.evaluate(tenant.values, tenant.overrides);
result.get('res.net');
```

## Tests

`pnpm turbo run typecheck lint test --filter=@glidepath/engine...` (G1, G2 with >= 90% line coverage).

Benches (G8): `pnpm --filter ./tier2-logic/engine bench` (`bench/engine.bench.ts`: `engine.compile` < 150 ms, `engine.evaluate` < 50 ms, `engine.inputHash`, `engine.rerun.lever` < 10 ms: the lever slider that moves the most cells, dragged one registry step per rerun).
