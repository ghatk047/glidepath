import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PROBLEM_CONTENT_TYPE, UserId, assertContract } from '@glidepath/api-contract';
import type { MarketRefreshResult, ReconfigApplyResult, ReconfigJob } from '@glidepath/api-contract';
import { createDb, schema, sql, withTenant } from '@glidepath/data-access';
import type { DbHandle } from '@glidepath/data-access';
import { start, stop } from '@glidepath/pg-local';
import type { PgLocalInstance } from '@glidepath/pg-local';
import type { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cacheJobId, readCacheBundle } from '../../../../worker/src/jobs/ai/cache';
import { runRehearse } from '../../../../worker/src/jobs/ai/rehearse';
import { defaultRehearsePrompt } from '../../../../worker/src/jobs/ai/rehearse';
import { loadFixtures, testDeps } from '../../../../worker/src/jobs/ai/testing/fake-model';
import type { Fixtures } from '../../../../worker/src/jobs/ai/testing/fake-model';
import { findTier3Data } from '../../../../worker/src/seed/files';
import { seedIds } from '../../../../worker/src/seed/ids';
import { runMigrate } from '../../../../worker/src/seed/run';
import { createApp } from '../../app/app';
import type { AppEnv } from '../../app/tenant';
import { dbMemberships } from '../../auth/memberships';
import { captureLogger } from '../../app/testing/fixtures';
import { specBundleFromDir } from '../read/spec-source';
import { workerAiJobs } from './testing/worker-ai-jobs';
import type { WorkerAiJobs } from './testing/worker-ai-jobs';

/**
 * API-11 on pg-local with the AA seed (as compose: roles glidepath_owner / glidepath_app, RLS applies), the real AI-06
 * jobs run in-process with the worker's fake model client (no network, no key) and the Postgres object store. Tests run
 * in order against one database.
 */

const tier3Data = findTier3Data();
const AA = seedIds.tenant('aa');
const ZZ = seedIds.tenant('zz');
const DEMO_EMAIL = 'owner@example.test';
const OWNER = seedIds.user(DEMO_EMAIL);
const EDITOR = seedIds.user('editor@example.test');
const VIEWER = seedIds.user('viewer@example.test');
const STRANGER = seedIds.user('stranger@example.test');
const SYSTEM = seedIds.seedActor();

let instance: PgLocalInstance;
let stateFile: string;
let tmp: string;
let appDb: DbHandle;
let ownerDb: DbHandle;
let ownerUrl: string;
let f: Fixtures;
let worker: WorkerAiJobs;
let app: Hono<AppEnv>;

const asRole = (url: string, role: string): string => {
  const u = new URL(url);
  u.username = role;
  return u.toString();
};
const as = (user: string): { headers: Record<string, string> } => ({ headers: { 'x-test-user': user } });
const post = (path: string, body: unknown, who = OWNER) =>
  app.request(path, { method: 'POST', headers: { ...as(who).headers, 'content-type': 'application/json' }, body: JSON.stringify(body) });
const get = (path: string, who = OWNER) => app.request(path, { headers: as(who).headers });

const inAa = <T>(fn: Parameters<typeof withTenant<T>>[3], tenant = AA) => withTenant(appDb.db, tenant, SYSTEM, fn);
const scalar = async (q: ReturnType<typeof sql>, tenant = AA): Promise<unknown> =>
  inAa(async (tx) => ((await tx.execute<Record<string, unknown>>(q)).rows[0] ?? {}) as Record<string, unknown>, tenant).then((r) => Object.values(r as Record<string, unknown>)[0]);

