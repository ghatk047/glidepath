/**
 * Engine perf budgets (docs/architecture/03 §5; gate G8): `pnpm --filter ./tier2-logic/engine bench`.
 * Budgets on the seed model: compile < 150 ms, full evaluate < 50 ms, one lever slider rerun < 10 ms.
 */
import { bench, describe } from 'vitest';
import { compile, findScenario, resolveInputs, type Change, type Evaluation } from '../src';
import { loadSeedModel } from '../test/helpers';

const { bundle, seed } = await loadSeedModel();
const model = compile(bundle, seed.dimensionMembers);
const { values, overrides } = resolveInputs(
  bundle,
  seed.variableValues,
  findScenario(seed.scenarios, 'C'),
);
const base = model.evaluate(values, overrides);

/**
 * The lever slider input (`lev.*` variable with a slider control) that moves the most cells, and two
 * neighbouring positions on its registry step grid: where preset C has it, and one step away.
 */
function heaviestLeverSlider(): { cell: string; positions: readonly [number, number] } {
  const inputs = [...base.values.keys()];
  let best: { cell: string; positions: readonly [number, number]; reach: number } | undefined;
  for (const v of bundle.variables) {
    if (!v.id.startsWith('lev.') || v.ui.control !== 'slider' || v.step === null) continue;
    for (const cell of inputs.filter((k) => k === v.id || k.startsWith(`${v.id}[`))) {
      const reach = model.downstream(cell).length;
      if (best !== undefined && reach <= best.reach) continue;
      const at = base.get(cell);
      const next = v.max === null || at + v.step <= v.max ? at + v.step : at - v.step;
      best = { cell, positions: [at, next], reach };
    }
  }
  if (best === undefined) throw new Error('no lever slider in the registry');
  return best;
}

const lever = heaviestLeverSlider();
let dragged: Evaluation = base;
let tick = 0;

describe('engine', () => {
  bench('engine.compile', () => {
    compile(bundle, seed.dimensionMembers);
  });

  bench('engine.evaluate', () => {
    model.evaluate(values, overrides);
  });

  bench('engine.inputHash', () => {
    model.inputHash(values, overrides);
  });

  // A slider drag: each rerun moves the lever one step from the previous result (03 §2 Preview).
  bench('engine.rerun.lever', () => {
    tick ^= 1;
    const change: Change = { target: 'variable', cell: lever.cell, value: lever.positions[tick]! };
    dragged = model.rerun(dragged, [change]);
  });
});
