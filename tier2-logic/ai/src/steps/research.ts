import type {
  BetaWebFetchTool20260209,
  BetaWebSearchTool20260209,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { renderResearchPrompt, type ResearchPromptInput } from '../prompts/render';
import { systemBlocks } from '../prompts/system';
import type { ReviewFlag } from '../review';
import { type Fact, FactBase } from '../schemas/facts';
import type { Source } from '../sources';
import { defineStep, type ModelClient, type Step } from '../step';
import { stepCall, type StepResult } from './result';

/**
 * Limits on the server tools, from configuration (never constants in code). Unset means the API default.
 * Web fetch runs without document citations: they cannot be combined with `output_config.format` (the API
 * rejects the request). Citations come from web search (`web_search_result_location`), and every fact's URL is
 * checked against the pages the model actually searched, fetched or cited (`checkFactSources`).
 */
export interface ResearchToolOptions {
  maxSearches?: number;
  maxFetches?: number;
  maxContentTokens?: number;
}

export function researchTools(
  opts: ResearchToolOptions = {},
): [BetaWebSearchTool20260209, BetaWebFetchTool20260209] {
  const search: BetaWebSearchTool20260209 = { type: 'web_search_20260209', name: 'web_search' };
  if (opts.maxSearches !== undefined) search.max_uses = opts.maxSearches;
  const webFetch: BetaWebFetchTool20260209 = { type: 'web_fetch_20260209', name: 'web_fetch' };
  if (opts.maxFetches !== undefined) webFetch.max_uses = opts.maxFetches;
  if (opts.maxContentTokens !== undefined) webFetch.max_content_tokens = opts.maxContentTokens;
  return [search, webFetch];
}

/** Pipeline step 2 (06 §2): public facts per checklist step with sources, effort `high`, web search + fetch. */
export function researchStep(opts: ResearchToolOptions = {}): Step<ResearchPromptInput, FactBase> {
  return defineStep({
    id: 'research',
    effort: 'high',
    output: FactBase,
    system: systemBlocks('research'),
    prompt: renderResearchPrompt,
    tools: researchTools(opts),
  });
}

/** URL identity for matching a fact's source to the pages seen: no fragment, no trailing slash, lowercase host. */
function urlKey(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    return `${u.protocol}//${u.host.toLowerCase()}${u.pathname.replace(/\/+$/, '')}${u.search}`;
  } catch {
    return url;
  }
}

/**
 * Enforce 06 §2 "facts without a source are marked confidence = low and flagged in review" (pure).
 * - no `sourceUrl`: confidence `L`, flag `unsourced`;
 * - a `sourceUrl` the model never searched, fetched or cited in this job: confidence `L`, flag `source_not_seen`
 *   (the URL is kept for the reviewer to check);
 * - otherwise a missing `sourceTitle` is filled from the source list.
 */
export function checkFactSources(
  facts: FactBase,
  sources: readonly Source[],
): { facts: FactBase; review: ReviewFlag[] } {
  const seen = new Map(sources.map((s) => [urlKey(s.url), s]));
  const review: ReviewFlag[] = [];
  const checked = facts.facts.map((f): Fact => {
    if (f.sourceUrl === null) {
      review.push({
        kind: 'unsourced',
        step: f.step,
        target: f.id,
        message: `Fact ${f.id} (${f.label}) has no source; confidence set to L.`,
      });
      return { ...f, confidence: 'L' };
    }
    const source = seen.get(urlKey(f.sourceUrl));
    if (!source) {
      review.push({
        kind: 'source_not_seen',
        step: f.step,
        target: f.id,
        message: `Fact ${f.id} (${f.label}) cites ${f.sourceUrl}, which the research never opened; confidence set to L.`,
      });
      return { ...f, confidence: 'L' };
    }
    return { ...f, sourceTitle: f.sourceTitle ?? source.title };
  });
  return { facts: { facts: checked, gaps: facts.gaps.map((g) => ({ ...g })) }, review };
}

/** Step 2: research the plan's checklist steps on the web. The ModelClient is the only dependency. */
export async function research(
  client: ModelClient,
  input: ResearchPromptInput,
  opts: ResearchToolOptions = {},
): Promise<StepResult<FactBase>> {
  const step = researchStep(opts);
  const run = await client.run(step, input);
  const { facts, review } = checkFactSources(run.output, run.sources);
  return { output: facts, review, calls: [stepCall(step.id, run)] };
}