beforeAll(async () => {
  f = await loadFixtures();
  tmp = mkdtempSync(join(tmpdir(), 'gp-api11-'));
  stateFile = join(tmpdir(), `gp-api11-${process.pid}.json`);
  instance = await start({ stateFile, init: resolve(tier3Data, 'postgres/init') });
  ownerUrl = asRole(instance.url, 'glidepath_owner');
  await runMigrate({ databaseUrl: ownerUrl, seed: 'aa', tier3Data, demoUserEmail: DEMO_EMAIL });
  appDb = createDb(asRole(instance.url, 'glidepath_app'));
  ownerDb = createDb(ownerUrl);
  // Other members of AA: an editor and a viewer; a stranger who belongs to nothing.
  await ownerDb.db.insert(schema.app_user).values([
    { id: EDITOR, email: 'editor@example.test', name: 'Edith' },
    { id: VIEWER, email: 'viewer@example.test', name: 'Vic' },
    { id: STRANGER, email: 'stranger@example.test', name: 'Sam' },
  ]);
  await withTenant(ownerDb.db, AA, SYSTEM, (tx) =>
    tx.insert(schema.tenant_membership).values([
      { tenant_id: AA, user_id: EDITOR, role: 'editor' },
      { tenant_id: AA, user_id: VIEWER, role: 'viewer' },
    ]),
  );
  worker = workerAiJobs(appDb, f);
  const { logger } = captureLogger();
  app = createApp({
    logger,
    db: appDb,
    authenticate: (c: { req: { header(n: string): string | undefined } }) => {
      const u = c.req.header('x-test-user');
      return u ? UserId.parse(u) : null;
    },
    membership: dbMemberships(appDb.db),
    specBundle: specBundleFromDir(),
    ai: { jobs: worker.jobs, objects: worker.objects },
  });
}, 300_000);

