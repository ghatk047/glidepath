/**
/**
 * Solver perf budgets (docs/architecture/03 §3 and §5; gate G8): `pnpm bench --filter=./tier2-logic/solvers`.
 * Budgets and baselines live in `baseline.json`; the engine's guard (`check` mode) fails a bench over its
 * budget or at +30% over its baseline. Goal seek < 1 s and breakeven < 2 s are also asserted in
 * src/problems/goal-seek.spec.ts, blend < 1 s in src/problems/blend.spec.ts; Monte Carlo is 2,000 draws of the 04 §4 defaults, < 10 s.
 */
import { bench, describe } from 'vitest';
import { decisionSet } from '../src/decision-sets';
import { blend } from '../src/blend';
import { breakeven, goalSeek } from '../src/goal-seek';
import { parseStressPresets } from '../src/problems/stress';
import { runSolver } from '../src/run';
import { presetValues, readRepoJson, seedModel } from '../test/helpers';

const model = {
  ...(await seedModel('C')),
  presets: parseStressPresets(readRepoJson('docs/spec/solvers.json')),
  scenarios: new Map([
    ['C', await presetValues('C')],
    ['D', await presetValues('D')],
  ]),
};
const lever = decisionSet(model, 'lever_intensity').find((d) => d.cell === 'lev.L10.rcut')!;
/** A range wide enough for this lever alone to close the C gap (the registry range does not). */
const WIDEN = 4;
const bounds = [lever.min!, lever.min! + WIDEN * (lever.max! - lever.min!)] as const;
const noYield = () => Promise.resolve();
/** Few, long iterations for Monte Carlo: one run is ~0.5 s. */
const MC_SAMPLING = { iterations: 5, warmupIterations: 1, time: 0, warmupTime: 0 };

describe('solvers', () => {
  bench('solvers.goal_seek', async () => {
    await goalSeek(model, { var: lever.cell, output: 'res.gap', target: 0, bounds }, { yield: noYield });
  });
  bench('solvers.breakeven', async () => {
    await breakeven(model, {}, { yield: noYield });
  });
  bench('solvers.scenario_blend', async () => {
    await blend(model, 'C', 'D', 0, { yield: noYield });
  });
  bench('solvers.stress_presets', async () => {
    await runSolver(model, { problem: 'stress_presets', params: { presets: [] } }, { yield: noYield });
  });
  bench(
    'solvers.mc.2000',
    async () => {
      await runSolver(model, { problem: 'monte_carlo', params: { iterations: 2000 } }, { yield: noYield });
    },
    MC_SAMPLING,
  );
});
