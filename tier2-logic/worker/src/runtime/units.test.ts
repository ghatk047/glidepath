import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { defaultConcurrency, JOBS_PER_VCPU, workerConfigFromEnv } from './config';
import { jsonLogger } from './logger';
import { HandlerRegistry } from './registry';
import { JobPayloadError, parsePayload } from './run-job';
import { Semaphore } from './semaphore';
import { installShutdownHandlers } from './signals';
import { isQueueName, queueFamily } from './types';

const T = '00000000-0000-4000-8000-000000000010';
const U = '00000000-0000-4000-8000-0000000000e1';
const R = '00000000-0000-4000-8000-000000000099';

describe('config', () => {
  it('JOB_CONCURRENCY defaults to 2 per vCPU and can be set', () => {
    expect(JOBS_PER_VCPU).toBe(2);
    expect(defaultConcurrency(4)).toBe(8);
    expect(workerConfigFromEnv({ DATABASE_URL: 'postgresql://x/y' }, 3).concurrency).toBe(6);
    expect(workerConfigFromEnv({ DATABASE_URL: 'postgresql://x/y', JOB_CONCURRENCY: '' }, 3).concurrency).toBe(6);
    expect(workerConfigFromEnv({ DATABASE_URL: 'postgresql://x/y', JOB_CONCURRENCY: '5' }, 3).concurrency).toBe(5);
  });

  it('requires DATABASE_URL and rejects bad numbers without echoing the URL', () => {
    expect(() => workerConfigFromEnv({})).toThrow(/DATABASE_URL is required/);
    expect(() => workerConfigFromEnv({ DATABASE_URL: 'postgresql://u:secret@x/y', JOB_CONCURRENCY: '0' })).toThrow(/JOB_CONCURRENCY/);
    expect(() => workerConfigFromEnv({ DATABASE_URL: 'postgresql://u:secret@x/y', JOB_CONCURRENCY: 'many' })).toThrow(/positive integer/);
    expect(() => workerConfigFromEnv({ DATABASE_URL: 'postgresql://u:secret@x/y', LOG_LEVEL: 'loud' })).toThrow(/LOG_LEVEL/);
  });

  it('reads the optional owner URL for the pg-boss schema install', () => {
    const c = workerConfigFromEnv({ DATABASE_URL: 'postgresql://app@x/y', DATABASE_URL_MIGRATE: 'postgresql://owner@x/y' });
    expect(c.databaseUrlMigrate).toBe('postgresql://owner@x/y');
    expect(workerConfigFromEnv({ DATABASE_URL: 'postgresql://app@x/y' }).databaseUrlMigrate).toBeNull();
  });
});

describe('registerHandler', () => {
  it('accepts solver.*, excel.* and ai.* queues only, once each', () => {
    const reg = new HandlerRegistry();
    const fn = async (): Promise<void> => undefined;
    reg.registerHandler('solver.min_risk_mix', fn);
    reg.registerHandler('excel.export', fn);
    reg.registerHandler('ai.reconfig', fn);
    expect(reg.queues()).toEqual(['ai.reconfig', 'excel.export', 'solver.min_risk_mix']);
    expect(() => reg.registerHandler('solver.min_risk_mix', fn)).toThrow(/already registered/);
    for (const bad of ['calc', 'solver', 'solver.', 'Solver.x', 'mail.send', 'solver.a b', '']) {
      expect(() => reg.registerHandler(bad, fn)).toThrow(/queue names/);
    }
    expect(() => reg.registerHandler('solver.x', fn, { retryLimit: -1 })).toThrow(/retryLimit/);
    expect(isQueueName('ai.reconfig')).toBe(true);
    expect(queueFamily('excel.import')).toBe('excel');
  });
});

describe('job payload', () => {
  it('needs tenantId and userId, and runId on solver queues', () => {
    expect(parsePayload('excel.export', { tenantId: T, userId: U, file: 'x' }).tenantId).toBe(T);
    expect(parsePayload('solver.x', { tenantId: T, userId: U, runId: R }).runId).toBe(R);
    expect(() => parsePayload('solver.x', { tenantId: T, userId: U })).toThrow(JobPayloadError);
    expect(() => parsePayload('solver.x', { tenantId: 'nope', userId: U, runId: R })).toThrow(/tenantId/);
    expect(() => parsePayload('ai.x', { tenantId: T })).toThrow(/userId/);
    expect(() => parsePayload('ai.x', null)).toThrow(/object/);
    expect(() => parsePayload('ai.x', { tenantId: T, userId: U, runId: 7 })).toThrow(/runId/);
  });
});

describe('semaphore', () => {
  it('holds at most `size` and serves waiters in order; waiters can be rejected', async () => {
    const s = new Semaphore(2);
    const r1 = await s.acquire();
    const r2 = await s.acquire();
    const order: number[] = [];
    const w3 = s.acquire().then((r) => (order.push(3), r));
    const w4 = s.acquire().then((r) => (order.push(4), r));
    await Promise.resolve();
    expect(order).toEqual([]);
    r1();
    const r3 = await w3;
    expect(order).toEqual([3]);
    s.rejectWaiters(new Error('stop'));
    await expect(w4).rejects.toThrow('stop');
    r2();
    r3();
    const r5 = await s.acquire();
    const r6 = await s.acquire();
    r5();
    r6();
  });
});

describe('shutdown wiring', () => {
  it('SIGTERM and SIGINT start one stop, then report the exit code; listeners can be removed', async () => {
    let stops = 0;
    const exits: number[] = [];
    const proc = new EventEmitter();
    const off = installShutdownHandlers(
      { stop: async () => void (stops += 1) },
      (c) => exits.push(c),
      proc as never,
    );
    proc.emit('SIGTERM');
    proc.emit('SIGINT');
    await new Promise((r) => setTimeout(r, 10));
    expect(stops).toBe(1);
    expect(exits).toEqual([0]);
    off();
    expect(proc.listenerCount('SIGTERM')).toBe(0);
    expect(proc.listenerCount('SIGINT')).toBe(0);
  });

  it('a failing stop exits 1', async () => {
    const exits: number[] = [];
    const proc = new EventEmitter();
    installShutdownHandlers({ stop: () => Promise.reject(new Error('x')) }, (c) => exits.push(c), proc as never);
    proc.emit('SIGTERM');
    await new Promise((r) => setTimeout(r, 10));
    expect(exits).toEqual([1]);
  });
});

describe('logger', () => {
  it('writes JSON lines at or above its level', () => {
    const lines: string[] = [];
    const log = jsonLogger('warn', (l) => lines.push(l));
    log.info('quiet');
    log.warn('loud', { runId: 'r' });
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({ level: 'warn', msg: 'loud', runId: 'r', svc: 'worker' });
  });
});
