import type { ScenarioId, ServerMessage, TenantId, UserId } from '@glidepath/api-contract';
import type { SolverRunRecord } from '@glidepath/data-access';
import { describe, expect, it } from 'vitest';
import { FakeClock } from '../session/testing/fake-clock';
import { canonicalJson, paramsHash } from './params-hash';
import { createJobRelay, DEFAULT_JOB_RELAY_POLL_MS, jobMessage, jobRelayPollMs } from './relay';
import type { JobTarget } from './relay';

const T1 = 't1' as TenantId;
const T2 = 't2' as TenantId;
const U = 'u' as UserId;

class Target implements JobTarget {
  readonly got: ServerMessage[] = [];
  isClosed = false;
  constructor(
    readonly tenant: { tenantId: TenantId },
    public scenarioId: ScenarioId,
  ) {}
  readonly userId = U;
  deliver(m: ServerMessage) {
    this.got.push(m);
  }
}

const run = (id: string, p: Partial<SolverRunRecord> = {}): SolverRunRecord => ({
  id,
  kind: 'optimize',
  scenario_id: 's1',
  spec: {},
  status: 'running',
  result: {},
  result_scenario_id: null,
  created_at: '2026-01-01T00:00:00Z',
  progress: 0,
  progress_note: null,
  cancel_requested: false,
  updated_at: '2026-01-01T00:00:00Z',
  ...p,
});

describe('JobRelay (fake clock, no database)', () => {
  it('job updates reach every session of that tenant/scenario as job messages within 500 ms by polling solver_run (no LISTEN/NOTIFY)', async () => {
    const clock = new FakeClock();
    const a = new Target({ tenantId: T1 }, 's1' as ScenarioId);
    const b = new Target({ tenantId: T1 }, 's1' as ScenarioId);
    const otherScenario = new Target({ tenantId: T1 }, 's2' as ScenarioId);
    const otherTenant = new Target({ tenantId: T2 }, 's1' as ScenarioId);
    let table: SolverRunRecord[] = [];
    const polled: string[] = [];
    const relay = createJobRelay({
      targets: () => [a, b, otherScenario, otherTenant],
      source: async (tenant, _user, scenario) => {
        polled.push(`${tenant}/${scenario}`);
        return tenant === T1 && scenario === 's1' ? table : [];
      },
      clock,
    });
    relay.start();
    clock.advance(DEFAULT_JOB_RELAY_POLL_MS); // baseline tick, nothing there yet
    await relay.stop();
    relay.start();

    table = [run('r1', { progress: 0.4, progress_note: 'searching' })]; // the worker wrote progress
    clock.advance(DEFAULT_JOB_RELAY_POLL_MS); // < 500 ms later the relay polls
    await relay.stop();

    const expected = {
      v: 1,
      type: 'job',
      id: 'r1',
      status: 'running',
      progress: 0.4,
      note: 'searching',
      kind: 'solver',
      cancelRequested: false,
    };
    expect(DEFAULT_JOB_RELAY_POLL_MS).toBeLessThan(500);
    expect(a.got).toEqual([expected]);
    expect(b.got).toEqual([expected]);
    expect(otherScenario.got).toEqual([]);
    expect(otherTenant.got).toEqual([]);
    expect(new Set(polled)).toEqual(new Set([`${T1}/s1`, `${T1}/s2`, `${T2}/s1`])); // one poll per tenant/scenario
  });

  it('sends changes only, replays no finished history on a first look, and reports a cancel flag until the run stops', async () => {
    const clock = new FakeClock();
    const t = new Target({ tenantId: T1 }, 's1' as ScenarioId);
    let table = [run('old', { status: 'done', progress: 1 }), run('live', { progress: 0.1 })];
    const relay = createJobRelay({ targets: () => [t], source: async () => table, clock });
    await relay.tick();
    expect(t.got.map((m) => (m as { id: string }).id)).toEqual(['live']); // in flight yes, history no
    await relay.tick();
    expect(t.got).toHaveLength(1); // unchanged: nothing
    table = [run('old', { status: 'done', progress: 1 }), run('live', { progress: 0.1, cancel_requested: true })];
    await relay.tick();
    expect(t.got.at(-1)).toMatchObject({ id: 'live', cancelRequested: true });
    table = [run('new', { status: 'done', progress: 1 }), ...table.map((r) => (r.id === 'live' ? run('live', { status: 'cancelled', progress: 0.1, cancel_requested: true }) : r))];
    await relay.tick();
    expect(t.got.slice(2).map((m) => `${(m as { id: string }).id}:${(m as { status: string }).status}`)).toEqual([
      'live:cancelled',
      'new:done',
    ]);
    expect(t.got.at(-2)).toMatchObject({ cancelRequested: false });
  });

  it('survives a failing poll and skips closed sessions', async () => {
    const t = new Target({ tenantId: T1 }, 's1' as ScenarioId);
    let fail = true;
    const relay = createJobRelay({
      targets: () => [t],
      source: async () => {
        if (fail) throw new Error('db down');
        return [run('r')];
      },
    });
    await relay.tick();
    fail = false;
    t.isClosed = true;
    await relay.tick();
    expect(t.got).toEqual([]);
    t.isClosed = false;
    await relay.tick();
    expect(t.got).toHaveLength(1);
  });

  it('reads the poll interval from JOB_RELAY_POLL_MS and keeps it inside the latency promise', () => {
    expect(jobRelayPollMs({})).toBe(DEFAULT_JOB_RELAY_POLL_MS);
    expect(jobRelayPollMs({ JOB_RELAY_POLL_MS: '100' })).toBe(100);
    expect(jobRelayPollMs({ JOB_RELAY_POLL_MS: '5000' })).toBeLessThan(500);
    expect(() => jobRelayPollMs({ JOB_RELAY_POLL_MS: 'fast' })).toThrow();
    expect(jobMessage(run('x', { status: 'done', cancel_requested: true }))).toMatchObject({ cancelRequested: false });
  });
});

describe('params hash', () => {
  it('ignores key order and undefined fields, not values', () => {
    expect(paramsHash({ a: 1, b: { c: [1, 2], d: 'x' } })).toBe(paramsHash({ b: { d: 'x', c: [1, 2] }, a: 1, z: undefined }));
    expect(paramsHash({ a: 1 })).not.toBe(paramsHash({ a: 2 }));
    expect(canonicalJson({ b: 1, a: [null] })).toBe('{"a":[null],"b":1}');
  });
});
