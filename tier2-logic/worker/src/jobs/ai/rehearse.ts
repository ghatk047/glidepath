import { MemoryAuditSink } from '@glidepath/ai';
import { BudgetExceededError, TokenBudget, budgetedClient } from './budget';
import { CACHE_FORMAT, type CacheManifest, writeCacheBundle } from './cache';
import { estimateReconfigCost } from './cost';
import type { AiJobDeps } from './deps';
import { runPipeline, seedSectionCount } from './pipeline';
import { REFERENCE_TENANT } from './deps';
import { loadJobSettings } from './settings';

/**
 * `pnpm ai:rehearse --tenant ua`: steps 1 to 7 of the reconfiguration pipeline once, outside the app, with the real
 * client, and the result written as a cache bundle folder (`cache.ts`). The bundle is committed under
 * `tier3-data/seed/ai-cache/<tenant>` and shown by the demo as a rehearsed job. No database is touched.
 */

export interface RehearseOptions {
  /** Slug of the tenant to set up (`ua`). */
  readonly tenant: string;
  /** The prompt-bar text; default: a plain request to onboard the airline with this code. */
  readonly prompt?: string;
  /** Folder to write the bundle into. */
  readonly outDir: string;
  /** Slug of the tenant that will own the imported job (default: the reference tenant). */
  readonly home?: string;
}

export interface RehearseReport {
  readonly jobId: string;
  readonly outDir: string;
  readonly manifest: CacheManifest;
  readonly files: number;
}

export const defaultRehearsePrompt = (tenant: string): string =>
  `Set up ${tenant.toUpperCase()} as a new tenant: the airline whose IATA code is ${tenant.toUpperCase()}. Use its latest annual report and public filings.`;

const SLUG = /^[a-z][a-z0-9_-]*$/;

/** Prints the cost estimate before the first model call (06 section 2: a visible estimate before start), then runs. */
export async function runRehearse(o: RehearseOptions, deps: AiJobDeps, log: (message: string) => void = () => undefined): Promise<RehearseReport> {
  if (!SLUG.test(o.tenant)) throw new Error(`rehearse: --tenant must be a tenant slug such as ua, got ${JSON.stringify(o.tenant)}`);
  const home = o.home ?? REFERENCE_TENANT;
  if (!SLUG.test(home)) throw new Error('rehearse: --home must be a tenant slug');
  const prompt = (o.prompt ?? defaultRehearsePrompt(o.tenant)).trim();
  const jobId = deps.newId();
  const settings = loadJobSettings(deps.env);
  const config = deps.config();
  const spec = await deps.spec();
  const estimate = estimateReconfigCost({ prompt, seedSections: seedSectionCount(spec.bundle), config, maxTokens: settings.maxTokensPerJob });
  log(`rehearse: ${o.tenant}: estimate ${estimate.inputTokens} input + ${estimate.outputTokens} output tokens on ${estimate.model}, about $${estimate.usd.toFixed(2)}; budget ${estimate.maxTokens} tokens`);

  const audit = new MemoryAuditSink();
  const budget = new TokenBudget(settings.maxTokensPerJob);
  const client = budgetedClient(deps.client({ jobId, config, audit }), budget);
  try {
    const { review } = await runPipeline(
      client,
      { promptBar: prompt, today: deps.now().toISOString().slice(0, 10), bundle: spec.bundle, reference: spec.reference, existingTenants: [] },
      { enter: async (step, fraction, note) => log(`rehearse: ${Math.round(fraction * 100)}% ${step}: ${note}`) },
    );
    if (review === null) throw new Error('rehearse: the pipeline returned no review');
    const manifest: CacheManifest = {
      format: CACHE_FORMAT,
      id: jobId,
      tenant: o.tenant,
      homeTenant: home,
      prompt,
      createdAt: deps.now().toISOString(),
      specVersion: spec.bundle.specVersion,
      models: config.models,
      estimate,
      usage: budget.usage,
    };
    const prefix = `ai/${jobId}/`;
    const auditFiles = audit.paths().map((p) => ({ name: p.slice(prefix.length), body: new Uint8Array(audit.objects.get(p)!.body) }));
    writeCacheBundle(o.outDir, { manifest, review, audit: auditFiles });
    log(`rehearse: wrote ${o.outDir} (${auditFiles.length} audit records), used ${budget.used} tokens, about $${budget.usage.usd.toFixed(2)}`);
    return { jobId, outDir: o.outDir, manifest, files: auditFiles.length + 2 };
  } catch (err) {
    if (err instanceof BudgetExceededError) log(`rehearse: stopped at the token budget (${err.used} of ${err.max}); nothing written`);
    throw err;
  }
}

export interface RehearseArgs {
  readonly tenant: string;
  readonly prompt?: string;
  readonly out?: string;
  readonly home?: string;
}

/** `--tenant ua`, `--tenant=ua`; also `--prompt`, `--out`, `--home`. */
export function parseRehearseArgs(argv: readonly string[]): RehearseArgs {
  const found: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const m = /^--(tenant|prompt|out|home)(?:=(.*))?$/.exec(argv[i]!);
    if (!m) throw new Error(`ai:rehearse: unknown argument ${argv[i]} (usage: ai:rehearse --tenant <slug> [--prompt <text>] [--out <dir>] [--home <slug>])`);
    const value = m[2] ?? argv[++i];
    if (value === undefined || value === '' || (m[2] === undefined && value.startsWith('--'))) throw new Error(`ai:rehearse: --${m[1]} needs a value`);
    found[m[1]!] = value;
  }
  if (found.tenant === undefined) throw new Error('ai:rehearse: --tenant <slug> is required (for example --tenant ua)');
  return {
    tenant: found.tenant,
    ...(found.prompt === undefined ? {} : { prompt: found.prompt }),
    ...(found.out === undefined ? {} : { out: found.out }),
    ...(found.home === undefined ? {} : { home: found.home }),
  };
}
