import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { ReconfigReview } from '@glidepath/ai';
import { PostgresObjectStore, createAiReconfigJob, getAiReconfigJob, schema, withTenant } from '@glidepath/data-access';
import type { Db } from '@glidepath/data-access';
import type { JsonValue } from '@glidepath/domain';
import { seedIds, uuidV5 } from '../../seed/ids';
import { reviewKey, usageKey } from './reconfig';
import type { JobCostEstimate, JobUsage, StoredReconfigJob } from './types';

/**
 * The rehearsal cache bundle (06 section 3: the demo shows a rehearsed UA job whose result is cached). A folder:
 *
 *   manifest.json   `CacheManifest`: who, what prompt, when, which model, usage and cost estimate
 *   review.json     the step 7 payload (`ReconfigReview`: plan, sources, facts, calibration, both drafts)
 *   audit/<name>    the model-call records of the run (`ai/<job-id>/<name>` of the rehearsal)
 *
 * `pnpm ai:rehearse` writes it (`writeCacheBundle`); `migrate --ai-cache <dir>` reads it (`importAiCache`) as an
 * `ai_reconfig_job` of the demo tenant in status `review`, with the audit records under `ai/<new job id>/`.
 * It holds public research and model output only: no key, no tenant data.
 */

export const CACHE_FORMAT = 'glidepath.ai-cache/1';

export interface CacheManifest {
  readonly format: typeof CACHE_FORMAT;
  /** Bundle id: the rehearsal's job id. */
  readonly id: string;
  /** Slug of the tenant the rehearsal set up (`ua`). */
  readonly tenant: string;
  /** Slug of the tenant whose Airlines screen shows the job (`aa`): the job row belongs to it. */
  readonly homeTenant: string;
  readonly prompt: string;
  readonly createdAt: string;
  readonly specVersion: string;
  readonly models: { readonly primary: string; readonly light: string };
  readonly estimate: JobCostEstimate;
  readonly usage: JobUsage;
}

export class CacheBundleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CacheBundleError';
  }
}

export interface CacheBundle {
  readonly manifest: CacheManifest;
  readonly review: ReconfigReview;
  /** Audit records: file name below `audit/` and its bytes. */
  readonly audit: readonly { readonly name: string; readonly body: Uint8Array }[];
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function parseManifest(raw: unknown): CacheManifest {
  if (!isRecord(raw) || raw.format !== CACHE_FORMAT) throw new CacheBundleError(`manifest.json: format must be ${CACHE_FORMAT}`);
  for (const f of ['id', 'tenant', 'homeTenant', 'prompt', 'createdAt', 'specVersion'] as const)
    if (typeof raw[f] !== 'string' || raw[f] === '') throw new CacheBundleError(`manifest.json: ${f} must be a non-empty string`);
  if (!/^[a-z][a-z0-9_-]*$/.test(String(raw.tenant)) || !/^[a-z][a-z0-9_-]*$/.test(String(raw.homeTenant)))
    throw new CacheBundleError('manifest.json: tenant and homeTenant must be tenant slugs');
  if (Number.isNaN(Date.parse(String(raw.createdAt)))) throw new CacheBundleError('manifest.json: createdAt must be a date');
  if (!isRecord(raw.models) || !isRecord(raw.estimate) || !isRecord(raw.usage))
    throw new CacheBundleError('manifest.json: models, estimate and usage are required');
  return raw as unknown as CacheManifest;
}

/** Files below `dir`, as `/`-separated relative paths, sorted. */
function filesBelow(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else out.push(relative(dir, p).split(sep).join('/'));
    }
  };
  if (existsSync(dir)) walk(dir);
  return out;
}

/** Reads and validates a bundle folder; the review is parsed with the AI schemas (`ReconfigReview`). */
export function readCacheBundle(dir: string): CacheBundle {
  const read = (file: string): string => {
    try {
      return readFileSync(join(dir, file), 'utf8');
    } catch {
      throw new CacheBundleError(`AI cache bundle ${dir}: ${file} is missing`);
    }
  };
  const manifest = parseManifest(JSON.parse(read('manifest.json')));
  const parsed = ReconfigReview.safeParse(JSON.parse(read('review.json')));
  if (!parsed.success)
    throw new CacheBundleError(`review.json is not a ReconfigReview: ${parsed.error.issues.map((i) => `${i.path.join('.') || '$'}: ${i.message}`).join('; ')}`);
  const audit = filesBelow(join(dir, 'audit')).map((name) => ({ name, body: new Uint8Array(readFileSync(join(dir, 'audit', name))) }));
  return { manifest, review: parsed.data, audit };
}

