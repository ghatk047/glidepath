/**
 * @glidepath/engine: parser, compiler, evaluator (full, incremental, batch), explain. Pure: no IO.
 * Public interface of docs/architecture/03_engine_and_solvers.md §1. Port plan: ../PORTING.md.
 */
import { notImplemented } from './errors';
import type { Compile } from './types';

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
export type { EngineErrorCode } from './errors';

/**
 * Compile a model_version for one tenant's members: parse, expand, toposort, lower (03 §1 pipeline).
 * Stub until ENG-04.
 */
export const compile: Compile = () => {
  throw notImplemented('compile', 'ENG-04');
};
