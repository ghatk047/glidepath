import { ProblemId, SolverSpec, quickProblems } from '@glidepath/api-contract';
import type { SolverRunRecord } from '@glidepath/data-access';
import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../../app/config';
import { KIND_OF_PROBLEM, solverKind } from './kinds';
import { parseStressPresets } from './model';
import { toEngineSpec } from './params';
import { toContractResult } from './result';
import { metaOf, toSolverRun } from './run';

const record = (over: Partial<SolverRunRecord> = {}): SolverRunRecord => ({
  id: 'run-1',
  kind: 'goal_seek',
  scenario_id: 'scn-1',
  spec: { problem: 'stress_presets', params: { presets: ['x'] } },
  status: 'queued',
  result: {},
  result_scenario_id: null,
  created_at: '2026-11-01T10:00:00.000Z',
  progress: 0,
  progress_note: null,
  cancel_requested: false,
  updated_at: '2026-11-01T10:00:00.000Z',
  ...over,
});

describe('problem ids map to solver_run kinds', () => {
  it('covers every problem of the contract and only uses kinds the table has', () => {
    expect(Object.keys(KIND_OF_PROBLEM).sort()).toEqual([...ProblemId.options].sort());
    expect(solverKind('scenario_blend')).toBe('blend');
    expect(solverKind('min_risk_mix')).toBe('optimize');
    expect(solverKind('vp_feasible')).toBe('optimize');
    expect(solverKind('stress_presets')).toBe('sensitivity');
  });
});

describe('toEngineSpec: wire cells to engine cells, nothing else changes', () => {
  it('maps var, output(s) and inputs of every quick problem', () => {
    expect(toEngineSpec({ problem: 'goal_seek', params: { var: 'lev.L01.cut[]', output: 'res.net[]', target: 5, bounds: [0, 1] } } as never)).toEqual({
      problem: 'goal_seek',
      params: { var: 'lev.L01.cut', output: 'res.net', target: 5, bounds: [0, 1] },
    });
    expect(toEngineSpec({ problem: 'breakeven', params: {} } as never)).toEqual({ problem: 'breakeven', params: {} });
    expect(toEngineSpec({ problem: 'breakeven', params: { output: 'res.gap[]', inputs: ['lev.start[L03]'] } } as never)).toEqual({
      problem: 'breakeven',
      params: { output: 'res.gap', inputs: ['lev.start[L03]'] },
    });
    expect(toEngineSpec({ problem: 'scenario_blend', params: { from: 'a', to: 'b', target: 1 } } as never)).toEqual({
      problem: 'scenario_blend',
      params: { from: 'a', to: 'b', target: 1 },
    });
    expect(toEngineSpec({ problem: 'sensitivity', params: { method: 'tornado', outputs: ['res.net[]'], range: { mode: 'registry' } } } as never)).toEqual({
      problem: 'sensitivity',
      params: { method: 'tornado', outputs: ['res.net'], range: { mode: 'registry' } },
    });
    expect(toEngineSpec({ problem: 'stress_presets', params: { presets: ['A'] } } as never)).toEqual({ problem: 'stress_presets', params: { presets: ['A'] } });
  });

  it('the quick list of the contract is the five problems the route runs', () => {
    expect([...quickProblems]).toEqual(['goal_seek', 'breakeven', 'scenario_blend', 'sensitivity', 'stress_presets']);
  });
});

describe('toContractResult', () => {
  const diagnostics = { iterations: 2, ms: 1.5 };

  it('maps the solvers\' engine cells and moves onto the wire, and is idempotent', () => {
    const raw = {
      problem: 'sensitivity',
      status: 'feasible',
      changes: [{ target: 'variable', cell: 'lev.start[L03]', value: 2 }],
      ranked: [{ cell: 'res.net', from: 1, to: 2, impact: 3 }],
      metrics: { 'res.net': 10, bad: Number.POSITIVE_INFINITY },
      diagnostics,
      detail: {
        method: 'tornado',
        output: 'res.net',
        rows: [{ cell: 'g.target_net', category: 'policy', swing: 4, low: { input: 1, output: 2 }, high: null, elasticity: null, first: null, total: null }],
      },
    };
    const once = toContractResult(raw);
    expect(once.changes).toEqual([{ target: 'variable', key: 'lev.start', member: 'L03', value: 2 }]);
    expect(once.ranked[0]!.cell).toBe('res.net[]');
    expect(once.metrics).toEqual({ 'res.net': 10 });
    expect(once.detail).toMatchObject({ problem: 'sensitivity', output: 'res.net[]', rows: [{ cell: 'g.target_net[]' }] });
    expect(toContractResult(once)).toEqual(once);
  });

  it('maps stress outputs and deltas keys, pareto points and Monte Carlo cells', () => {
    const stress = toContractResult({
      problem: 'stress_presets',
      status: 'feasible',
      changes: [],
      ranked: [],
      metrics: {},
      diagnostics,
      detail: { presets: [{ name: 'p', outputs: { 'res.net': 1 }, delta: { 'res.net': 0 } }] },
    });
    expect(stress.detail).toMatchObject({ presets: [{ outputs: { 'res.net[]': 1 }, delta: { 'res.net[]': 0 } }] });

    const pareto = toContractResult({
      problem: 'pareto',
      status: 'optimal',
      changes: [],
      ranked: [],
      metrics: {},
      diagnostics,
      detail: { points: [{ bar: 1, net: 2, risk: 3, oneTime: 4, feasible: true, changes: [] }] },
    });
    expect(pareto.detail).toMatchObject({ points: [{ bar: 1, scenarioId: null }] });

    const mc = toContractResult({
      problem: 'monte_carlo',
      status: 'feasible',
      changes: [],
      ranked: [],
      metrics: {},
      diagnostics: { ...diagnostics, seed: 7 },
      detail: {
        iterations: 10,
        seed: 7,
        percentiles: [{ cell: 'res.net', p10: 1, p50: 2, p90: 3 }],
        probabilities: [{ cell: 'res.net', against: 'res.bar', p: 0.5 }],
        histograms: [{ cell: 'res.net', bins: [{ lo: 0, hi: 1, count: 3 }] }],
        contributions: [{ lever: 'L01', share: 0.4, rho: 0.6 }],
      },
    });
    expect(mc.detail).toMatchObject({ percentiles: [{ cell: 'res.net[]' }], probabilities: [{ cell: 'res.net[]', against: 'res.bar[]' }] });
  });

  it('a result that does not fit the contract is an error, never a partial answer', () => {
    expect(() => toContractResult({ problem: 'goal_seek', status: 'odd', changes: [], ranked: [], metrics: {}, diagnostics })).toThrow();
    expect(() => toContractResult('nope')).toThrow(TypeError);
  });
});

