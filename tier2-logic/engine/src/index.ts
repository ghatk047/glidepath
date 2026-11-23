/**
 * @glidepath/engine: parser, compiler, evaluator (full, incremental, batch), explain. Pure: no IO.
 * Public interface of docs/architecture/03_engine_and_solvers.md §1. Port plan: ../PORTING.md.
 */

export const packageName = '@glidepath/engine';

// 03 §1 ModelBundle is the spec loader's bundle (one model_version); members are the loader's TenantMembers.
export type {
  DimensionDef,
  DimId,
  Member,
  ModelBundle,
  NodeDef,
  TenantMembers,
  VariableDef,
} from '@glidepath/spec';
export type {
  BatchInput,
  BatchResult,
  CellKey,
  Change,
  Compile,
  CompiledModel,
  Evaluation,
  Explanation,
  TenantData,
} from './types';
export { EngineError } from './errors';
export type { EngineErrorCode, SourceLocation } from './errors';

// Parser (ENG-02): `parse(expr): Ast`, a port of engine.py's tokenizer and Pratt parser.
export { parse, toPyTuple, tokenize } from './parse';
export type { AggFn, Ast, BinOp, ParseCache, PyTuple, Token } from './parse';

// Expander (ENG-03): `expand(bundle, members): Cell[]`, cells with chosen expression, resolution, deps.
export { cellKey, expand } from './expand';
export type { Cell, Resolved } from './expand';

// Compiler (ENG-04): `compile(bundle, members)` → parse, expand, toposort, lower, CSR adjacency.
export { compile, compileModel, EngineModel } from './compile';
export type { CompileDiagnostics } from './compile';
