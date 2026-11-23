/**
 * Solver benches on the seed tenant at preset C (gate G8; 03 §3 targets: goal seek < 1 s, breakeven < 2 s).
 * `pnpm --filter ./tier2-logic/solvers bench`. The hard budgets are asserted in
 * src/problems/goal-seek.spec.ts ("SOL-02 perf"); this file reports the timings.
 */
import { bench, describe } from 'vitest';
import { decisionSet } from '../src/decision-sets';
import { breakeven, goalSeek } from '../src/goal-seek';
import { parseStressPresets } from '../src/problems/stress';
import { runSolver } from '../src/run';
import { readRepoJson, seedModel } from '../test/helpers';

const model = { ...(await seedModel('C')), presets: parseStressPresets(readRepoJson('docs/spec/solvers.json')) };
const lever = decisionSet(model, 'lever_intensity').find((d) => d.cell === 'lev.L10.rcut')!;
/** A range wide enough for this lever alone to close the C gap (the registry range does not). */
const WIDEN = 4;
const bounds = [lever.min!, lever.min! + WIDEN * (lever.max! - lever.min!)] as const;
const noYield = () => Promise.resolve();

describe('solvers', () => {
  bench('solvers.goal_seek', async () => {
    await goalSeek(model, { var: lever.cell, output: 'res.gap', target: 0, bounds }, { yield: noYield });
  });
  bench('solvers.breakeven', async () => {
    await breakeven(model, {}, { yield: noYield });
  });
  bench('solvers.stress_presets', async () => {
    await runSolver(model, { problem: 'stress_presets', params: { presets: [] } }, { yield: noYield });
  });
});
