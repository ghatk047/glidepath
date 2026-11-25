import type { AiConfig, Deliverable } from '@glidepath/ai';
import COST_MODEL from './cost-model.json';
import type { JobCostEstimate, JobUsage } from './types';

/**
 * The cost estimate shown before a job starts and the usd of the tokens a job used (06 section 2, cost guard).
 * Rates and per-step token figures are data (`cost-model.json`), not code.
 */

export interface Rate {
  readonly inputUsdPerMTok: number;
  readonly outputUsdPerMTok: number;
  readonly cacheReadUsdPerMTok: number;
  readonly cacheWriteUsdPerMTok: number;
}

const RATES: Readonly<Record<string, Rate>> = COST_MODEL.rates;
export const rateOf = (model: string): Rate => RATES[model] ?? COST_MODEL.defaultRate;

const MILLION = 1_000_000;

export interface TokenCounts {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheCreationInputTokens: number;
  readonly cacheReadInputTokens: number;
}

export const usdOf = (model: string, t: TokenCounts): number => {
  const r = rateOf(model);
  return (
    (t.inputTokens * r.inputUsdPerMTok +
      t.outputTokens * r.outputUsdPerMTok +
      t.cacheCreationInputTokens * r.cacheWriteUsdPerMTok +
      t.cacheReadInputTokens * r.cacheReadUsdPerMTok) /
    MILLION
  );
};

export interface EstimateInput {
  readonly prompt: string;
  /** What the job produces; before step 1 answers, assume everything. */
  readonly produce?: readonly Deliverable[];
  /** Model calls of the seed draft: checklist steps that take their values from facts (`seedSectionPlans(bundle).length`). */
  readonly seedSections: number;
  readonly config: Pick<AiConfig, 'models'>;
  readonly maxTokens: number;
}

/**
 * Expected usage of a whole job: scope, research, one call per seed section, one calibration repair round (a
 * contingency, it often does not run) and the lever tuning. The prompt adds its own tokens to the first two calls.
 */
export function estimateReconfigCost(input: EstimateInput): JobCostEstimate {
  const produce = input.produce ?? ['seed', 'lever_tuning'];
  const s = COST_MODEL.steps;
  const promptTokens = Math.ceil(input.prompt.length / COST_MODEL.charsPerToken);
  let inputTokens = promptTokens * 2 + s.scope.calls * s.scope.inputTokens + s.research.calls * s.research.inputTokens;
  let outputTokens = s.scope.calls * s.scope.outputTokens + s.research.calls * s.research.outputTokens;
  if (produce.includes('seed')) {
    const calls = input.seedSections * s.seedSection.callsPerSection;
    inputTokens += calls * s.seedSection.inputTokens + s.calibrationRepair.calls * s.calibrationRepair.inputTokens;
    outputTokens += calls * s.seedSection.outputTokens + s.calibrationRepair.calls * s.calibrationRepair.outputTokens;
  }
  if (produce.includes('lever_tuning')) {
    inputTokens += s.leverTuning.calls * s.leverTuning.inputTokens;
    outputTokens += s.leverTuning.calls * s.leverTuning.outputTokens;
  }
  const model = input.config.models.primary;
  const usd = usdOf(model, { inputTokens, outputTokens, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 });
  return { inputTokens, outputTokens, usd: Math.round(usd * 100) / 100, model, maxTokens: input.maxTokens };
}

export const emptyUsage = (): JobUsage => ({
  calls: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationInputTokens: 0,
  cacheReadInputTokens: 0,
  usd: 0,
});
