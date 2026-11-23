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
