# @glidepath/engine

Parser, compiler, evaluator (full, incremental, batch), explain. Pure: no IO. TypeScript port of `docs/spec/reference/engine.py` (ADR-005); must match `docs/spec/reference/golden_results.json` (ADR-020).

**Start with [PORTING.md](PORTING.md)**: the map from every def/class of engine.py to a TS module and function, the semantics that are easy to get wrong (each with its planned test), the deliberate deviations, and the parity harness design. Its tables are checked by `src/porting-*.spec.ts`.

## Status

ENG-01 skeleton: `src/index.ts` exports the interfaces of `docs/architecture/03_engine_and_solvers.md` §1 (`compile`, `CompiledModel`, `TenantData`, `Evaluation`, `Change`, `BatchInput`, `BatchResult`, `Explanation`, `EngineError`) and re-exports `ModelBundle` and member types from `@glidepath/spec`. `compile` throws `EngineError` `NOT_IMPLEMENTED` until ENG-04. Work order: ENG-02 → 03 → 04 → 05 → 06 (parity gate).

```ts
import { compile, type CompiledModel, type TenantData } from '@glidepath/engine';

const model: CompiledModel = compile(bundle, tenant.members); // members in evaluation order
const result = model.evaluate(tenant.values, tenant.overrides);
result.get('res.net');
```

## Tests

`pnpm turbo run typecheck lint test --filter=@glidepath/engine...`
