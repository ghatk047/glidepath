import type { ScenarioId, TenantId, UserId } from '@glidepath/api-contract';
import { createSolverRun, getSolverRun, listSolverRuns, updateSolverRun } from '@glidepath/data-access';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bindWithTenant } from '../app/tenant';
import { AA_ID, ANA, presetId } from '../routes/read/testing/aa-db';
import { startSessionHarness } from '../session/testing/harness';
import type { SessionHarness } from '../session/testing/harness';
import type { TestSocket } from '../session/testing/ws-client';
import { createJobRelay, dbJobSource } from './relay';
import type { JobRelay } from './relay';
import { createSolverSubmitter } from './submit';

/** JOB-02 over pg-local (tenant `aa`, app role, RLS) and real sockets. */

let h: SessionHarness;
let relay: JobRelay;
const sockets: TestSocket[] = [];
const tenantId = AA_ID as TenantId;
const userId = ANA as UserId;
const C = presetId('C');
const A = presetId('A');
let withTenant: ReturnType<typeof bindWithTenant>;

beforeAll(async () => {
  h = await startSessionHarness();
  withTenant = bindWithTenant(h.aa.app.db);
  relay = createJobRelay({ targets: () => h.hub.sessions, source: dbJobSource(withTenant), intervalMs: 100 });
}, 180_000);

afterAll(async () => {
  await relay?.stop();
  for (const s of sockets) await s.close();
  await h?.close();
});

describe('JobRelay over the session hub', () => {
  it('job updates reach every session of that tenant/scenario as `job` messages within 500 ms by polling solver_run (no LISTEN/NOTIFY)', async () => {
    const cookie = await h.login('ana@example.test');
    const [one, two, elsewhere] = await Promise.all([
      h.open({ cookie, scenario: C }),
      h.open({ cookie, scenario: C }),
      h.open({ cookie, scenario: A }),
    ]);
    sockets.push(one, two, elsewhere);
    relay.start();
    // Let the baseline tick pass, then the worker's writes appear in solver_run.
    await new Promise((r) => setTimeout(r, 250));
    const created = await withTenant(tenantId, userId, (tx) =>
      createSolverRun(tx, { kind: 'optimize', scenario_id: C, spec: { problem: 'min_risk_mix', params: {} } }),
    );
    const wrote = Date.now();
    await withTenant(tenantId, userId, (tx) =>
      updateSolverRun(tx, created.id, { status: 'running', progress: 0.5, progress_note: 'half' }),
    );
    const [a, b] = await Promise.all([
      one.until((m) => m.type === 'job' && m.progress === 0.5, 2000),
      two.until((m) => m.type === 'job' && m.progress === 0.5, 2000),
    ]);
    const latency = Date.now() - wrote;
    expect(latency).toBeLessThan(500);
    for (const frames of [a, b]) {
      expect(frames.at(-1)).toMatchObject({ type: 'job', id: created.id, status: 'running', progress: 0.5, note: 'half', kind: 'solver' });
    }
    // Another scenario's session hears nothing of it.
    await new Promise((r) => setTimeout(r, 300));
    expect(elsewhere.received.filter((m) => m.type === 'job')).toEqual([]);
  });
});

describe('result cache on enqueue', () => {
  const spec = { problem: 'min_risk_mix', params: { target: 1, hold: ['a', 'b'] } };
  const sent: { queue: string; runId: string }[] = [];
  let inputHash = 'hash-1';
  const submit = () =>
    createSolverSubmitter({
      withTenant: bindWithTenant(h.aa.app.db),
      enqueue: async (queue, payload) => {
        sent.push({ queue, runId: payload.runId });
        return `job-${sent.length}`;
      },
      inputHashOf: async () => inputHash,
    });

  it('keys results (problem, params hash, inputHash): re-running an unchanged scenario returns the cached result without enqueueing', async () => {
    const go = submit();
    const request = { tenantId, userId, scenarioId: C as ScenarioId, kind: 'optimize' as const, spec };

    const first = await go(request);
    expect(first.cached).toBe(false);
    expect(first.run.status).toBe('queued');
    expect(sent).toEqual([{ queue: 'solver.min_risk_mix', runId: first.run.id }]);

    // The worker finishes it.
    await withTenant(tenantId, userId, (tx) =>
      updateSolverRun(tx, first.run.id, { status: 'done', progress: 1, result: { problem: 'min_risk_mix', metrics: { net: 42 } } }),
    );

    // Same problem, same params (key order differs), same inputs: cached, nothing enqueued.
    const again = await go({ ...request, spec: { problem: 'min_risk_mix', params: { hold: ['a', 'b'], target: 1 } } });
    expect(again.cached).toBe(true);
    expect(again.jobId).toBeNull();
    expect(sent).toHaveLength(1);
    expect(again.run.id).not.toBe(first.run.id);
    expect(again.run).toMatchObject({ status: 'done', progress: 1, result: { problem: 'min_risk_mix', metrics: { net: 42 } } });
    const stored = await withTenant(tenantId, userId, (tx) => getSolverRun(tx, again.run.id));
    expect(stored?.result).toEqual({ problem: 'min_risk_mix', metrics: { net: 42 } });

    // Misses: other params, other inputHash, other problem.
    expect((await go({ ...request, spec: { problem: 'min_risk_mix', params: { target: 2, hold: ['a', 'b'] } } })).cached).toBe(false);
    inputHash = 'hash-2';
    expect((await go(request)).cached).toBe(false);
    inputHash = 'hash-1';
    expect((await go({ ...request, spec: { problem: 'pareto', params: spec.params } })).cached).toBe(false);
    expect(sent).toHaveLength(4);
  });

  it('never reuses a failed or cancelled run, and fails a run whose job could not be queued', async () => {
    const request = { tenantId, userId, scenarioId: A as ScenarioId, kind: 'optimize' as const, spec: { problem: 'pareto', params: { n: 1 } } };
    const go = submit();
    const r1 = await go(request);
    await withTenant(tenantId, userId, (tx) => updateSolverRun(tx, r1.run.id, { status: 'failed', result: { error: 'x' } }));
    const r2 = await go(request);
    expect(r2.cached).toBe(false);
    await withTenant(tenantId, userId, (tx) => updateSolverRun(tx, r2.run.id, { status: 'cancelled' }));
    expect((await go(request)).cached).toBe(false);

    const broken = createSolverSubmitter({
      withTenant,
      enqueue: async () => {
        throw new Error('pg-boss down');
      },
      inputHashOf: async () => null,
    });
    await expect(broken({ ...request, spec: { problem: 'pareto', params: { n: 9 } } })).rejects.toThrow('pg-boss down');
    const runs = await withTenant(tenantId, userId, (tx) => listSolverRuns(tx, { scenarioId: A, limit: 1 }));
    expect(runs[0]).toMatchObject({ status: 'failed' });
  });
});
