import type { ModelClient, Step, StepRun, StepUsage } from '@glidepath/ai';
import { emptyUsage, usdOf } from './cost';
import type { JobUsage } from './types';

/** The job used its token budget (`AI_MAX_TOKENS_PER_JOB`). Raised by `budgetedClient`; the job ends `budget_exceeded`. */
export class BudgetExceededError extends Error {
  readonly code = 'budget_exceeded';
  constructor(
    readonly used: number,
    readonly max: number,
  ) {
    super(`The job used ${used} tokens; the budget is ${max} (AI_MAX_TOKENS_PER_JOB).`);
    this.name = 'BudgetExceededError';
  }
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

const tokensOf = (u: StepUsage): number => u.inputTokens + u.outputTokens + u.cacheCreationInputTokens + u.cacheReadInputTokens;

/** Running tally of one job's model usage against its token budget. */
export class TokenBudget {
  private readonly totals: Mutable<JobUsage> = { ...emptyUsage() };
  constructor(readonly max: number) {}

  get used(): number {
    return tokensOf(this.totals);
  }

  /** What the job has used so far. */
  get usage(): JobUsage {
    return { ...this.totals, usd: Math.round(this.totals.usd * 10_000) / 10_000 };
  }

  /** Before a call: the budget must not be spent already. */
  assertRoom(): void {
    if (this.used >= this.max) throw new BudgetExceededError(this.used, this.max);
  }

  /** After a call: add its usage; throws when that took the job past the budget. */
  record(model: string, u: StepUsage): void {
    this.totals.calls += 1;
    this.totals.inputTokens += u.inputTokens;
    this.totals.outputTokens += u.outputTokens;
    this.totals.cacheCreationInputTokens += u.cacheCreationInputTokens;
    this.totals.cacheReadInputTokens += u.cacheReadInputTokens;
    this.totals.usd += usdOf(model, u);
    if (this.used > this.max) throw new BudgetExceededError(this.used, this.max);
  }
}

/**
 * Wraps a ModelClient with the cost guard (06 section 2): no call starts once the budget is spent, and a call that
 * takes the job past it stops the job (its tokens are counted, its output dropped).
 */
export function budgetedClient(inner: ModelClient, budget: TokenBudget): ModelClient {
  return {
    async run<I, O>(step: Step<I, O>, input: I): Promise<StepRun<O>> {
      budget.assertRoom();
      const run = await inner.run(step, input);
      budget.record(run.model, run.usage);
      return run;
    },
  };
}
