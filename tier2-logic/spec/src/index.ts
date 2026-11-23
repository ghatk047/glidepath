export const packageName = '@glidepath/spec';

// Pure core. No IO: the node file adapter lives in `@glidepath/spec/node`.
export { loadModelBundle } from './core/load';
export { membersHash } from './core/members-hash';
export { sha256Hex } from './core/sha256';
export {
  endsInTimes100,
  isPercentUnit,
  nodePercentScale,
  POINTS_LAYER,
  variablePercentScale,
} from './core/percent-scale';
export type { PercentScale } from './core/percent-scale';
export { parseTenantSeed, seedToTenantData } from './core/seed';
export type {
  CellKey,
  InputValue,
  LeverLibraryEntry,
  SeedScenario,
  SeedScenarios,
  TenantData,
  TenantInfo,
  TenantSeed,
  TenantSeedJson,
} from './core/seed';
// SOL-12: the solvers' decision set and bounds, generated from docs/spec/reference/solvers_demo.py.
export { decisionBoundsFor } from './core/decision-bounds';
export type { DecisionBounds } from './core/decision-bounds';
export { REFERENCE_DECISION_BOUNDS } from './reference/decision-bounds';
// MOD-11: constraint defaults the spec states in prose, generated from docs/spec/solvers.json.
export { solverDefaultsFor } from './core/solver-defaults';
export type { SolverDefaults } from './core/solver-defaults';
export { REFERENCE_SOLVER_DEFAULTS } from './reference/solver-defaults';
export { SpecValidationError, jsonPath } from './core/errors';
export type { SpecIssue } from './core/errors';
export type {
  AttrValue,
  CaseWhen,
  DimId,
  DimensionDef,
  Member,
  MemberId,
  ModelBundle,
  ModelBundleJson,
  NodeCase,
  NodeDef,
  NodeId,
  TenantMembers,
  VarId,
  VariableDef,
  VariableKind,
  VariableRole,
  VariableType,
} from './core/types';
