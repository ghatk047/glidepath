import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PostgresObjectStore, createAiReconfigJob, createDb, getAiReconfigJob, schema, sql, withTenant } from '@glidepath/data-access';
import type { DbHandle } from '@glidepath/data-access';
import { loadAiConfig, ReconfigReview } from '@glidepath/ai';
import { start, stop } from '@glidepath/pg-local';
import type { PgLocalInstance } from '@glidepath/pg-local';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findTier3Data } from '../../seed/files';
import { seedIds } from '../../seed/ids';
import { runMigrate } from '../../seed/run';
import { runApply } from './apply';
import { cacheJobId, readCacheBundle } from './cache';
import type { AiJobDeps } from './deps';
import { runReconfig, reviewKey, usageKey } from './reconfig';
import { runRehearse } from './rehearse';
import { NEW_TENANT, TEST_KEY, loadFixtures, testDeps, type Fixtures, type FakeModel } from './testing/fake-model';
import type { AiJobContext, StoredReconfigJob } from './types';

/**
 * AI-06 on pg-local with the AA seed (as compose: roles glidepath_owner / glidepath_app, RLS applies) and the Postgres
 * object store. The model is the fake client of `testing/fake-model.ts`: no network, no key.
 */

const tier3Data = findTier3Data();
const home = seedIds.tenant('aa');
const user = seedIds.seedActor();

let instance: PgLocalInstance;
let stateFile: string;
let app: DbHandle;
let f: Fixtures;
let tmp: string;
let jobCounter = 0;

const asRole = (url: string, role: string): string => {
  const u = new URL(url);
  u.username = role;
  return u.toString();
};

const jobUuid = (): string => `00000000-0000-4000-8000-${(0xa10000 + ++jobCounter).toString(16).padStart(12, '0')}`;

function ctxFor(signal: AbortSignal = new AbortController().signal): AiJobContext {
  return { tenantId: home, userId: user, signal, progress: () => undefined, withTenant: (fn) => withTenant(app.db, home, user, fn) };
}

/** Deps with the fake model and the real database. */
function deps(o: Parameters<typeof testDeps>[1] = {}): AiJobDeps {
  return testDeps(f, {
    ...o,
    overrides: { objects: ({ tenantId, userId }) => new PostgresObjectStore(app.db, tenantId, userId), db: () => app.db, ...(o.overrides ?? {}) },
  });
}

/** The job row as the API reads it. */
async function readJob(id: string): Promise<{ status: string; changeset_id: string | null; plan: StoredReconfigJob }> {
  const row = await withTenant(app.db, home, user, (tx) => getAiReconfigJob(tx, id));
  expect(row).not.toBeNull();
  return { status: row!.status, changeset_id: row!.changeset_id, plan: row!.plan as unknown as StoredReconfigJob };
}

const queue = (id: string, prompt = 'Set up Example Air as a new tenant.'): Promise<unknown> =>
  withTenant(app.db, home, user, (tx) => createAiReconfigJob(tx, { id, prompt, status: 'queued' }));

const objectsOf = async (tenantId: string, prefix: string): Promise<string[]> =>
  (await new PostgresObjectStore(app.db, tenantId, user).list('ai', prefix)).map((m) => m.key);

beforeAll(async () => {
  f = await loadFixtures();
  tmp = mkdtempSync(join(tmpdir(), 'gp-ai06-pg-'));
  stateFile = join(tmpdir(), `gp-ai06-${process.pid}.json`);
  instance = await start({ stateFile, init: resolve(tier3Data, 'postgres/init') });
  await runMigrate({ databaseUrl: asRole(instance.url, 'glidepath_owner'), seed: 'aa', tier3Data });
  app = createDb(asRole(instance.url, 'glidepath_app'));
}, 300_000);

