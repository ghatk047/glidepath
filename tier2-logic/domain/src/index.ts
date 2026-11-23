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
  ScenarioRow,
  ValueWrite,
} from './ports';
