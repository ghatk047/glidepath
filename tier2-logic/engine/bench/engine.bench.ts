/**
 * Engine perf budgets (docs/architecture/03 §5; gate G8): `pnpm bench --filter=./tier2-logic/engine`.
 * Budgets on the seed model: compile < 150 ms, full evaluate < 50 ms, one lever slider rerun < 10 ms,
 * a batch of 2,000 vectors over every lever realisation input < 10 s single-threaded. The budgets and
 * the recorded baseline live in `baseline.json`; `guard-cli.ts` fails the run at +30% (ENG-11).
 */
import { bench, describe } from 'vitest';
import {
  compile,
  findScenario,
  resolveInputs,
  type BatchInput,
  type Change,
  type Evaluation,
} from '../src';
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

/** Monte Carlo draws (04 §4): 2,000 iterations. */
const BATCH_LANES = 2000;
const BATCH_SEED = 20261204;

/**
 * 2,000 vectors over every lever realisation input (`lev.realize[L..]`, 04 §4), drawn uniformly within
 * the registry bounds with a seeded PRNG (mulberry32).
 */
function realisationBatch(): BatchInput {
  const def = bundle.variables.find((v) => v.id === 'lev.realize');
  if (def === undefined || def.min === null || def.max === null) {
    throw new Error('lev.realize needs registry bounds');
  }
  let a = BATCH_SEED;
  /* eslint-disable no-magic-numbers -- the published mulberry32 constants */
  const rng = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  /* eslint-enable no-magic-numbers */
  const values = new Map<string, Float64Array>();
  for (const cell of base.values.keys()) {
    if (!cell.startsWith(`${def.id}[`)) continue;
    const lanes = new Float64Array(BATCH_LANES);
    for (let i = 0; i < BATCH_LANES; i++) lanes[i] = def.min + (def.max - def.min) * rng();
    values.set(cell, lanes);
  }
  return { size: BATCH_LANES, values };
}

const realisations = realisationBatch();
let dragged: Evaluation = base;
let tick = 0;

/**
 * Sampling for the G8 guard (`guard.ts` compares medians with `baseline.json`): at least 1 s and 30
 * iterations per bench, after a warmup, so the slow benches (compile, batch) have a stable median.
 */
const SAMPLING = { time: 1000, iterations: 30, warmupTime: 250, warmupIterations: 5 } as const;

describe('engine', () => {
  bench(
    'engine.compile',
    () => {
      compile(bundle, seed.dimensionMembers);
    },
    SAMPLING,
  );

  bench(
    'engine.evaluate',
    () => {
      model.evaluate(values, overrides);
    },
    SAMPLING,
  );

  bench(
    'engine.inputHash',
    () => {
      model.inputHash(values, overrides);
    },
    SAMPLING,
  );

  // A slider drag: each rerun moves the lever one step from the previous result (03 §2 Preview).
  bench(
    'engine.rerun.lever',
    () => {
      tick ^= 1;
      const change: Change = {
        target: 'variable',
        cell: lever.cell,
        value: lever.positions[tick]!,
      };
      dragged = model.rerun(dragged, [change]);
    },
    SAMPLING,
  );

  // Monte Carlo / finite differences: 2,000 lanes over every lever realisation input (03 §5 Batch).
  bench(
    'engine.batch.2000',
    () => {
      model.evaluateBatch(base, realisations);
    },
    SAMPLING,
  );
});
