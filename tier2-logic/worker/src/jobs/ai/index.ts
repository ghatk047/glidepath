/**
 * AI jobs (AI-06): `ai.reconfig` (pipeline steps 1 to 7, cost guard), `ai.apply` (step 8), the rehearse CLI core and
 * the cache bundle. Importing this module registers the two handlers; tests import the `run*` functions instead and
 * pass their own dependencies.
 */
import './register';

export { runReconfig, reviewKey, usageKey } from './reconfig';
export type { ReconfigJobResult } from './reconfig';
export { runApply, createApplyPort, reconfigTenantId } from './apply';
export type { ApplyJobResult, ApplyPortOptions } from './apply';
export { runPipeline, seedSectionCount } from './pipeline';
export type { PipelineHooks, PipelineInput, PipelineResult } from './pipeline';
export { BudgetExceededError, TokenBudget, budgetedClient } from './budget';
export { estimateReconfigCost, usdOf, rateOf } from './cost';
export { DEFAULT_MAX_TOKENS_PER_JOB, loadJobSettings, AiJobSettingsError } from './settings';
export { defaultAiDeps, REFERENCE_TENANT } from './deps';
export type { AiJobDeps, AiSpec, DefaultAiDepsOptions } from './deps';
export { redact, safeMessage, secretsOf, REDACTED } from './redact';
export { runRehearse, defaultRehearsePrompt, parseRehearseArgs } from './rehearse';
export type { RehearseArgs, RehearseOptions, RehearseReport } from './rehearse';
export { CACHE_FORMAT, CacheBundleError, cacheJobId, importAiCache, readCacheBundle, writeCacheBundle } from './cache';
export type { CacheBundle, CacheManifest, ImportAiCacheOptions, ImportAiCacheReport } from './cache';
export { AiJobError, QUEUE_APPLY, QUEUE_RECONFIG } from './types';
export type {
  AiJobContext,
  AppliedReconfig,
  ApplyPayload,
  JobCostEstimate,
  JobStatus,
  JobStep,
  JobUsage,
  ReconfigPayload,
  StoredReconfigJob,
} from './types';
