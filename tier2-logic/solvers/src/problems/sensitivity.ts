/**
 * `sensitivity` problem (SOL-07): tornado and elasticity on the first of `params.outputs`, one batch.
 * Sobol is a worker job (SOL-10); spider has no backlog item yet. Moves nothing.
 */
import { SolverError } from '../errors';
import type { ProblemSolver } from '../run';
import { tornado } from '../tornado';

export const sensitivity: ProblemSolver<'sensitivity'> = async (run, params) => {
  const { method, outputs } = params;
  if (method === 'sobol') throw new SolverError('NOT_IMPLEMENTED', 'sensitivity sobol lands with SOL-10');
  if (method === 'spider') throw new SolverError('NOT_IMPLEMENTED', 'sensitivity spider has no backlog item yet');
  const output = outputs[0];
  if (output === undefined) throw new SolverError('BAD_PARAMS', 'sensitivity needs at least one output');
  for (const o of outputs) if (!run.model.base.has(o)) throw new SolverError('BAD_PARAMS', `unknown output cell ${o}`);

  await run.batch();
  const elasticity = method === 'elasticity';
  const t = tornado(run.model, output, {
    ...(params.inputs === undefined ? {} : { inputs: params.inputs }),
    ...(params.range === undefined ? {} : { range: params.range }),
    elasticity,
  });
  const items = elasticity
    ? [...t.items].sort((a, b) => Math.abs(b.elasticity ?? 0) - Math.abs(a.elasticity ?? 0))
    : t.items;
  run.progress(1);

  return {
    status: 'feasible',
    changes: [],
    ranked: items
      .filter((r) => r.low !== null && r.high !== null)
      .map((r) => ({ cell: r.cell, from: r.low!.input, to: r.high!.input, impact: r.high!.output - r.low!.output })),
    metrics: Object.fromEntries(outputs.map((o) => [o, run.model.base.get(o)])),
    detail: {
      method,
      output,
      rows: items.map((r) => ({
        cell: r.cell,
        category: r.category,
        swing: r.swing,
        low: r.low,
        high: r.high,
        elasticity: r.elasticity,
        first: null,
        total: null,
      })),
    },
  };
};
