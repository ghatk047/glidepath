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
