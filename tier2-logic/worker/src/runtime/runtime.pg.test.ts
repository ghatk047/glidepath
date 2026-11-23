import { createSolverRun, getSolverRun, listSolverRuns, updateSolverRun, withTenant } from '@glidepath/data-access';
import type { SolverRunRecord } from '@glidepath/data-access';
import { EventEmitter } from 'node:events';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { enqueueJob } from './enqueue';
import { HandlerRegistry } from './registry';
import { startWorker } from './runtime';
import type { WorkerRuntime } from './runtime';
import { installShutdownHandlers } from './signals';
import { FakeClock } from './testing/fake-clock';
import { Gate, SCENARIO_A, SCENARIO_B, TENANT_A, TENANT_B, USER_A, USER_B, startJobDatabase, waitFor } from './testing/job-db';
import type { JobDatabase } from './testing/job-db';

/** JOB-01 acceptance on pg-local: pg-boss consumers, progress, cancel, drain, tenancy. */

let jdb: JobDatabase;
const running: WorkerRuntime[] = [];

beforeAll(async () => {
  jdb = await startJobDatabase();
}, 180_000);

afterEach(async () => {
  await Promise.all(running.splice(0).map((r) => r.stop().catch(() => undefined)));
});

afterAll(async () => {
  await jdb?.close();
});

async function boot(registry: HandlerRegistry, extra: Partial<Parameters<typeof startWorker>[0]> = {}): Promise<WorkerRuntime> {
  const rt = await startWorker({
    databaseUrl: jdb.appUrl,
    registry,
    pollMs: 500,
    cancelPollMs: 100,
    shutdownTimeoutMs: 10_000,
    ...extra,
  });
  running.push(rt);
  return rt;
}

type Who = 'a' | 'b';
const who = (w: Who) => (w === 'a' ? { tenant: TENANT_A, user: USER_A, scenario: SCENARIO_A } : { tenant: TENANT_B, user: USER_B, scenario: SCENARIO_B });

async function newRun(w: Who = 'a'): Promise<SolverRunRecord> {
  const t = who(w);
  return withTenant(jdb.app.db, t.tenant, t.user, (tx) =>
    createSolverRun(tx, { kind: 'monte_carlo', scenario_id: t.scenario, spec: { problem: 'test' } }),
  );
}

const readRun = async (run: SolverRunRecord, w: Who = 'a'): Promise<SolverRunRecord> => {
  const t = who(w);
  return (await withTenant(jdb.app.db, t.tenant, t.user, (tx) => getSolverRun(tx, run.id)))!;
};

const waitStatus = (run: SolverRunRecord, status: SolverRunRecord['status'], w: Who = 'a'): Promise<SolverRunRecord> =>
  waitFor(async () => {
    const r = await readRun(run, w);
    return r.status === status ? r : null;
  });

const send = (rt: WorkerRuntime, queue: string, run: SolverRunRecord | null, w: Who = 'a', extra: Record<string, unknown> = {}) =>
  enqueueJob(rt.boss, queue, { tenantId: who(w).tenant, userId: who(w).user, ...(run ? { runId: run.id } : {}), ...extra });

