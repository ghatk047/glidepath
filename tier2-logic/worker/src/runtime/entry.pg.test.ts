import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startJobDatabase } from './testing/job-db';
import type { JobDatabase } from './testing/job-db';

/** The worker entry (src/worker.ts, built to dist/worker.js): starts on DATABASE_URL and exits 0 on SIGTERM. */

let jdb: JobDatabase;
beforeAll(async () => {
  jdb = await startJobDatabase();
}, 180_000);
afterAll(async () => {
  await jdb?.close();
});

describe('worker entry', () => {
  it('connects with DATABASE_URL, starts pg-boss, and a SIGTERM stops it with exit code 0', async () => {
    const entry = fileURLToPath(new URL('../worker.ts', import.meta.url));
    const child = spawn(process.execPath, ['--import', 'tsx', entry], {
      env: { ...process.env, DATABASE_URL: jdb.appUrl, JOB_CONCURRENCY: '3', LOG_LEVEL: 'info', DATABASE_URL_MIGRATE: jdb.database.url },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d: Buffer) => (out += d.toString()));
    child.stderr.on('data', (d: Buffer) => (err += d.toString()));
    const exited = new Promise<number | null>((resolve) => child.on('exit', (code) => resolve(code)));
    const started = Date.now();
    while (!out.includes('worker started') && Date.now() - started < 30_000) {
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(out, err).toContain('worker started');
    expect(JSON.parse(out.split('\n').find((l) => l.includes('worker started'))!)).toMatchObject({ concurrency: 3 });
    child.kill('SIGTERM');
    expect(await exited).toBe(0);
    expect(out).toContain('worker stopped');
    expect(out + err).not.toContain(jdb.appUrl);
  }, 60_000);
});
