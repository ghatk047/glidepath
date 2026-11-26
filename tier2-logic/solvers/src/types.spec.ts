/**
 * SOL-01 acceptance 1: SolverResult, Change and per-problem params types as in 03 §3 for every problem
 * id in solvers.json (type fixtures: checked by `tsc` through `expectTypeOf` and `@ts-expect-error`, and
 * at run time against the spec's problem list).
 */
import type { Change as EngineChange } from '@glidepath/engine';
import { ProblemIds } from '@glidepath/spec/generated';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { readRepoJson } from '../test/helpers';
import type {
  Change,
  ProblemId,
  RankedMove,
  SolverDetailMap,
  SolverParamsMap,
  SolverResult,
  SolverSpec,
  SolverStatus,
} from './types';
import { EXTENSION_PROBLEMS, PROBLEM_IDS } from './types';

/** One spec fixture per problem id: the compiler checks each against `SolverSpec`. */
const fixtures = {
  goal_seek: { problem: 'goal_seek', params: { var: 'lev.L03.pct', output: 'res.gap', target: 0, bounds: [0, 0.7] } },
  breakeven: { problem: 'breakeven', params: {} },
  scenario_blend: { problem: 'scenario_blend', params: { from: 'C', to: 'D', output: 'res.gap', target: 0 } },
  min_risk_mix: {
    problem: 'min_risk_mix',
    params: {
      objective: 'min_risk_exposure',
      decisionSets: ['lever_intensity'],
      constraints: [{ id: 'total' }, { id: 'per_vp' }, { id: 'one_time_cap', value: 20 }],
      method: 'explainable',
      seed: 7,
    },
  },
  pareto: { problem: 'pareto', params: { axis: 'risk', sweep: { from: 100, to: 200, step: 5 } } },
  vp_feasible: { problem: 'vp_feasible', params: { constraints: [{ id: 'per_vp', vps: ['v1'] }] } },
  monte_carlo: {
    problem: 'monte_carlo',
    params: { iterations: 2000, seed: 1, outputs: ['res.net'], correlation: [{ levers: ['L01', 'L02'], rho: 0.5 }] },
  },
  sensitivity: { problem: 'sensitivity', params: { method: 'tornado', outputs: ['res.net'], range: { mode: 'registry' } } },
  stress_presets: { problem: 'stress_presets', params: { presets: ['GCC hiring freeze'] } },
  wave_plan: {
    problem: 'wave_plan',
    params: { window: { from: 1, to: 9 }, quarterlyOneTimeCap: 8, maxLaunchesPerQuarter: 3, objective: 'net', levers: ['L03'] },
  },
} as const satisfies { [P in ProblemId]: Extract<SolverSpec, { problem: P }> };

const result: SolverResult<'goal_seek'> = {
  problem: 'goal_seek',
  status: 'optimal',
  changes: [{ target: 'variable', cell: 'lev.L03.pct', value: 0.6 }],
  ranked: [{ cell: 'lev.L03.pct', from: 0.5, to: 0.6, impact: 1.5 }],
  binding: [{ constraint: 'total', shadowPrice: 0 }],
  metrics: { 'res.net': 143 },
  diagnostics: { iterations: 12, ms: 3, seed: 1 },
  detail: { value: 0.6, output: 0, reachable: true },
};

describe('SOL-01 types: SolverResult, Change and per-problem params for every solvers.json problem', () => {
  it('has one params type per problem id of solvers.json, and SolverSpec covers exactly those', () => {
    const spec = readRepoJson<{ problems: { id: string }[] }>('docs/spec/solvers.json');
    const ids = spec.problems.map((p) => p.id);
    expect([...ProblemIds]).toEqual(ids);
    // solvers.json's problems, then the product's own (SRC-03: wave_plan), as in the contract's ProblemId.
    expect([...EXTENSION_PROBLEMS]).toEqual(['wave_plan']);
    expect([...PROBLEM_IDS]).toEqual([...ids, ...EXTENSION_PROBLEMS]);
    expect(Object.keys(fixtures)).toEqual([...ids, ...EXTENSION_PROBLEMS]);
    for (const [id, f] of Object.entries(fixtures)) expect(f.problem).toBe(id);

    expectTypeOf<keyof SolverParamsMap>().toEqualTypeOf<ProblemId>();
    expectTypeOf<keyof SolverDetailMap>().toEqualTypeOf<ProblemId>();
    expectTypeOf<SolverSpec['problem']>().toEqualTypeOf<ProblemId>();
    expectTypeOf<Extract<SolverSpec, { problem: 'goal_seek' }>['params']>().toEqualTypeOf<SolverParamsMap['goal_seek']>();
  });

  it('SolverResult has the fields of 03 §3, typed by problem', () => {
    expect(Object.keys(result)).toEqual(['problem', 'status', 'changes', 'ranked', 'binding', 'metrics', 'diagnostics', 'detail']);
    expectTypeOf<SolverResult['status']>().toEqualTypeOf<SolverStatus>();
    expectTypeOf<SolverStatus>().toEqualTypeOf<'optimal' | 'feasible' | 'infeasible' | 'unreachable' | 'cancelled'>();
    expectTypeOf<SolverResult['ranked'][number]>().toEqualTypeOf<RankedMove>();
    expectTypeOf<RankedMove>().toEqualTypeOf<{
      readonly cell: string;
      readonly from: number;
      readonly to: number;
      readonly impact: number;
    }>();
    expectTypeOf<SolverResult<'goal_seek'>['detail']>().toEqualTypeOf<SolverDetailMap['goal_seek'] | undefined>();

    // A detail of another problem is a type error.
    // @ts-expect-error breakeven detail on a goal_seek result
    const wrong: SolverResult<'goal_seek'> = { ...result, detail: { rows: [] } };
    expect(wrong.problem).toBe('goal_seek');
  });

  it('Change is the engine variable change: solvers never pin a node', () => {
    expectTypeOf<Change>().toEqualTypeOf<Extract<EngineChange, { readonly target: 'variable' }>>();
    expectTypeOf<Change>().toMatchTypeOf<EngineChange>();
    // @ts-expect-error a solver result cannot carry an override
    const pin: Change = { target: 'override', cell: 'res.net', value: 1 };
    expect(pin.target).toBe('override');
  });

  it('rejects params of the wrong problem at compile time', () => {
    // @ts-expect-error goal_seek needs var, output, target
    const bad: SolverSpec = { problem: 'goal_seek', params: { presets: ['x'] } };
    // @ts-expect-error unknown problem id
    const unknown: SolverSpec = { problem: 'gradient_descent', params: {} };
    expect([bad, unknown]).toHaveLength(2);
  });
});
