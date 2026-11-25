import type { QuickSolverSpec } from '@glidepath/api-contract';
import type { SolverSpec as EngineSolverSpec } from '@glidepath/solvers';
import { toEngineCell } from '../../session/cells';

/**
 * A quick spec as the solvers take it: the contract names cells `id[member]` (`res.net[]`), the engine `id` for
 * a scalar. Only cell-valued parameters change; everything else is passed as sent (optional parameters stay
 * absent: the solvers default them from the spec bundle).
 */
export function toEngineSpec(spec: QuickSolverSpec): EngineSolverSpec {
  const cells = (list: readonly string[]): string[] => list.map(toEngineCell);
  switch (spec.problem) {
    case 'goal_seek': {
      const p = spec.params;
      return {
        problem: 'goal_seek',
        params: {
          var: toEngineCell(p.var),
          output: toEngineCell(p.output),
          target: p.target,
          ...(p.bounds === undefined ? {} : { bounds: p.bounds }),
        },
      };
    }
    case 'breakeven': {
      const p = spec.params;
      return {
        problem: 'breakeven',
        params: {
          ...(p.output === undefined ? {} : { output: toEngineCell(p.output) }),
          ...(p.target === undefined ? {} : { target: p.target }),
          ...(p.inputs === undefined ? {} : { inputs: cells(p.inputs) }),
        },
      };
    }
    case 'scenario_blend': {
      const p = spec.params;
      return {
        problem: 'scenario_blend',
        params: {
          from: p.from,
          to: p.to,
          ...(p.output === undefined ? {} : { output: toEngineCell(p.output) }),
          ...(p.target === undefined ? {} : { target: p.target }),
        },
      };
    }
    case 'sensitivity': {
      const p = spec.params;
      return {
        problem: 'sensitivity',
        params: {
          method: p.method,
          outputs: cells(p.outputs),
          ...(p.inputs === undefined ? {} : { inputs: cells(p.inputs) }),
          ...(p.range === undefined ? {} : { range: p.range }),
          ...(p.samples === undefined ? {} : { samples: p.samples }),
        },
      };
    }
    case 'stress_presets':
      return { problem: 'stress_presets', params: { presets: [...spec.params.presets] } };
  }
}
