import { describe, expect, it } from 'vitest';
import { HandlerRegistry } from '../../runtime';
import { defaultSolverDeps } from './deps';
import { registerSolverHandlers, solverQueues } from './register';
import { NO_FLAGS, solverFlagsFromEnv } from './types';

const deps = () => defaultSolverDeps({ specDir: '/nonexistent' });

describe('solver queue registration (JOB-03)', () => {
  it('pareto/sobol queues are registered only when SOL-09/10 exist (feature flag)', () => {
    const off = new HandlerRegistry();
    registerSolverHandlers(off, deps);
    expect(off.queues()).toEqual(['solver.min_risk_mix', 'solver.monte_carlo', 'solver.vp_feasible']);
    expect(off.get('solver.pareto')).toBeUndefined();
    expect(off.get('solver.sensitivity')).toBeUndefined();
    expect(solverQueues(NO_FLAGS).sort()).toEqual(off.queues());

    const pareto = new HandlerRegistry();
    registerSolverHandlers(pareto, deps, { pareto: true, sobol: false });
    expect(pareto.queues()).toContain('solver.pareto');
    expect(pareto.queues()).not.toContain('solver.sensitivity');

    const both = new HandlerRegistry();
    registerSolverHandlers(both, deps, { pareto: true, sobol: true });
    expect(both.queues()).toEqual([
      'solver.min_risk_mix',
      'solver.monte_carlo',
      'solver.pareto',
      'solver.sensitivity',
      'solver.vp_feasible',
    ]);
  });

  it('the flags come from the environment only, off by default', () => {
    expect(solverFlagsFromEnv({})).toEqual({ pareto: false, sobol: false });
    expect(solverFlagsFromEnv({ JOB_SOLVER_PARETO: '1', JOB_SOLVER_SOBOL: 'no' })).toEqual({ pareto: true, sobol: false });
    expect(solverFlagsFromEnv({ JOB_SOLVER_SOBOL: 'true' })).toEqual({ pareto: false, sobol: true });
  });
});
