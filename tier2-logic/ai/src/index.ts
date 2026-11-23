export const packageName = '@glidepath/ai';

export {
  AiConfigError,
  DEFAULT_LIGHT_MODEL,
  DEFAULT_MODEL,
  loadAiConfig,
  type AiConfig,
  type RetryPolicy,
} from './config';
export {
  defineStep,
  type Effort,
  type ModelClient,
  type ModelTier,
  type ServerTool,
  type Step,
  type StepRun,
  type StepUsage,
} from './step';
export {
  createClaudeModelClient,
  FALLBACK_BETA,
  type ClaudeModelClientOptions,
  type Transport,
} from './client';
export { AUDIT_BUCKET, MemoryAuditSink, type AuditBucket, type AuditSink } from './audit';
export {
  ModelIncompleteError,
  ModelOutputError,
  ModelProtocolError,
  ModelRefusalError,
  ModelStepError,
} from './errors';
export { isRetryable } from './retry';
export type { Source } from './sources';

// AI-02: pipeline schemas, prompts and the onboarding checklist as data.
export {
  ChecklistStepId,
  checklistStep,
  checklistStepForDim,
  checklistStepForVariable,
  ONBOARDING_CHECKLIST,
  parseChecklist,
  renderChecklist,
  type Checklist,
  type ChecklistStep,
  type SeedFile,
} from './onboarding/checklist';
export { Confidence, Deliverable, ReconfigPlan } from './schemas/plan';
export { Fact, FactBase } from './schemas/facts';
export {
  assembleSeedDraft,
  DimensionDraft,
  MemberDraft,
  SeedAssemblyError,
  SeedSectionDraft,
  splitSeedDraft,
  TENANT_TARGET,
  TenantRecordDraft,
  TenantSeedDraft,
  ValueDraft,
  ValueProvenance,
  type RegistryEntry,
  type SeedPresets,
  type TenantSeedDraftInput,
} from './schemas/seed';
export { LeverTuningChange, LeverTuningDraft } from './schemas/lever-tuning';
export {
  BASE_SYSTEM_PROMPT,
  LEVER_TUNING_INSTRUCTIONS,
  RESEARCH_INSTRUCTIONS,
  SCOPE_INSTRUCTIONS,
  SEED_DRAFT_INSTRUCTIONS,
  systemBlocks,
  type PromptStep,
} from './prompts/system';
export {
  jsonBlock,
  quotePromptBar,
  renderLeverTuningPrompt,
  renderResearchPrompt,
  renderScopePrompt,
  renderSeedSectionPrompt,
  type LeverTuningPromptInput,
  type PromptVariable,
  type ResearchPromptInput,
  type ScopePromptInput,
  type SeedSectionPromptInput,
} from './prompts/render';

// AI-03: pipeline steps 1–3 (scope, research with sources, seed draft). Each takes the ModelClient as its only port.
export { ReviewFlag, ReviewFlagKind } from './review';
export { stepCall, type StepCall, type StepResult } from './steps/result';
export { reviewPlan, scope, scopeStep } from './steps/scope';
export {
  checkFactSources,
  research,
  researchStep,
  researchTools,
  type ResearchToolOptions,
} from './steps/research';
export {
  checkSeedSection,
  checkTenantAgainstPlan,
  draftSeed,
  PRESET_SOURCE,
  presetsFromSeed,
  seedSectionPlans,
  seedSectionStep,
  seedSectionStepId,
  type DraftSeedInput,
  type DraftSeedPresets,
  type SeedBundle,
  type SeedSectionPlan,
} from './steps/seed-draft';

// AI-04: pipeline steps 4-5 (validate the draft, calibrate against the last reported year with one repair round).
export {
  CALIBRATION,
  CalibrationMetricId,
  normaliseLabel,
  parseCalibrationConfig,
  type CalibrationConfig,
  type CalibrationMetricDef,
  type InvariantDef,
} from './calibration/catalog';
export {
  CalibrationRepair,
  CalibrationReport,
  CalibrationRound,
  CalibrationTarget,
  DraftCheck,
  DraftValidationEntry,
  InvariantResult,
  MetricResult,
  MetricStatus,
  RepairChange,
  RepairChangeRecord,
  ValidationReport,
} from './schemas/calibration';
export { CALIBRATION_REPAIR_INSTRUCTIONS } from './prompts/system';
export {
  renderCalibrationRepairPrompt,
  type CalibrationRepairPromptInput,
  type RepairPromptVariable,
} from './prompts/render';
export { draftStates, type CompileDraft, type DraftState } from './steps/draft-model';
export { validateDraft, type SeedDraft, type ValidateDraftOptions } from './steps/validate';
export {
  calibrate,
  calibrationRepairStep,
  CalibrationSetupError,
  checkInvariants,
  lastReportedYear,
  targetsFromFacts,
  type CalibrateInput,
  type CalibrateOptions,
  type CalibrationResult,
} from './steps/calibrate';

// AI-05: pipeline steps 6-8 (lever tuning, review payload, apply through applyChangeset).
export { parseReviewConfig, REVIEW_CONFIG, type ReviewConfig } from './pipeline/catalog';
export {
  ChangesetPart,
  DraftChange,
  DraftOrigin,
  DraftReview,
  DraftStructuralChange,
  DraftValueChange,
  ImpactPreview,
  ImpactRow,
  QuestionOrigin,
  ReconfigChangeset,
  ReconfigReview,
  ReviewQuestion,
  ReviewSource,
  ReviewUsage,
  TenantPlan,
} from './schemas/review';
export { checkLeverTuning, leverTuningStep, tunableLevers, tuneLevers, type TuneLeversInput } from './steps/lever-tuning';
export {
  dimensionMemberRow,
  leverTuningChangeset,
  lineItemRow,
  previewImpact,
  reviewPayload,
  seedChangeset,
  tenantDimensions,
  tenantPlan,
  withChanges,
  type ReviewPayloadInput,
  type ReviewPayloadOptions,
} from './steps/review';
export {
  applyDraft,
  ReconfigApplyError,
  type AppliedChangeset,
  type ApplyDraftRequest,
  type ApplyDraftResult,
  type ApplyTarget,
  type ReconfigApplyPort,
  type ReconfigTenant,
} from './steps/apply';
