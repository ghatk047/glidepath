/**
 * SOL-01 acceptance 3: AbortSignal stops at the next batch with status cancelled; progress(fraction,
 * note) throttled to >= 250 ms (fake clock). Plus runSolver's result assembly and move rules.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { FakeClock, seedModel } from '../test/helpers';
import { decisionSet } from './decision-sets';
import { SolverError } from './errors';
import type { SolverModel } from './model';
import { PENDING_PROBLEMS } from './problems';
import { PROGRESS_INTERVAL_MS, ProgressThrottle } from './progress';
import { runSolver, type ProblemSolver, type SolverRun } from './run';
import type { ProblemId } from './types';

let model: SolverModel;
beforeAll(async () => {
  model = await seedModel();
});

const noYield = () => Promise.resolve();
const lanes = 4;

/** A solver of `batches` batches on the engine that records a partial result after each one. */
function batchSolver(batches: number, onBatch?: (i: number, run: SolverRun<'min_risk_mix'>) => void): ProblemSolver<'min_risk_mix'> {
  return async (run) => {
    const d = run.decisionSet('lever_intensity')[0]!;
    for (let i = 0; i < batches; i++) {
      const values = new Float64Array(lanes).fill(d.lo + ((d.hi - d.lo) * (i + 1)) / batches);
      await run.evaluateBatch({ size: lanes, values: new Map([[d.cell, values]]) });
      run.partial({ status: 'feasible', changes: [{ target: 'variable', cell: d.cell, value: values[0]! }], metrics: { step: i } });
      onBatch?.(i, run);
    }
    return { status: 'optimal', changes: [], metrics: { step: batches } };
  };
}

describe('SOL-01 abort: AbortSignal stops at the next batch with status cancelled', () => {
  it('stops at the next batch after the signal fires, with the partial result', async () => {
    const ac = new AbortController();
    const ran: number[] = [];
    const solver = batchSolver(10, (i) => {
      ran.push(i);
      if (i === 2) ac.abort();
    });
    const r = await runSolver(model, { problem: 'min_risk_mix', params: {} }, {
      signal: ac.signal,
      yield: noYield,
      problems: { min_risk_mix: solver },
    });
    expect(r.status).toBe('cancelled');
    expect(ran).toEqual([0, 1, 2]);
    expect(r.diagnostics.iterations).toBe(3);
    expect(r.metrics).toEqual({ step: 2 });
    expect(r.changes).toHaveLength(1);
  });

  it('an abort raised by the host between batches lands (the run yields to the event loop)', async () => {
    const ac = new AbortController();
    let batches = 0;
    const solver: ProblemSolver<'min_risk_mix'> = async (run) => {
      for (;;) {
        await run.batch();
        batches += 1;
        if (batches === 1) setTimeout(() => ac.abort(), 0);
      }
    };
    const r = await runSolver(model, { problem: 'min_risk_mix', params: {} }, { signal: ac.signal, problems: { min_risk_mix: solver } });
    expect(r.status).toBe('cancelled');
    expect(r.changes).toEqual([]);
    expect(r.ranked).toEqual([]);
    expect(r.metrics).toEqual({});
    expect(batches).toBeGreaterThanOrEqual(1);
  });

  it('a signal fired before the start runs nothing', async () => {
    const ac = new AbortController();
    ac.abort();
    let called = false;
    const r = await runSolver(model, { problem: 'min_risk_mix', params: {} }, {
      signal: ac.signal,
      problems: {
        min_risk_mix: () => {
          called = true;
          return { status: 'optimal', changes: [] };
        },
      },
    });
    expect(called).toBe(false);
    expect(r).toMatchObject({ status: 'cancelled', changes: [], diagnostics: { iterations: 0 } });
  });

  it('without a signal the run completes; other errors propagate', async () => {
    const r = await runSolver(model, { problem: 'min_risk_mix', params: {} }, { yield: noYield, problems: { min_risk_mix: batchSolver(3) } });
    expect(r).toMatchObject({ problem: 'min_risk_mix', status: 'optimal', metrics: { step: 3 }, diagnostics: { iterations: 3 } });
    await expect(
      runSolver(model, { problem: 'min_risk_mix', params: {} }, {
        problems: {
          min_risk_mix: () => {
            throw new RangeError('boom');
          },
        },
      }),
    ).rejects.toThrow(RangeError);
  });
});