/** Writes a bundle folder (created if needed). Files of an earlier bundle in it are overwritten, none are deleted. */
export function writeCacheBundle(dir: string, bundle: CacheBundle): void {
  const put = (file: string, body: string | Uint8Array): void => {
    const path = join(dir, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, body);
  };
  put('manifest.json', `${JSON.stringify(bundle.manifest, null, 2)}\n`);
  put('review.json', `${JSON.stringify(bundle.review, null, 2)}\n`);
  for (const a of bundle.audit) put(`audit/${a.name}`, a.body);
}

/** Deterministic: importing the same bundle again finds the job it made. */
export const cacheJobId = (manifest: Pick<CacheManifest, 'homeTenant' | 'id'>): string => uuidV5(`ai_reconfig_job:cache:${manifest.homeTenant}:${manifest.id}`);

export interface ImportAiCacheOptions {
  readonly dir: string;
  /** Slug of the tenant that owns the job; default the manifest's `homeTenant`. */
  readonly homeTenant?: string;
  readonly log?: (message: string) => void;
}

export interface ImportAiCacheReport {
  readonly jobId: string;
  readonly homeTenant: string;
  /** False when the job was already there (nothing is overwritten). */
  readonly created: boolean;
  readonly objects: number;
}

const encoder = new TextEncoder();

/**
 * `migrate --ai-cache <dir>`: the bundle as an `ai_reconfig_job` of the home tenant in status `review`, authored by
 * the seed loader, with its audit records and review under `ai/<job id>/`. Idempotent; run as the owner role after the
 * home tenant is seeded. Applying it later is an ordinary `ai.apply`.
 */
export async function importAiCache(db: Db, o: ImportAiCacheOptions): Promise<ImportAiCacheReport> {
  const bundle = readCacheBundle(o.dir);
  const { manifest, review } = bundle;
  const homeTenant = o.homeTenant ?? manifest.homeTenant;
  const tenantId = seedIds.tenant(homeTenant);
  const actor = seedIds.seedActor();
  const jobId = cacheJobId({ homeTenant, id: manifest.id });

  const found = await withTenant(db, tenantId, actor, async (tx) => {
    const [tenant] = await tx.select({ id: schema.tenant.id }).from(schema.tenant);
    if (tenant === undefined) throw new CacheBundleError(`ai cache: tenant ${homeTenant} does not exist; seed it first (--seed ${homeTenant})`);
    return (await getAiReconfigJob(tx, jobId)) !== null;
  });
  if (found) return { jobId, homeTenant, created: false, objects: 0 };

  const objects = new PostgresObjectStore(db, tenantId, actor);
  const put = (key: string, body: Uint8Array): Promise<unknown> => objects.put('ai', key, body, { contentType: 'application/json' });
  for (const a of bundle.audit) await put(`${jobId}/${a.name}`, a.body);
  await put(reviewKey(jobId), encoder.encode(JSON.stringify(review, null, 2)));
  await put(usageKey(jobId), encoder.encode(JSON.stringify(manifest.usage, null, 2)));

  const stored: StoredReconfigJob = {
    format: 1,
    step: 'review',
    progress: 1,
    note: 'Rehearsed run, cached',
    dryRun: false,
    plan: review.plan,
    estimate: manifest.estimate,
    usage: manifest.usage,
    review,
    error: null,
    applied: null,
    cache: { bundleId: manifest.id, rehearsedTenant: manifest.tenant, rehearsedAt: manifest.createdAt },
  };
  await withTenant(db, tenantId, actor, (tx) =>
    createAiReconfigJob(tx, { id: jobId, prompt: manifest.prompt, plan: JSON.parse(JSON.stringify(stored)) as JsonValue, status: 'review' }),
  );
  o.log?.(`ai cache: job ${jobId} for ${homeTenant} (${manifest.tenant}), ${bundle.audit.length + 2} objects`);
  return { jobId, homeTenant, created: true, objects: bundle.audit.length + 2 };
}
