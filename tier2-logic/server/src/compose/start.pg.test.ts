import { WS_SESSION_PATH, assertContract } from '@glidepath/api-contract';
import { connectionConfig, updateSolverRun, withTenant } from '@glidepath/data-access';
import { PgBoss } from './boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// Test wiring only: the worker's installer creates the pg-boss schema and queues as the owner role.
import { installQueueSchema } from '../../../worker/src/runtime/install';
import { startServer } from '../app/start';
import type { RunningServer } from '../app/start';
import { AUTH_SECRET } from '../app/testing/fixtures';
import { CSRF_COOKIE, CSRF_HEADER } from '../auth/cookies';
import type { Mailer } from '../auth/mailer';
import { AA_ID, ANA, MINE, startAaDatabase } from '../routes/read/testing/aa-db';
import type { AaDatabase } from '../routes/read/testing/aa-db';
import { ORIGIN, PUBLIC_BASE_URL } from '../session/testing/harness';
import { openSocket } from '../session/testing/ws-client';

/**
 * API-09 composition (`startServer`): the pg-boss client sends solver jobs to the real queue, the JOB-02 relay
 * pushes their progress to the session of the scenario, and the Excel upload limit comes from IMPORT_MAX_BYTES.
 */

let aa: AaDatabase;
let server: RunningServer;
let appUrl: string;
let boss: PgBoss;
const links: string[] = [];

beforeAll(async () => {
  aa = await startAaDatabase();
  await installQueueSchema({ ownerUrl: aa.database.url, queues: ['solver.min_risk_mix'] });
  const u = new URL(aa.database.adminUrl);
  u.pathname = `/${aa.database.database}`;
  u.searchParams.set('options', '-c role=glidepath_app');
  appUrl = u.toString();
  const mailer: Mailer = { sendMagicLink: async (m) => void links.push(m.link), close: () => undefined };
  server = await startServer(
    { DATABASE_URL: appUrl, AUTH_SECRET, PUBLIC_BASE_URL, PORT: '0', LOG_LEVEL: 'silent', JOB_RELAY_POLL_MS: '50', IMPORT_MAX_BYTES: '64' },
    { mailer },
  );
  boss = new PgBoss({ ...connectionConfig(appUrl), schema: 'pgboss', max: 2, migrate: false, createSchema: false, supervise: false, schedule: false });
  boss.on('error', () => undefined);
  await boss.start();
}, 180_000);

afterAll(async () => {
  await boss?.stop({ graceful: false, close: true }).catch(() => undefined);
  await server?.close();
  await aa?.close();
});

async function signIn(email: string): Promise<{ cookie: string; csrf: string }> {
  const base = `http://127.0.0.1:${server.port}`;
  const before = links.length;
  const res = await fetch(`${base}/api/auth/magic-link`, {
    method: 'POST',
    headers: { origin: ORIGIN, 'content-type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  expect(res.status).toBe(202);
  for (let i = 0; links.length === before && i < 100; i++) await new Promise((r) => setTimeout(r, 20));
  const link = new URL(links[before]!);
  const cb = await fetch(`${base}${link.pathname}${link.search}`, { redirect: 'manual' });
  expect(cb.status).toBe(303);
  const pairs = cb.headers.getSetCookie().map((c) => c.split(';')[0]!);
  const csrf = decodeURIComponent(pairs.find((p) => p.startsWith(`${CSRF_COOKIE}=`))?.slice(CSRF_COOKIE.length + 1) ?? '');
  return { cookie: pairs.join('; '), csrf };
}

describe('startServer composes the job queue, the relay and the Excel limit', () => {
  it('POST solver-runs sends the job to pg-boss, and the session of the scenario hears of it and of its end', async () => {
    const { cookie, csrf } = await signIn('ana@example.test');
    const opened = await openSocket(`ws://127.0.0.1:${server.port}${WS_SESSION_PATH}?tenant=aa&scenario=${MINE}`, { cookie, origin: ORIGIN });
    if (!opened.ok) throw new Error(`handshake refused: ${opened.status} ${opened.body}`);
    const socket = opened.socket;
    // Let the relay take its baseline of the (empty) scenario before the run exists.
    await new Promise((r) => setTimeout(r, 300));

    const res = await fetch(`http://127.0.0.1:${server.port}/api/t/aa/solver-runs`, {
      method: 'POST',
      headers: { cookie, origin: ORIGIN, [CSRF_HEADER]: csrf, 'content-type': 'application/json' },
      body: JSON.stringify({ scenarioId: MINE, spec: { problem: 'min_risk_mix', params: {} } }),
    });
    const run = await assertContract('solverRunStart', res);
    expect(run.status).toBe('queued');

    // The real queue holds the job: tenant, user and run id.
    let job = null;
    for (let i = 0; job === null && i < 40; i++) {
      [job] = await boss.fetch<{ tenantId: string; userId: string; runId: string }>('solver.min_risk_mix');
      if (job === null || job === undefined) await new Promise((r) => setTimeout(r, 100));
    }
    expect(job?.data).toEqual({ tenantId: AA_ID, userId: ANA, runId: run.id });

    const queued = await socket.until((m) => m.type === 'job' && m.id === run.id && m.status === 'queued');
    expect(queued.at(-1)).toMatchObject({ type: 'job', id: run.id, status: 'queued', kind: 'solver' });

    await withTenant(aa.app.db, AA_ID, ANA, (tx) => updateSolverRun(tx, run.id, { status: 'done', progress: 1 }));
    const done = await socket.until((m) => m.type === 'job' && m.id === run.id && m.status === 'done');
    expect(done.at(-1)).toMatchObject({ type: 'job', id: run.id, status: 'done', progress: 1 });
    await socket.close();
  });

  it('IMPORT_MAX_BYTES reaches the upload route: a workbook over it is 413', async () => {
    const { cookie, csrf } = await signIn('ana@example.test');
    const res = await fetch(`http://127.0.0.1:${server.port}/api/t/aa/imports?filename=big.xlsx`, {
      method: 'POST',
      headers: { cookie, origin: ORIGIN, [CSRF_HEADER]: csrf, 'content-type': 'application/octet-stream' },
      body: new Uint8Array(200),
    });
    expect(res.status).toBe(413);
  });
});
