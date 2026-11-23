export const packageName = '@glidepath/spec';

// Pure core. No IO: the node file adapter lives in `@glidepath/spec/node`.
export { loadModelBundle } from './core/load';
export { membersHash } from './core/members-hash';
export { sha256Hex } from './core/sha256';
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