describe('toSolverRun', () => {
  it('a queued run: no result, flags and version from the stored spec, input hash from the cache key', () => {
    const run = toSolverRun(
      record({
        spec: {
          problem: 'stress_presets',
          params: { presets: ['x'] },
          run: { quick: false, save: true, scenarioVersion: 3 },
          cache: { paramsHash: 'p', inputHash: 'h', cachedFrom: 'older' },
        },
      }),
    );
    expect(run).toMatchObject({ quick: false, save: true, scenarioVersion: 3, inputHash: 'h', cached: true, result: null, error: null, createdBy: null });
    expect(SolverSpec.parse(run.spec)).toEqual({ problem: 'stress_presets', params: { presets: ['x'] } });
  });

  it('defaults for runs a worker or an older version created without the extras', () => {
    expect(metaOf({ problem: 'x' })).toEqual({ quick: false, save: false, scenarioVersion: 0 });
    expect(toSolverRun(record())).toMatchObject({ inputHash: null, cached: false, quick: false });
  });

  it('a cancelled run keeps its partial result; progress is clamped and the note is one line', () => {
    const run = toSolverRun(
      record({
        status: 'cancelled',
        progress: 1.2,
        progress_note: 'half\ndone',
        result: { problem: 'stress_presets', status: 'cancelled', changes: [], ranked: [], metrics: {}, diagnostics: { iterations: 1, ms: 1 } },
      }),
    );
    expect(run).toMatchObject({ status: 'cancelled', progress: 1, progressNote: 'half done', result: { status: 'cancelled' } });
  });
});

describe('parseStressPresets', () => {
  it('reads the examples of the stress_presets problem in order and rejects a malformed list', () => {
    const json = { problems: [{ id: 'goal_seek' }, { id: 'stress_presets', examples: [{ name: 'a', set: { x: 0 } }, { name: 'b', shift: { y: 3 } }] }] };
    expect(parseStressPresets(json)).toEqual([{ name: 'a', set: { x: 0 } }, { name: 'b', shift: { y: 3 } }]);
    expect(parseStressPresets({ problems: [] })).toEqual([]);
    expect(() => parseStressPresets({ problems: [{ id: 'stress_presets', examples: 'x' }] })).toThrow(/not a list/);
    expect(() => parseStressPresets({ problems: [{ id: 'stress_presets', examples: [{}] }] })).toThrow(/no name/);
  });
});

describe('config: IMPORT_MAX_BYTES and JOB_QUEUE_SCHEMA', () => {
  const base = { DATABASE_URL: 'postgres://u@h/d', AUTH_SECRET: 'x'.repeat(16) };

  it('default, override and rejection', () => {
    expect(loadConfig(base)).toMatchObject({ IMPORT_MAX_BYTES: 10 * 1024 * 1024, JOB_QUEUE_SCHEMA: 'pgboss' });
    expect(loadConfig({ ...base, IMPORT_MAX_BYTES: '2048', JOB_QUEUE_SCHEMA: 'jobs' })).toMatchObject({ IMPORT_MAX_BYTES: 2048, JOB_QUEUE_SCHEMA: 'jobs' });
    try {
      loadConfig({ ...base, IMPORT_MAX_BYTES: '0', JOB_QUEUE_SCHEMA: 'Bad-Name' });
      expect.unreachable();
    } catch (err) {
      expect((err as ConfigError).invalid.map((i) => i.name)).toEqual(['IMPORT_MAX_BYTES', 'JOB_QUEUE_SCHEMA']);
    }
  });
});
