/**
 * Engine perf budgets (docs/architecture/03 §5; gate G8): `pnpm bench --filter=./tier2-logic/engine`.
 * Budgets: compile < 150 ms on the seed model.
 */
import { bench, describe } from 'vitest';
import { compile } from '../src';
import { loadSeedModel } from '../test/helpers';

const { bundle, seed } = await loadSeedModel();

describe('engine', () => {
  bench('engine.compile', () => {
    compile(bundle, seed.dimensionMembers);
  });
});
