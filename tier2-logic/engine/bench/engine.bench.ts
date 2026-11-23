/**
 * Engine perf budgets (docs/architecture/03 §5; gate G8): `pnpm --filter ./tier2-logic/engine bench`.
 * Budgets on the seed model: compile < 150 ms, full evaluate < 50 ms.
 */
import { bench, describe } from 'vitest';
import { compile, findScenario, resolveInputs } from '../src';
import { loadSeedModel } from '../test/helpers';

const { bundle, seed } = await loadSeedModel();
const model = compile(bundle, seed.dimensionMembers);
const { values, overrides } = resolveInputs(
  bundle,
  seed.variableValues,
  findScenario(seed.scenarios, 'C'),
);

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
});