describe('SOL-01 progress: progress(fraction, note) throttled to >= 250 ms (fake clock)', () => {
  it('passes the first report, coalesces reports inside the window, passes the latest after it', async () => {
    const clock = new FakeClock();
    const calls: { t: number; fraction: number; note?: string }[] = [];
    const solver: ProblemSolver<'min_risk_mix'> = async (run) => {
      for (let i = 0; i < 20; i++) {
        await run.batch();
        run.progress((i + 1) / 20, i === 0 ? 'starting' : undefined);
        clock.advance(50); // a batch takes 50 ms
      }
      return { status: 'optimal', changes: [] };
    };
    await runSolver(model, { problem: 'min_risk_mix', params: {} }, {
      clock,
      yield: noYield,
      progress: (fraction, note) => calls.push({ t: clock.now(), fraction, ...(note === undefined ? {} : { note }) }),
      problems: { min_risk_mix: solver },
    });
    expect(calls[0]).toEqual({ t: 0, fraction: 0.05, note: 'starting' });
    for (let i = 1; i < calls.length; i++) expect(calls[i]!.t - calls[i - 1]!.t).toBeGreaterThanOrEqual(PROGRESS_INTERVAL_MS);
    // 20 reports over 1,000 ms: one per 250 ms window.
    expect(calls.map((c) => c.t)).toEqual([0, 250, 500, 750]);
    // Each window passes the latest report held when the next batch starts.
    expect(calls.map((c) => c.fraction)).toEqual([0.05, 0.25, 0.5, 0.75]);
    // The note sticks to later coalesced calls.
    expect(calls.every((c) => c.note === 'starting')).toBe(true);
  });

  it('a report held in the window passes at the next batch once the window has ended', async () => {
    const clock = new FakeClock();
    const calls: [number, number][] = [];
    const solver: ProblemSolver<'min_risk_mix'> = async (run) => {
      run.progress(0.1);
      clock.advance(10);
      run.progress(0.2);
      clock.advance(PROGRESS_INTERVAL_MS);
      await run.batch();
      return { status: 'optimal', changes: [] };
    };
    await runSolver(model, { problem: 'min_risk_mix', params: {} }, {
      clock,
      yield: noYield,
      progress: (f) => calls.push([clock.now(), f]),
      problems: { min_risk_mix: solver },
    });
    expect(calls).toEqual([
      [0, 0.1],
      [260, 0.2],
    ]);
  });

  it('clamps fractions, drops non-finite ones, honours a custom interval and a missing sink', () => {
    const clock = new FakeClock();
    const calls: number[] = [];
    const t = new ProgressThrottle((f) => calls.push(f), clock, 100);
    t.report(Number.NaN);
    t.report(-1);
    clock.advance(100);
    t.report(2, 'x');
    expect(calls).toEqual([0, 1]);
    const silent = new ProgressThrottle(undefined, clock);
    silent.report(0.5);
    silent.tick();
  });
});

