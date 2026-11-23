export const packageName = '@glidepath/domain';

// Pure: no IO (eslint.config.js enforces it). State is read and written through ./ports.
export {
  CHANGE_OPS,
  CHANGE_ROW_OPS,
  CHANGE_ROW_STATUSES,
  CHANGE_ROW_TARGETS,
  CHANGE_ROW_TARGET_KIND,
  CHANGE_TARGETS,
  CHANGESET_ORIGINS,
  CHANGESET_STATUSES,
  ChangesetDraftError,
  LINE_ITEM_DIM,
  TENANT_COLUMN,
  changeRowTarget,
  checkDraft,
  draftIssues,
} from './changeset';
export type {
  Change,
  ChangeOp,
  ChangeRow,
  ChangeRowOp,
  ChangeRowStatus,
  ChangeRowTarget,
  ChangeTarget,
  Changeset,
  ChangesetDraft,
  ChangesetId,
  ChangesetOrigin,
  ChangesetRow,
  ChangesetStatus,
  DraftIssue,
  JsonObject,
  JsonValue,
  ScenarioId,
  StructuralChange,
  Timestamp,
  UserId,
  ValueChange,
} from './changeset';
export { SCALAR_MEMBER_KEY, memberKey, splitMemberKey } from './member-key';
export type { Dimensioned, MemberKey } from './member-key';
export { resolveInputs, resolveScenarioChain } from './resolve';
export type {
  InputValueRow,
  NodeOverrideRow,
  ResolveOptions,
  ResolvedInput,
  ResolvedInputs,
  ScenarioLevel,
  ScenarioLink,
} from './resolve';
export { reverse } from './reverse';
export {
  CORPORATE_LAYER,
  INPUT_RULES,
  INPUT_RULE_IDS,
  LINE_ITEM_KEYS,
  OUT_OF_SCOPE_MEMO_DOMAIN,
  RULE_TOLERANCE,
  SEED_LINE_ATTRIBUTES,
  VALIDATION_RULES,
  toCellKey,
  validateInputs,
  vr01DomainOwnership,
  vr02SharedServicesOwner,
  vr03UsageKeys,
  vr04RegistryBounds,
  vr06RetirementSplit,
  vr07RetiredApps,
  vr09LineItemKeys,
  vr10CorpInputYears,
} from './validation';
export type {
  InputRule,
  InputRuleId,
  RuleDef,
  RuleId,
  Severity,
  ValidationEntry,
  ValidationState,
} from './validation';
export {
  BOUNDS_POLICY,
  FORK_KIND,
  LOCKED_WRITE_ORIGINS,
  UNCOUNTED_ORIGINS,
  UNDO_BOUNDS_POLICY,
  applyChangeset,
  forkName,
  messagesOf,
  noRecompute,
  summaryOf,
} from './apply';
export type {
  ApplyBundle,
  ApplyOptions,
  ApplyResult,
  BoundsPolicy,
  ChangeMessages,
  ChangesetSummaryData,
  ClampedValue,
  Recompute,
  RecomputeInput,
} from './apply';
export {
  ChangesetConflictError,
  ChangesetNotFoundError,
  ChangesetRejectedError,
  ScenarioNotFoundError,
  ScenarioOperationError,
  ScenarioPermissionError,
} from './apply-errors';
export type { StaleChange } from './apply-errors';
export { LINE_ITEM_ATTRIBUTES, LINE_ITEM_JOINED_ATTRIBUTES, memberOfRow } from './member-rows';
export { SCENARIO_KINDS, modelCacheKey } from './ports';
export type {
  AuditEntry,
  CalcRunRow,
  ChangesetStore,
  ChangesetTx,
  InputState,
  MemberWrite,
  ModelCache,
  ModelCacheKey,
  ScenarioKind,
  ScenarioPatch,
  ScenarioRow,
  ScenarioStore,
  ScenarioTx,
  ValueWrite,
} from './ports';
export {
  CREATE_BOUNDS_POLICY,
  CREATE_KIND,
  DEFAULT_CREATE_ORIGIN,
  PRESET_KIND,
  PRESET_UNLOCK_ROLES,
  SCENARIO_EDIT_ROLES,
  TENANT_ROLES,
  blendFrom,
  createScenario,
  patchScenario,
  scenarioName,
} from './scenario';
export type {
  BlendPart,
  CreateMode,
  CreateScenarioOptions,
  CreateScenarioResult,
  CreateScenarioSpec,
  PatchScenarioOptions,
  TenantRole,
} from './scenario';
export { revert, undoRedo } from './history';
export type { UndoRedo } from './history';
export { rebase } from './rebase';
export type { RebaseConflict, RebaseResult, TheirChange } from './rebase';
// DOM-06: display view-models for derived series (ADR-021).
export {
  BASELINE_CELLS,
  BASELINE_GROUP_BY,
  BRIDGE_NODES,
  LEVER_CELLS,
  LEVER_DIM,
  LEVER_FAMILY_ATTRIBUTE,
  MONTHS_IN_YEAR,
  VIEWS,
  VIEW_NAMES,
  baselineGroups,
  baselineSummary,
  bridge,
  domShareKey,
  engineCell,
  leversFamilies,
  leversMonthly,
  leversScale,
  rampWeights,
  vpsDomainOutlay,
} from './views';
export type {
  BaselineGroupBy,
  BaselineGroupsView,
  BaselineSummaryView,
  BridgeStep,
  BridgeView,
  LeversFamiliesView,
  LeversMonthlyView,
  LeversScaleView,
  ViewEvaluation,
  ViewFn,
  ViewName,
  ViewParamsOf,
  ViewPayloads,
  VpsDomainOutlayView,
} from './views';