afterAll(async () => {
  await appDb?.close();
  await ownerDb?.close();
  if (instance) stop({ instance, stateFile });
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

const PROMPT = 'Set up Example Air as a new tenant.';

describe('API-11 AI reconfig routes', { timeout: 180_000 }, () => {
  let started: ReconfigJob;
  let finished: ReconfigJob;

  it('POST reconfig returns a cost estimate and job id; GET returns plan, sources, draft summaries, calibration, open questions; apply (owner only) -> applyChangeset origin=ai_reconfig (fake model client) (test)', async () => {
    const res = await post('/api/ai/reconfig', { prompt: PROMPT, tenant: null });
    started = await assertContract('aiReconfigStart', res);
    expect(started.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(started.costEstimate.model).not.toBe('pending');
    expect(started.costEstimate.usd).toBeGreaterThan(0);
    expect(started.costEstimate.maxTokens).toBeGreaterThan(1);
    expect(started.prompt).toBe(PROMPT);
    expect(started.createdBy).toBe(OWNER);
    expect(res.headers.get('cache-control')).toBe('private, no-store');

    await worker.settled();
    expect(worker.models[0]!.calls[0]).toBe('scope');
    finished = await assertContract('aiReconfigGet', await get(`/api/ai/reconfig/${started.id}`));
    expect(finished).toMatchObject({ id: started.id, status: 'review', step: 'review', progress: 1, error: null, tenant: null });
    expect(finished.plan).toMatchObject({ mode: 'new_tenant', tenant: { name: 'Example Air', monogram: 'ZZ', slug: 'zz' } });
    expect(finished.plan!.steps.length).toBeGreaterThan(3);
    expect(finished.facts.length).toBeGreaterThan(0);
    expect(finished.drafts.map((d) => d.kind)).toEqual(['seed', 'lever_tuning']);
    expect(finished.drafts[0]!.changes).toBeGreaterThan(0);
    expect(finished.drafts[1]!.changes).toBe(2);
    expect(finished.calibration).toMatchObject({ passed: true, repairRounds: 0 });
    expect(finished.calibration!.lines.length).toBeGreaterThan(0);
    expect(finished.calibration!.lines.every((l) => l.ok)).toBe(true);
    expect(finished.usage!.inputTokens).toBeGreaterThan(0);
    expect(Array.isArray(finished.sources)).toBe(true);
    expect(Array.isArray(finished.openQuestions)).toBe(true);
    expect(finished.updatedAt >= finished.createdAt).toBe(true);
    // Nothing is written before apply: the new tenant does not exist.
    expect(await inAa((tx) => tx.select({ id: schema.tenant.id }).from(schema.tenant), ZZ)).toEqual([]);

    // Apply is owner only: an editor, a viewer and a stranger are refused; nothing is written.
    const asEditor = await post(`/api/ai/reconfig/${started.id}/apply`, { drafts: ['seed'] }, EDITOR);
    expect(asEditor.status).toBe(403);
    expect(asEditor.headers.get('content-type')).toContain(PROBLEM_CONTENT_TYPE);
    expect((await post(`/api/ai/reconfig/${started.id}/apply`, { drafts: ['seed'] }, VIEWER)).status).toBe(403);
    expect((await post(`/api/ai/reconfig/${started.id}/apply`, { drafts: ['seed'] }, STRANGER)).status).toBe(404);
    expect((await get(`/api/ai/reconfig/${started.id}`, STRANGER)).status).toBe(404);
    expect((await get(`/api/ai/reconfig/${started.id}`, EDITOR)).status).toBe(200); // members may read
    expect((await app.request(`/api/ai/reconfig/${started.id}`)).status).toBe(401);
    expect(await inAa((tx) => tx.select({ id: schema.tenant.id }).from(schema.tenant), ZZ)).toEqual([]);

    // A new tenant needs its seed.
    const noSeed = await post(`/api/ai/reconfig/${started.id}/apply`, { drafts: ['lever_tuning'] });
    expect(noSeed.status).toBe(422);

    const ok = await post(`/api/ai/reconfig/${started.id}/apply`, { drafts: ['seed', 'lever_tuning'], clientRequestId: 'api11-apply-1' });
    const applied: ReconfigApplyResult = await assertContract('aiReconfigApply', ok);
    expect(applied).toMatchObject({ jobId: started.id, tenantId: ZZ, tenant: 'zz' });
    expect(applied.applied.map((a) => a.kind)).toEqual(['seed', 'lever_tuning']);
    expect(applied.applied.map((a) => a.editsCount)).toEqual([finished.drafts[0]!.changes, finished.drafts[1]!.changes]);

    // Every changeset of the new tenant went through applyChangeset: the AI's own are origin ai_reconfig.
    const origins = await inAa(
      async (tx) => (await tx.select({ origin: schema.changeset.origin, id: schema.changeset.id }).from(schema.changeset)),
      ZZ,
    );
    expect(new Set(origins.map((o) => o.origin))).toEqual(new Set(['ai_reconfig', 'seed']));
    expect(origins.map((o) => o.id)).toEqual(expect.arrayContaining(applied.applied.map((a) => a.changesetId)));
    const tuning = origins.find((o) => o.id === applied.applied[1]!.changesetId);
    expect(tuning!.origin).toBe('ai_reconfig');
    expect(await scalar(sql`select count(*)::int as n from tenant_membership where role = 'owner'`, ZZ)).toBe(1);

    const after = await assertContract('aiReconfigGet', await get(`/api/ai/reconfig/${started.id}`));
    expect(after.status).toBe('applied');
    // A repeat answers the stored result; it does not apply twice.
    const again = await assertContract('aiReconfigApply', await post(`/api/ai/reconfig/${started.id}/apply`, { drafts: ['seed'] }));
    expect(again).toEqual(applied);
  });

  it('dryRun answers estimated with the plan and the cost estimate; the step-1 call is the only one (test)', async () => {
    const before = worker.models.length;
    const res = await post('/api/ai/reconfig', { prompt: 'Plan another airline please, Example Air again.', tenant: null, dryRun: true });
    const job = await assertContract('aiReconfigStart', res);
    expect(job).toMatchObject({ status: 'estimated', step: 'scope' });
    expect(job.plan).toMatchObject({ mode: 'new_tenant', tenant: { monogram: 'ZZ' } });
    expect(job.costEstimate.usd).toBeGreaterThan(0);
    expect(job.drafts).toEqual([]);
    expect(worker.models.length).toBe(before + 1);
    expect(worker.models[before]!.calls).toEqual(['scope']);
  });

  it('a job that is not in review cannot be applied; a tenant named in the request must be one the caller owns (test)', async () => {
    const estimated = await assertContract('aiReconfigStart', await post('/api/ai/reconfig', { prompt: 'Just the plan for Example Air.', tenant: null, dryRun: true }));
    const refused = await post(`/api/ai/reconfig/${estimated.id}/apply`, { drafts: ['seed'] });
    expect(refused.status).toBe(409);
    expect((await post('/api/ai/reconfig', { prompt: 'Tune aa', tenant: 'aa' }, EDITOR)).status).toBe(403);
    expect((await post('/api/ai/reconfig', { prompt: 'Tune nowhere', tenant: 'nowhere' })).status).toBe(404);
    expect((await post('/api/ai/reconfig', { prompt: 'No tenant of mine', tenant: null }, VIEWER)).status).toBe(403);
    expect((await post('/api/ai/reconfig', { prompt: '   ', tenant: null })).status).toBeGreaterThanOrEqual(400);
    expect((await get('/api/ai/reconfig/00000000-0000-4000-8000-0000000000ff')).status).toBe(404);
    expect((await get('/api/ai/reconfig/not-a-uuid')).status).toBe(404);
  });

  it('the cached UA rehearsal is returned when present, without a job or a model call (test)', async () => {
    // What `pnpm ai:rehearse --tenant ua` writes (fake client), imported as `migrate --ai-cache` does.
    const dir = join(tmp, 'bundle');
    const rehearsal = await runRehearse({ tenant: 'ua', outDir: dir }, testDeps(f));
    const bundle = readCacheBundle(dir);
    await runMigrate({ databaseUrl: ownerUrl, seed: 'aa', tier3Data, aiCache: dir });
    const cachedId = cacheJobId({ homeTenant: 'aa', id: rehearsal.jobId });

    const jobsBefore = Number(await scalar(sql`select count(*)::int as n from ai_reconfig_job`));
    const modelsBefore = worker.models.length;
    // The same prompt, and a looser one that names the rehearsed airline.
    for (const prompt of [defaultRehearsePrompt('ua'), `Please onboard ${bundle.review.plan.tenant.name} for the demo`]) {
      const res = await post('/api/ai/reconfig', { prompt, tenant: null });
      const job = await assertContract('aiReconfigStart', res);
      expect(job.id).toBe(cachedId);
      expect(job).toMatchObject({ status: 'review', step: 'review', error: null, prompt: bundle.manifest.prompt });
      expect(job.createdAt).toBe(bundle.manifest.createdAt);
      expect(job.drafts.map((d) => d.kind)).toEqual(['seed', 'lever_tuning']);
      expect(job.calibration).toMatchObject({ passed: true });
      expect(job.plan!.tenant.monogram).toBe(bundle.review.plan.tenant.iataCode);
    }
    expect(Number(await scalar(sql`select count(*)::int as n from ai_reconfig_job`))).toBe(jobsBefore);
    expect(worker.models.length).toBe(modelsBefore);
    // It reads back like any job, and an unrelated prompt starts a real one.
    const read = await assertContract('aiReconfigGet', await get(`/api/ai/reconfig/${cachedId}`));
    expect(read.id).toBe(cachedId);
    const other = await assertContract('aiReconfigStart', await post('/api/ai/reconfig', { prompt: 'Something else entirely', tenant: null, dryRun: true }));
    expect(other.id).not.toBe(cachedId);
  });
});

describe('API-11 market refresh route', { timeout: 120_000 }, () => {
  const url = '/api/t/aa/market/refresh';
  let brentMember: string;
  let brentNow: number;
  let priceNow: number;
  let crackMember: string;
  let crackNow: number;

  const defaultValue = async (key: string, member: string): Promise<number> =>
    Number(await scalar(sql`select value from variable_value where var_key = ${key} and member_key = ${member}`));

  beforeAll(async () => {
    const pick = async (key: string): Promise<[string, number]> => {
      const row = (await inAa((tx) => tx.execute<{ member_key: string; value: string }>(sql`select member_key, value from variable_value where var_key = ${key} order by member_key limit 1`))).rows[0]!;
      return [row.member_key, Number(row.value)];
    };
    [brentMember, brentNow] = await pick('corp.brent');
    [crackMember, crackNow] = await pick('corp.crack');
    priceNow = await defaultValue('corp.price_now', '');
  });

  it('POST market/refresh stores a market_snapshot row and applies it (share price, Brent, crack) as a changeset origin=market (market_refresh) from a typed payload; no live feed (test)', async () => {
    const values = [
      { var: 'corp.price_now', member: '', value: priceNow + 1 },
      { var: 'corp.brent', member: brentMember, value: brentNow + 2 },
      { var: 'corp.crack', member: crackMember, value: crackNow + 1 },
    ];
    const res = await post(url, { source: 'manual', asOf: '2026-12-01', values, clientRequestId: 'api11-market-1' });
    const out: MarketRefreshResult = await assertContract('marketRefresh', res);
    expect(out.asOf).toBe('2026-12-01');
    expect(out.source).toContain('Manual entry');
    expect(out.changesetId).not.toBeNull();
    expect(out.values).toEqual([
      { var: 'corp.price_now', member: '', from: priceNow, to: priceNow + 1 },
      { var: 'corp.brent', member: brentMember, from: brentNow, to: brentNow + 2 },
      { var: 'corp.crack', member: crackMember, from: crackNow, to: crackNow + 1 },
    ]);

    // The snapshot row points at the changeset; the changeset is origin market_refresh on the tenant defaults.
    const snap = await inAa((tx) => tx.select().from(schema.market_snapshot));
    expect(snap).toHaveLength(1);
    expect(snap[0]).toMatchObject({ id: out.snapshotId, as_of: '2026-12-01', applied_changeset_id: out.changesetId });
    expect(snap[0]!.payload).toMatchObject({ source: 'manual', values: out.values });
    const cs = await inAa((tx) => tx.select({ origin: schema.changeset.origin, scenario_id: schema.changeset.scenario_id, created_by: schema.changeset.created_by }).from(schema.changeset).where(sql`${schema.changeset.id} = ${out.changesetId}`));
    expect(cs).toEqual([{ origin: 'market_refresh', scenario_id: null, created_by: OWNER }]);
    expect(await defaultValue('corp.price_now', '')).toBe(priceNow + 1);
    expect(await defaultValue('corp.brent', brentMember)).toBe(brentNow + 2);
    expect(await defaultValue('corp.crack', crackMember)).toBe(crackNow + 1);
    expect(await scalar(sql`select count(*)::int as n from change where changeset_id = ${out.changesetId}`)).toBe(3);

    // A replay of the same request answers the same snapshot and writes nothing.
    const replay = await assertContract('marketRefresh', await post(url, { source: 'manual', asOf: '2026-12-01', values, clientRequestId: 'api11-market-1' }));
    expect(replay.snapshotId).toBe(out.snapshotId);
    expect(replay.changesetId).toBe(out.changesetId);
    expect(await inAa((tx) => tx.select({ id: schema.market_snapshot.id }).from(schema.market_snapshot))).toHaveLength(1);
  });

  it('values that change nothing store a snapshot and no changeset; a feed request is 501; non-market inputs and duplicates are 422 (test)', async () => {
    const same = await assertContract(
      'marketRefresh',
      await post(url, { source: 'manual', asOf: '2026-12-02', values: [{ var: 'corp.price_now', member: '', value: priceNow + 1 }] }),
    );
    expect(same.changesetId).toBeNull();
    expect(same.values).toEqual([{ var: 'corp.price_now', member: '', from: priceNow + 1, to: priceNow + 1 }]);
    expect(await inAa((tx) => tx.select({ id: schema.market_snapshot.id }).from(schema.market_snapshot))).toHaveLength(2);

    const feed = await post(url, { source: 'feed' });
    expect(feed.status).toBe(501);
    expect(feed.headers.get('content-type')).toContain(PROBLEM_CONTENT_TYPE);
    const notMarket = await post(url, { source: 'manual', asOf: '2026-12-02', values: [{ var: 'g.target_net', member: '', value: 100 }] });
    expect(notMarket.status).toBe(422);
    const dup = await post(url, { source: 'manual', asOf: '2026-12-02', values: [{ var: 'corp.price_now', member: '', value: 10 }, { var: 'corp.price_now', member: '', value: 11 }] });
    expect(dup.status).toBe(422);
    expect(await inAa((tx) => tx.select({ id: schema.market_snapshot.id }).from(schema.market_snapshot))).toHaveLength(2);
  });

  it('needs the editor or owner role; a stranger sees no such tenant (test)', async () => {
    const body = { source: 'manual', asOf: '2026-12-03', values: [{ var: 'corp.price_now', member: '', value: priceNow + 2 }] };
    expect((await post(url, body, VIEWER)).status).toBe(403);
    expect((await post(url, body, STRANGER)).status).toBe(404);
    expect((await post(url, body, EDITOR)).status).toBe(201);
  });
});