describe('SOL-01 runSolver: result assembly and move rules', () => {
  it('fills problem, ranked, binding, metrics, diagnostics (ms from the clock, seed) and detail', async () => {
    const clock = new FakeClock();
    const d = decisionSet(model, 'lever_intensity')[0]!;
    const r = await runSolver(model, { problem: 'goal_seek', params: { var: d.cell, output: 'res.gap', target: 0 } }, {
      clock,
      problems: {
        goal_seek: (run, p) => {
          clock.advance(42);
          const changes = [{ target: 'variable' as const, cell: p.var, value: d.hi }];
          return {
            status: 'unreachable',
            changes,
            ranked: run.rank(changes, p.output),
            binding: [{ constraint: 'total', shadowPrice: 1 }],
            metrics: { 'res.gap': run.rerun(changes).get('res.gap') },
            detail: { value: d.hi, output: 0, reachable: false },
            seed: 9,
          };
        },
      },
    });
    expect(r.problem).toBe('goal_seek');
    expect(r.status).toBe('unreachable');
    expect(r.diagnostics).toEqual({ iterations: 0, ms: 42, seed: 9 });
    expect(r.ranked).toHaveLength(1);
    expect(r.binding).toEqual([{ constraint: 'total', shadowPrice: 1 }]);
    expect(r.detail).toEqual({ value: d.hi, output: 0, reachable: false });
    expect(Number.isFinite(r.metrics['res.gap'])).toBe(true);
  });

  it('every problem without its item rejects with NOT_IMPLEMENTED naming the item', async () => {
    // Problems whose item has landed run for real (their own specs cover them); each item adds its own.
    const landed = new Set<string>(['sensitivity', 'goal_seek', 'breakeven', 'stress_presets']);
    for (const [problem, item] of Object.entries(PENDING_PROBLEMS).filter(([p]) => !landed.has(p))) {
      await expect(runSolver(model, { problem, params: {} } as never)).rejects.toMatchObject({
        code: 'NOT_IMPLEMENTED',
        message: expect.stringContaining(item),
      });
    }
    await expect(runSolver(model, { problem: 'nope' as ProblemId, params: {} } as never)).rejects.toBeInstanceOf(SolverError);
  });

  it('moves allowed per problem: goal seek its input, breakeven its inputs, blend and stress any input, MC none', async () => {
    const [a, b] = decisionSet(model, 'lever_intensity');
    const estimate = model.bundle.variables.find((v) => v.id.startsWith('lev.L') && v.kind === 'estimate')!.id;
    const move = (cell: string) => () => ({ status: 'feasible' as const, changes: [{ target: 'variable' as const, cell, value: 0 }] });
    const ok = async (spec: never, problem: ProblemId, cell: string) =>
      runSolver(model, spec, { problems: { [problem]: move(cell) } });

    await expect(ok({ problem: 'goal_seek', params: { var: a!.cell, output: 'res.gap', target: 0 } } as never, 'goal_seek', a!.cell)).resolves.toBeTruthy();
    await expect(ok({ problem: 'goal_seek', params: { var: a!.cell, output: 'res.gap', target: 0 } } as never, 'goal_seek', b!.cell)).rejects.toMatchObject({ code: 'ILLEGAL_MOVE' });
    await expect(ok({ problem: 'breakeven', params: { inputs: [estimate] } } as never, 'breakeven', estimate)).resolves.toBeTruthy();
    await expect(ok({ problem: 'breakeven', params: {} } as never, 'breakeven', estimate)).rejects.toMatchObject({ code: 'ILLEGAL_MOVE' });
    await expect(ok({ problem: 'scenario_blend', params: { from: 'C', to: 'D' } } as never, 'scenario_blend', estimate)).resolves.toBeTruthy();
    await expect(ok({ problem: 'stress_presets', params: { presets: ['x'] } } as never, 'stress_presets', 'res.net')).rejects.toMatchObject({ code: 'ILLEGAL_MOVE' });
    await expect(ok({ problem: 'monte_carlo', params: {} } as never, 'monte_carlo', a!.cell)).rejects.toMatchObject({ code: 'ILLEGAL_MOVE' });
    await expect(ok({ problem: 'pareto', params: {} } as never, 'pareto', a!.cell)).resolves.toBeTruthy();
    await expect(ok({ problem: 'vp_feasible', params: {} } as never, 'vp_feasible', estimate)).rejects.toMatchObject({ code: 'ILLEGAL_MOVE' });
    await expect(ok({ problem: 'sensitivity', params: { method: 'tornado', outputs: ['res.net'] } } as never, 'sensitivity', a!.cell)).rejects.toMatchObject({ code: 'ILLEGAL_MOVE' });
  });
});