afterAll(async () => {
  await app?.close();
  if (instance) stop({ instance, stateFile });
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

describe('AI-06 ai.reconfig on pg-local', { timeout: 120_000 }, () => {
  let jobId: string;
  let appliedSeed: Awaited<ReturnType<typeof runApply>>;

  it('job runs steps 1-7, persists ai_reconfig_job (plan, status, changeset_id) and ai/<job-id>/ objects (fake client) (test)', async () => {
    jobId = jobUuid();
    await queue(jobId);
    const models: FakeModel[] = [];
    const seen: { status: string; estimate: unknown }[] = [];
    const d = deps({
      models,
      // The row says running, with the estimate, before the first model call.
      onCall: async (_step, n) => {
        if (n === 1) {
          const r = await readJob(jobId);
          seen.push({ status: r.status, estimate: r.plan.estimate });
        }
      },
    });
    const result = await runReconfig(ctxFor(), { tenantId: home, userId: user, jobId }, d);
    expect(result).toEqual({ jobId, status: 'review', step: 'review' });

    const model = models[0]!;
    // Steps 1-3, 5, 6: scope, research, one call per seed section, tuning (calibration ties, so no repair call).
    expect(model.calls[0]).toBe('scope');
    expect(model.calls[1]).toBe('research');
    expect(model.calls.filter((c) => c.startsWith('seed-')).length).toBeGreaterThan(3);
    expect(model.calls.at(-1)).toBe('lever-tuning');
    expect(model.calls).not.toContain('calibration-repair');

    expect(seen).toHaveLength(1);
    expect(seen[0]!.status).toBe('running');
    expect(seen[0]!.estimate).toMatchObject({ maxTokens: 2_000_000, model: 'claude-opus-5-5' });

    const job = await readJob(jobId);
    expect(job.status).toBe('review');
    expect(job.changeset_id).toBeNull(); // nothing is written before the user's apply
    const stored = job.plan;
    expect(stored).toMatchObject({ format: 1, step: 'review', progress: 1, dryRun: false, error: null, applied: null, cache: null });
    expect(stored.plan).toMatchObject({ intent: 'onboard', tenant: { name: 'Example Air', iataCode: 'ZZ' } });
    expect(stored.usage).toMatchObject({ calls: model.calls.length, inputTokens: model.calls.length * 1000 });
    expect(stored.estimate.usd).toBeGreaterThan(0);
    const review = ReconfigReview.parse(stored.review);
    expect(review.drafts.seed!.changes).toBeGreaterThan(0);
    expect(review.drafts.lever_tuning!.changes).toBe(2);
    expect(review.calibration!.tied).toBe(true);
    expect(review.validation!.ok).toBe(true);

    // Objects under ai/<job-id>/: the client's records, the review and the usage.
    const keys = await objectsOf(home, `${jobId}/`);
    expect(keys).toContain(reviewKey(jobId));
    expect(keys).toContain(usageKey(jobId));
    expect(keys.filter((k) => k.endsWith('-response.json'))).toHaveLength(model.calls.length);
    const stored2 = await new PostgresObjectStore(app.db, home, user).get('ai', reviewKey(jobId));
    expect(ReconfigReview.parse(JSON.parse(new TextDecoder().decode(stored2!.bytes)))).toEqual(review);

    // The job wrote nothing of the new tenant: it does not exist yet.
    const zz = await withTenant(app.db, seedIds.tenant(NEW_TENANT), user, (tx) => tx.select({ id: schema.tenant.id }).from(schema.tenant));
    expect(zz).toEqual([]);
    // A job runs once.
    await expect(runReconfig(ctxFor(), { tenantId: home, userId: user, jobId }, d)).rejects.toMatchObject({ code: 'bad_state' });
  });

  it('apply creates the tenant through applyChangeset and maps results to changesetId per kind (test)', async () => {
    const d = deps();
    appliedSeed = await runApply(ctxFor(), { tenantId: home, userId: user, jobId, accept: ['seed', 'lever_tuning'], clientRequestId: 'req-1' }, d);
    const zzId = seedIds.tenant(NEW_TENANT);
    expect(appliedSeed).toMatchObject({ jobId, tenantId: zzId, tenant: NEW_TENANT });
    expect(appliedSeed.applied.map((a) => a.kind)).toEqual(['seed', 'lever_tuning']);
    const review = ReconfigReview.parse((await readJob(jobId)).plan.review);
    expect(appliedSeed.applied.map((a) => a.editsCount)).toEqual([review.drafts.seed!.changes, review.drafts.lever_tuning!.changes]);
    for (const a of appliedSeed.applied) expect(a.changesetId).toMatch(/^[0-9a-f-]{36}$/);

    // The tenant, its presets (locked), its changesets (origins), its line-lever links, all under RLS of that tenant.
    const rows = await withTenant(app.db, zzId, user, async (tx) => ({
      tenant: await tx.select({ slug: schema.tenant.slug, name: schema.tenant.name, status: schema.tenant.status, mv: schema.tenant.model_version_id }).from(schema.tenant),
      scenarios: await tx.select({ key: schema.scenario.key, locked: schema.scenario.locked }).from(schema.scenario),
      changesets: await tx.select({ id: schema.changeset.id, origin: schema.changeset.origin, scenario_id: schema.changeset.scenario_id }).from(schema.changeset),
      levers: await tx.select({ n: sql<number>`count(*)::int` }).from(schema.line_item_lever),
      members: await tx.select({ role: schema.tenant_membership.role }).from(schema.tenant_membership),
      lines: await tx.select({ n: sql<number>`count(*)::int` }).from(schema.line_item),
    }));
    expect(rows.tenant).toHaveLength(1);
    expect(rows.tenant[0]).toMatchObject({ slug: NEW_TENANT, name: 'Example Air', status: 'active' });
    expect(rows.scenarios.map((s) => s.key).sort()).toEqual(review.tenant!.presets.map((p) => p.key).sort());
    expect(rows.scenarios.every((s) => s.locked)).toBe(true);
    expect(rows.levers[0]!.n).toBe(review.tenant!.leverMappings.length);
    expect(rows.lines[0]!.n).toBeGreaterThan(0);
    expect(rows.members).toEqual([{ role: 'owner' }]);
    const origins = new Set(rows.changesets.map((c) => c.origin));
    expect(origins).toEqual(new Set(['ai_reconfig', 'seed']));
    expect(rows.changesets.map((c) => c.id)).toEqual(expect.arrayContaining(appliedSeed.applied.map((a) => a.changesetId)));

    // The job: applied, the result kept; changeset_id stays null because the changesets are in another tenant.
    const job = await readJob(jobId);
    expect(job.status).toBe('applied');
    expect(job.changeset_id).toBeNull();
    expect(job.plan.applied!.changesets.length).toBe(rows.changesets.length);
    expect(job.plan.applied).toMatchObject({ tenantId: zzId, tenant: NEW_TENANT, applied: appliedSeed.applied });

    // A repeat returns the stored result; the new tenant cannot be created twice.
    expect(await runApply(ctxFor(), { tenantId: home, userId: user, jobId, accept: ['seed'] }, d)).toEqual(appliedSeed);
    const again = jobUuid();
    await queue(again);
    await runReconfig(ctxFor(), { tenantId: home, userId: user, jobId: again }, d);
    await expect(runApply(ctxFor(), { tenantId: home, userId: user, jobId: again, accept: ['seed'] }, d)).rejects.toThrow(/already exists/);
  });

  it('tuning an existing tenant applies as its own changeset and sets ai_reconfig_job.changeset_id (test)', async () => {
    const id = jobUuid();
    const base = ReconfigReview.parse((await readJob(jobId)).plan.review);
    // A tuning-only review of AA: the same tuning, no seed, plan intent `tune`.
    const review: ReconfigReview = {
      ...base,
      plan: { ...base.plan, intent: 'tune', produce: ['lever_tuning'], tenant: { ...base.plan.tenant, existingTenantId: home } },
      tenant: null,
      drafts: { seed: null, lever_tuning: base.drafts.lever_tuning },
    };
    const stored: StoredReconfigJob = { ...(await readJob(jobId)).plan, review, plan: review.plan, applied: null };
    await withTenant(app.db, home, user, (tx) =>
      createAiReconfigJob(tx, { id, prompt: 'Tune the levers.', plan: JSON.parse(JSON.stringify(stored)), status: 'review' }),
    );
    const out = await runApply(ctxFor(), { tenantId: home, userId: user, jobId: id, accept: ['lever_tuning'] }, deps());
    expect(out).toMatchObject({ tenantId: home, tenant: 'aa' });
    expect(out.applied).toHaveLength(1);
    expect(out.applied[0]).toMatchObject({ kind: 'lever_tuning', editsCount: 2 });
    const job = await readJob(id);
    expect(job.status).toBe('applied');
    expect(job.changeset_id).toBe(out.applied[0]!.changesetId);
    // The tuning is an ai_reconfig changeset on AA's tenant defaults.
    const cs = await withTenant(app.db, home, user, (tx) =>
      tx.select({ origin: schema.changeset.origin, scenario_id: schema.changeset.scenario_id }).from(schema.changeset).where(sql`${schema.changeset.id} = ${job.changeset_id}`),
    );
    expect(cs).toEqual([{ origin: 'ai_reconfig', scenario_id: null }]);
  });

  it('a job that cannot apply is refused before anything is written (test)', async () => {
    const id = jobUuid();
    await queue(id);
    await expect(runApply(ctxFor(), { tenantId: home, userId: user, jobId: id, accept: ['seed'] }, deps())).rejects.toMatchObject({ code: 'bad_state' });
    await expect(runApply(ctxFor(), { tenantId: home, userId: user, jobId: jobUuid(), accept: ['seed'] }, deps())).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('AI-06 cost guard on pg-local', { timeout: 120_000 }, () => {
  it('AI_MAX_TOKENS_PER_JOB stops the job with status budget_exceeded; the estimate was stored first (test)', async () => {
    const id = jobUuid();
    await queue(id);
    const models: FakeModel[] = [];
    const estimates: unknown[] = [];
    const d = deps({
      env: { AI_MAX_TOKENS_PER_JOB: '3500' },
      tokensPerCall: 1000,
      models,
      onCall: async (_s, n) => {
        if (n === 1) estimates.push((await readJob(id)).plan.estimate);
      },
    });
    const result = await runReconfig(ctxFor(), { tenantId: home, userId: user, jobId: id }, d);
    expect(result.status).toBe('budget_exceeded');

    // 1100 tokens a call: calls 1-3 fit (3300), the fourth takes it to 4400 and stops the job; no fifth.
    expect(models[0]!.calls).toHaveLength(4);
    expect(estimates).toEqual([expect.objectContaining({ maxTokens: 3500, usd: expect.any(Number) })]);
    const job = await readJob(id);
    expect(job.status).toBe('budget_exceeded');
    expect(job.plan.error).toMatchObject({ code: 'budget_exceeded' });
    expect(job.plan.error!.message).toContain('3500');
    expect(job.plan.usage).toMatchObject({ calls: 4, inputTokens: 4000, outputTokens: 400 });
    expect(job.plan.plan).toMatchObject({ intent: 'onboard' }); // what step 1 found is kept
    expect(job.plan.review).toBeNull();
    expect(await objectsOf(home, `${id}/review`)).toEqual([]);
    await expect(runApply(ctxFor(), { tenantId: home, userId: user, jobId: id, accept: ['seed'] }, d)).rejects.toMatchObject({ code: 'bad_state' });
  });

  it('dryRun answers with the plan and the cost estimate, status estimated, nothing else runs (test)', async () => {
    const id = jobUuid();
    await queue(id);
    const models: FakeModel[] = [];
    const result = await runReconfig(ctxFor(), { tenantId: home, userId: user, jobId: id, dryRun: true }, deps({ models }));
    expect(result).toEqual({ jobId: id, status: 'estimated', step: 'scope' });
    expect(models[0]!.calls).toEqual(['scope']);
    const job = await readJob(id);
    expect(job.status).toBe('estimated');
    expect(job.plan.dryRun).toBe(true);
    expect(job.plan.plan).toMatchObject({ tenant: { iataCode: 'ZZ' } });
    expect(job.plan.estimate.usd).toBeGreaterThan(0);
  });

  it('a cancel ends the job cancelled between steps (test)', async () => {
    const id = jobUuid();
    await queue(id);
    const ac = new AbortController();
    const models: FakeModel[] = [];
    const d = deps({ models, onCall: (_s, n) => void (n === 2 && ac.abort()) });
    const result = await runReconfig(ctxFor(ac.signal), { tenantId: home, userId: user, jobId: id }, d);
    expect(result.status).toBe('cancelled');
    expect(models[0]!.calls).toEqual(['scope', 'research']);
    expect((await readJob(id)).status).toBe('cancelled');
  });
});

describe('AI-06 API key on pg-local', { timeout: 120_000 }, () => {
  it('a failure is stored and rethrown without the key; no job row or object holds it (test)', async () => {
    const id = jobUuid();
    await queue(id);
    const d = deps();
    const failing: AiJobDeps = {
      ...d,
      client: ({ jobId: j, audit }) => ({
        run: async () => {
          await audit.put('ai', `${j}/001-scope-response.json`, new TextEncoder().encode('{}'), { contentType: 'application/json' });
          throw new Error(`401 invalid x-api-key ${TEST_KEY}`);
        },
      }),
    };
    const err = (await runReconfig(ctxFor(), { tenantId: home, userId: user, jobId: id }, failing).then(
      () => null,
      (e: unknown) => e,
    )) as Error;
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain('[redacted]');
    expect(err.message).not.toContain(TEST_KEY);
    const job = await readJob(id);
    expect(job.status).toBe('failed');
    expect(job.plan.error!.message).toContain('401 invalid x-api-key [redacted]');
    expect(JSON.stringify(job)).not.toContain(TEST_KEY);
    for (const k of await objectsOf(home, `${id}/`)) {
      const o = await new PostgresObjectStore(app.db, home, user).get('ai', k);
      expect(new TextDecoder().decode(o!.bytes)).not.toContain(TEST_KEY);
    }
  });

  it('a missing key fails the job naming the variable (test)', async () => {
    const id = jobUuid();
    await queue(id);
    const d = deps();
    const noKey: AiJobDeps = { ...d, env: {}, config: () => loadAiConfig({}) };
    await expect(runReconfig(ctxFor(), { tenantId: home, userId: user, jobId: id }, noKey)).rejects.toThrow(/ANTHROPIC_API_KEY/);
    const job = await readJob(id);
    expect(job.status).toBe('failed');
    expect(job.plan.error!.message).toContain('ANTHROPIC_API_KEY');
  });
});

describe('AI-06 migrate --ai-cache on pg-local', { timeout: 180_000 }, () => {
  it('`migrate --ai-cache <dir>` imports a bundle as a review-status ai_reconfig_job with its objects; a rerun changes nothing (test)', async () => {
    // The fixture bundle is what `pnpm ai:rehearse` writes (fake client).
    const dir = join(tmp, 'bundle');
    const rehearsal = await runRehearse({ tenant: 'ua', outDir: dir }, testDeps(f));
    const bundle = readCacheBundle(dir);
    const owner = asRole(instance.url, 'glidepath_owner');

    const first = await runMigrate({ databaseUrl: owner, seed: 'aa', tier3Data, aiCache: dir });
    expect(first.aiCache).toMatchObject({ homeTenant: 'aa', created: true });
    const id = cacheJobId({ homeTenant: 'aa', id: rehearsal.jobId });
    expect(first.aiCache!.jobId).toBe(id);

    const job = await readJob(id);
    expect(job.status).toBe('review');
    expect(job.changeset_id).toBeNull();
    expect(job.plan).toMatchObject({ step: 'review', progress: 1, error: null, applied: null, cache: { bundleId: rehearsal.jobId, rehearsedTenant: 'ua' } });
    expect(job.plan.plan).toEqual(bundle.review.plan);
    expect(ReconfigReview.parse(job.plan.review)).toEqual(bundle.review);
    const row = await withTenant(app.db, home, user, (tx) => getAiReconfigJob(tx, id));
    expect(row!.prompt).toBe(bundle.manifest.prompt);

    const keys = await objectsOf(home, `${id}/`);
    expect(keys).toEqual(expect.arrayContaining([reviewKey(id), usageKey(id), ...bundle.audit.map((a) => `${id}/${a.name}`)]));
    expect(keys.length).toBe(bundle.audit.length + 2);

    // Nothing is overwritten on a rerun, and migrations-only runs ignore the cache.
    const second = await runMigrate({ databaseUrl: owner, seed: 'aa', tier3Data, aiCache: dir });
    expect(second.aiCache).toMatchObject({ jobId: id, created: false });
    expect(second.changes).toBe(0);
    expect((await withTenant(app.db, home, user, (tx) => tx.select({ n: sql<number>`count(*)::int` }).from(schema.ai_reconfig_job).where(sql`${schema.ai_reconfig_job.id} = ${id}`)))[0]!.n).toBe(1);
  });

  it('a bundle for a tenant that was not seeded is refused with the reason (test)', async () => {
    const owner = asRole(instance.url, 'glidepath_owner');
    await expect(runMigrate({ databaseUrl: owner, aiCache: join(tmp, 'bundle'), aiCacheTenant: 'nowhere' })).rejects.toThrow(/tenant nowhere does not exist/);
  });
});
