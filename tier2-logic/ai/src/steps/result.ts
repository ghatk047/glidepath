import type { ReviewFlag } from '../review';
import type { StepRun } from '../step';

/** One model call of a pipeline step, without its output: what the job keeps for audit, cost and review. */
export interface StepCall extends Omit<StepRun<unknown>, 'output'> {
  /** The step's audit slug, e.g. `scope`, `seed-baseline-lines`. */
  step: string;
}

/** What `scope()`, `research()` and `draftSeed()` return: the step's typed output, review flags and its calls. */
export interface StepResult<O> {
  output: O;
  review: ReviewFlag[];
  calls: StepCall[];
}

export const stepCall = (step: string, run: StepRun<unknown>): StepCall => ({
  step,
  sources: run.sources,
  model: run.model,
  fallback: run.fallback,
  usage: run.usage,
  audit: run.audit,
});
