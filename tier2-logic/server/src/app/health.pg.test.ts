import { createDb } from '@glidepath/data-access';
import { PROBLEM_CONTENT_TYPE, Problem } from '@glidepath/api-contract';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { AUTH_SECRET, captureLogger, unreachableDb } from './testing/fixtures';
import { startCluster } from './testing/pg';
import type { TestCluster } from './testing/pg';
import { startServer } from './start';

let cluster: TestCluster;

beforeAll(async () => {
  cluster = await startCluster('health');
}, 120_000);

afterAll(() => cluster?.stop());

describe('GET /healthz (pg-local)', () => {
  it('returns 200 when the DB answers via DATABASE_URL', async () => {
    const { logger } = captureLogger();
    const db = createDb(cluster.url);
    try {
      const res = await createApp({ logger, db }).request('/healthz');
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ status: 'ok' });
    } finally {
      await db.close();
    }
  });

  it('returns 503 problem JSON when the DB does not answer', async () => {
    const { logger, lines } = captureLogger();
    const db = unreachableDb();
    try {
      const res = await createApp({ logger, db, healthTimeoutMs: 1_000 }).request('/healthz');
      expect(res.status).toBe(503);
      expect(res.headers.get('content-type')).toContain(PROBLEM_CONTENT_TYPE);
      expect(Problem.parse(await res.json()).status).toBe(503);
      expect(lines.some((l) => l.includes('health check failed'))).toBe(true);
    } finally {
      await db.close();
    }
  });

  it('returns 503 when the DB goes away after startup', async () => {
    const own = await startCluster('health-down');
    const { logger } = captureLogger();
    const db = createDb(own.url, { connectionTimeoutMs: 500 });
    const app = createApp({ logger, db, healthTimeoutMs: 1_000 });
    try {
      expect((await app.request('/healthz')).status).toBe(200);
      own.stop();
      expect((await app.request('/healthz')).status).toBe(503);
    } finally {
      await db.close().catch(() => undefined);
    }
  }, 60_000);

  it('startServer listens on PORT, answers /healthz over HTTP and logs only JSON without secrets', async () => {
    const lines: string[] = [];
    const server = await startServer(
      { DATABASE_URL: cluster.url, AUTH_SECRET, PORT: '0', LOG_LEVEL: 'debug' },
      { write: (l) => lines.push(l) },
    );
    try {
      expect(server.port).toBeGreaterThan(0);
      const res = await fetch(`http://127.0.0.1:${server.port}/healthz`);
      expect(res.status).toBe(200);
      const missing = await fetch(`http://127.0.0.1:${server.port}/nope`, { headers: { cookie: 'gp_session=abc123def456' } });
      expect(missing.status).toBe(404);
    } finally {
      await server.close();
    }
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(() => JSON.parse(l)).not.toThrow();
    const all = lines.join('\n');
    expect(all).not.toContain(AUTH_SECRET);
    expect(all).not.toContain('abc123def456');
  });
});