describe('JOB-01 worker runtime on pg-boss', () => {
  it('consumes solver.*, excel.*, ai.* with concurrency JOB_CONCURRENCY over all queues', async () => {
    const reg = new HandlerRegistry();
    const gate = new Gate();
    let active = 0;
    let max = 0;
    const seen: string[] = [];
    const handler = (queue: string) => async (): Promise<void> => {
      seen.push(queue);
      active += 1;
      max = Math.max(max, active);
      await gate.opened;
      active -= 1;
    };
    reg.registerHandler('solver.test', handler('solver.test'));
    reg.registerHandler('excel.test', handler('excel.test'));
    reg.registerHandler('ai.test', handler('ai.test'));
    const rt = await boot(reg, { concurrency: 3 });
    expect(rt.consuming).toEqual(['ai.test', 'excel.test', 'solver.test']);

    const runs = [await newRun(), await newRun(), await newRun(), await newRun()];
    for (const r of runs) await send(rt, 'solver.test', r);
    await send(rt, 'excel.test', null);
    await send(rt, 'ai.test', null);

    await waitFor(async () => active === 3);
    await new Promise((r) => setTimeout(r, 1500)); // the other three jobs must keep waiting
    expect(active).toBe(3);
    expect(max).toBe(3);
    gate.open();
    await waitFor(async () => seen.length === 6);
    expect(new Set(seen)).toEqual(new Set(['solver.test', 'excel.test', 'ai.test']));
    for (const r of runs) expect((await waitStatus(r, 'done')).progress).toBe(1);
    expect(max).toBe(3);
  }, 60_000);

  it('runs a solver job: running, result stored, done with progress 1; a failing handler ends failed', async () => {
    const reg = new HandlerRegistry();
    const seenStatus: string[] = [];
    reg.registerHandler('solver.test', async (ctx) => {
      const row = await ctx.withTenant((tx) => getSolverRun(tx, ctx.payload.runId!));
      seenStatus.push(row!.status);
      if (ctx.payload.boom === true) throw new Error('solver exploded');
      return { value: 42 };
    });
    const rt = await boot(reg);
    const ok = await newRun();
    const bad = await newRun();
    await send(rt, 'solver.test', ok);
    await send(rt, 'solver.test', bad, 'a', { boom: true });
    const done = await waitStatus(ok, 'done');
    expect(done.result).toEqual({ value: 42 });
    expect(done.progress).toBe(1);
    const failed = await waitStatus(bad, 'failed');
    expect(failed.result).toEqual({ error: 'solver exploded' });
    expect(seenStatus).toEqual(['running', 'running']);
  }, 60_000);

  it('writes progress to solver_run.progress at most every 250 ms (fake clock in the runtime)', async () => {
    const clock = new FakeClock();
    const reg = new HandlerRegistry();
    const reported = new Gate();
    const proceed = new Gate();
    const second = new Gate();
    reg.registerHandler('solver.test', async (ctx) => {
      ctx.progress(0.1, 'first');
      ctx.progress(0.2, 'second');
      ctx.progress(0.3, 'third');
      reported.open();
      await proceed.opened;
      ctx.progress(0.9, 'last');
      second.open();
      await new Promise((r) => setTimeout(r, 400)); // let the throttled write land before the job ends
    });
    const rt = await boot(reg, { clock, cancelPollMs: 60_000 });
    const run = await newRun();
    await send(rt, 'solver.test', run);
    await reported.opened;
    const first = await waitFor(async () => {
      const r = await readRun(run);
      return r.progress === 0.1 ? r : null;
    });
    expect(first.progress_note).toBe('first');
    await new Promise((r) => setTimeout(r, 300));
    expect((await readRun(run)).progress).toBeCloseTo(0.1, 5); // 0.2 and 0.3 wait for the window to end
    clock.advance(250);
    const merged = await waitFor(async () => {
      const r = await readRun(run);
      return r.progress > 0.25 ? r : null;
    });
    expect(merged.progress).toBeCloseTo(0.3, 5); // the latest value, written once
    expect(merged.progress_note).toBe('third');
    proceed.open();
    await second.opened;
    clock.advance(250);
    const last = await waitFor(async () => {
      const r = await readRun(run);
      return r.progress > 0.5 ? r : null;
    });
    expect(last.progress).toBeCloseTo(0.9, 5);
    await waitStatus(run, 'done');
  }, 60_000);

  it('cancel: cancel_requested = true fires the handler AbortSignal and the run ends cancelled', async () => {
    const reg = new HandlerRegistry();
    const started = new Gate();
    let signalReason: unknown;
    let batches = 0;
    reg.registerHandler('solver.test', async (ctx) => {
      started.open();
      while (!ctx.signal.aborted) {
        batches += 1;
        await new Promise((r) => setTimeout(r, 20));
      }
      signalReason = ctx.signal.reason;
      return { partial: batches > 0 };
    });
    const rt = await boot(reg);
    const run = await newRun();
    await send(rt, 'solver.test', run);
    await started.opened;
    await waitStatus(run, 'running');
    await withTenant(jdb.app.db, TENANT_A, USER_A, (tx) => updateSolverRun(tx, run.id, { cancel_requested: true }));
    const cancelled = await waitStatus(run, 'cancelled');
    expect(cancelled.cancel_requested).toBe(true);
    expect(cancelled.result).toEqual({ partial: true });
    expect((signalReason as Error).name).toBe('JobCancelledError');
  }, 60_000);

  it('cancel is also seen on a progress write, and a run cancelled before it starts is not run', async () => {
    const clock = new FakeClock(); // no polling at all: only the progress write can notice
    const reg = new HandlerRegistry();
    const started = new Gate();
    let ran = 0;
    reg.registerHandler('solver.test', async (ctx) => {
      ran += 1;
      started.open();
      await new Promise<void>((resolve) => {
        const tick = setInterval(() => {
          ctx.progress(Math.random());
          clock.advance(250);
        }, 30);
        ctx.signal.addEventListener('abort', () => {
          clearInterval(tick);
          resolve();
        });
      });
    });
    const rt = await boot(reg, { clock });
    const run = await newRun();
    await send(rt, 'solver.test', run);
    await started.opened;
    await withTenant(jdb.app.db, TENANT_A, USER_A, (tx) => updateSolverRun(tx, run.id, { cancel_requested: true }));
    await waitStatus(run, 'cancelled');

    const early = await newRun();
    await withTenant(jdb.app.db, TENANT_A, USER_A, (tx) => updateSolverRun(tx, early.id, { cancel_requested: true }));
    await send(rt, 'solver.test', early);
    await waitStatus(early, 'cancelled');
    expect(ran).toBe(1);
  }, 60_000);

  it('SIGTERM drains in-flight jobs: the job finishes and is recorded before the worker exits', async () => {
    const reg = new HandlerRegistry();
    const started = new Gate();
    const release = new Gate();
    reg.registerHandler('solver.test', async (ctx) => {
      started.open();
      await release.opened;
      ctx.progress(0.5);
      return { drained: true };
    });
    const rt = await boot(reg);
    const run = await newRun();
    await send(rt, 'solver.test', run);
    await started.opened;

    const proc = new EventEmitter();
    const exits: number[] = [];
    installShutdownHandlers(rt, (code) => exits.push(code), proc as never);
    proc.emit('SIGTERM');
    proc.emit('SIGTERM'); // a second signal must not start a second stop
    await new Promise((r) => setTimeout(r, 1500));
    expect(exits).toEqual([]); // still draining
    expect((await readRun(run)).status).toBe('running');

    release.open();
    await waitFor(async () => exits.length === 1);
    expect(exits).toEqual([0]);
    const after = await readRun(run);
    expect(after.status).toBe('done');
    expect(after.result).toEqual({ drained: true });
  }, 60_000);

  it('after the drain timeout the signal fires and the run ends failed', async () => {
    const reg = new HandlerRegistry();
    const started = new Gate();
    reg.registerHandler('solver.test', async (ctx) => {
      started.open();
      await new Promise<void>((resolve) => ctx.signal.addEventListener('abort', () => resolve()));
      return { late: true };
    });
    const rt = await boot(reg, { shutdownTimeoutMs: 1000 });
    const run = await newRun();
    await send(rt, 'solver.test', run);
    await started.opened;
    await rt.stop();
    const after = await readRun(run);
    expect(after.status).toBe('failed');
    expect(after.progress_note).toBe('worker stopped before the run finished');
  }, 60_000);

  it('each job runs inside withTenant for its tenant: other tenant rows are invisible', async () => {
    const reg = new HandlerRegistry();
    const visible = new Map<string, string[]>();
    reg.registerHandler('solver.test', async (ctx) => {
      const rows = await ctx.withTenant((tx) => listSolverRuns(tx));
      visible.set(ctx.tenantId, rows.map((r) => r.id).sort());
      // a run id of the other tenant cannot be read nor changed from this job
      const otherId = ctx.payload.otherRunId as string;
      const other = await ctx.withTenant((tx) => getSolverRun(tx, otherId));
      const changed = await ctx.withTenant((tx) => updateSolverRun(tx, otherId, { progress_note: 'hijacked' }));
      return { sawOther: other !== null, changedOther: changed !== null };
    });
    const rt = await boot(reg);
    const a1 = await newRun('a');
    const a2 = await newRun('a');
    const b1 = await newRun('b');
    await send(rt, 'solver.test', a1, 'a', { otherRunId: b1.id });
    await send(rt, 'solver.test', b1, 'b', { otherRunId: a2.id });
    const doneA = await waitStatus(a1, 'done', 'a');
    const doneB = await waitStatus(b1, 'done', 'b');
    expect(doneA.result).toEqual({ sawOther: false, changedOther: false });
    expect(doneB.result).toEqual({ sawOther: false, changedOther: false });
    expect(visible.get(TENANT_A)).toEqual(expect.arrayContaining([a1.id, a2.id]));
    expect(visible.get(TENANT_A)).not.toContain(b1.id);
    expect(visible.get(TENANT_B)).toContain(b1.id);
    expect(visible.get(TENANT_B)).not.toContain(a1.id);
    expect((await readRun(a2)).progress_note).toBeNull();
    expect((await readRun(b1, 'b')).progress_note).toBeNull();
  }, 60_000);

  it('a job for a run its tenant does not have fails and nothing else changes', async () => {
    const reg = new HandlerRegistry();
    let ran = 0;
    reg.registerHandler('solver.test', async () => {
      ran += 1;
    });
    const rt = await boot(reg);
    const foreign = await newRun('b');
    const id = await send(rt, 'solver.test', foreign, 'a'); // tenant a, run of tenant b
    await waitFor(async () => {
      const [job] = await rt.boss.findJobs('solver.test', { id: id! });
      return job?.state === 'failed' ? job : null;
    });
    expect(ran).toBe(0);
    expect((await readRun(foreign, 'b')).status).toBe('queued');
  }, 60_000);
});
