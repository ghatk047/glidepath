import { PROBLEM_CONTENT_TYPE, Problem, problemTypes } from '@glidepath/api-contract';
import type { UserId } from '@glidepath/api-contract';
import { createDb, sql } from '@glidepath/data-access';
import type { DbHandle } from '@glidepath/data-access';
import type { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { staticMemberships } from './tenant';
import type { AppEnv } from './tenant';
import { aa, aaId, ana, bob, captureLogger } from './testing/fixtures';
import { startCluster } from './testing/pg';
import type { TestCluster } from './testing/pg';

let cluster: TestCluster;
let db: DbHandle;
let app: Hono<AppEnv>;

const asUser = (name: string) => ({ headers: { 'x-test-user': name } });

beforeAll(async () => {
  cluster = await startCluster('tenant');
  db = createDb(cluster.url);
  await db.pool.query('create table scratch (v text)');
  const { logger } = captureLogger();
  app = createApp({
    logger,
    db,
    authenticate: (c) =>
      c.req.header('x-test-user') ? (c.req.header('x-test-user') as UserId) : null,
    // Stubbed membership until DATA-05: ana is an owner of aa, bob belongs to nothing.
    membership: staticMemberships([{ userId: ana, tenantId: aaId, slug: aa, role: 'owner' }]),
  });
  app.get('/api/t/:tenant/whoami', async (c) => {
    const t = c.get('tenant');
    const r = await t.tx.execute<{ tenant: string; user: string }>(
      sql`select current_setting('app.tenant_id') as tenant, current_setting('app.user_id') as "user"`,
    );
    return c.json({ slug: t.slug, role: t.role, ...r.rows[0] });
  });
  app.post('/api/t/:tenant/scratch/:mode', async (c) => {
    await c.get('tenant').tx.execute(sql`insert into scratch (v) values (${c.req.param('mode')})`);
    if (c.req.param('mode') === 'fail') throw new Error('handler failed after writing');
    return c.json({ ok: true });
  });
}, 120_000);

afterAll(async () => {
  await db?.close();
  cluster?.stop();
});

describe('tenant middleware on /api/t/:tenant/*', () => {
  it('resolves membership and runs the handler inside withTenant (SET LOCAL app.tenant_id / app.user_id)', async () => {
    const res = await app.request('/api/t/aa/whoami', asUser(ana));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ slug: 'aa', role: 'owner', tenant: aaId, user: ana });
  });

  it('the settings are transaction-local: gone on the pool after the request', async () => {
    await app.request('/api/t/aa/whoami', asUser(ana));
    const r = await db.pool.query("select current_setting('app.tenant_id', true) as t");
    expect(r.rows[0].t === null || r.rows[0].t === '').toBe(true);
  });

  it('no membership: 404 problem (the tenant is not revealed)', async () => {
    for (const [user, path] of [
      [bob, '/api/t/aa/whoami'],
      [ana, '/api/t/zz/whoami'],
    ] as const) {
      const res = await app.request(path, asUser(user));
      expect(res.status).toBe(404);
      expect(res.headers.get('content-type')).toContain(PROBLEM_CONTENT_TYPE);
      const body = Problem.parse(await res.json());
      expect(body.type).toBe(problemTypes.notFound);
    }
  });

  it('unauthenticated: 401 problem', async () => {
    const res = await app.request('/api/t/aa/whoami');
    expect(res.status).toBe(401);
    expect(Problem.parse(await res.json()).type).toBe(problemTypes.unauthenticated);
  });

  it('with the default stubs nobody is a member of anything', async () => {
    const { logger } = captureLogger();
    const bare = createApp({ logger, db });
    expect((await bare.request('/api/t/aa/whoami', asUser(ana))).status).toBe(401);
  });

  it('commits when the handler succeeds and rolls back when it fails', async () => {
    expect(
      (await app.request('/api/t/aa/scratch/ok', { method: 'POST', ...asUser(ana) })).status,
    ).toBe(200);
    const failed = await app.request('/api/t/aa/scratch/fail', { method: 'POST', ...asUser(ana) });
    expect(failed.status).toBe(500);
    expect(Problem.parse(await failed.json()).status).toBe(500);
    const rows = await db.pool.query('select v from scratch order by v');
    expect(rows.rows.map((r) => r.v)).toEqual(['ok']);
  });
});
