import { readTenantSeed } from '@glidepath/spec/node';
import { describe, expect, it } from 'vitest';
import {
  boundedVariables,
  DEFAULT_FUZZ_SEED,
  drawValue,
  drawVectors,
  LOCAL_MAX_VARIABLES,
  rngOf,
  UNIFORM_VECTORS,
  type BoundedVariable,
} from './fuzz-vectors';
import { loadParityInputs, paths } from './load';

const { bundle, seed } = await loadParityInputs();
const zz = await readTenantSeed(paths.zzSeed);
const bounded = boundedVariables(bundle);
const byId = new Map(bounded.map((v) => [v.id, v]));
const STEPPED = new Set(['int', 'bool', 'enum']);

/** Every drawn number of a vector, with its variable. */
function drawn(values: Record<string, unknown>): [BoundedVariable, number][] {
  return Object.entries(values).flatMap(([vid, x]): [BoundedVariable, number][] => {
    const v = byId.get(vid)!;
    const xs = typeof x === 'number' ? [x] : Object.values(x as Record<string, number>);
    return xs.map((y) => [v, y]);
  });
}

const onGrid = (v: BoundedVariable, x: number) => Number.isInteger((x - v.min) / (v.step ?? 1));

describe('fuzz vectors', () => {
  it('draws only registry variables with both min and max (168 of 194)', () => {
    expect(bundle.variables).toHaveLength(194);
    expect(bounded).toHaveLength(168);
    expect(bounded.every((v) => v.min <= v.max)).toBe(true);
  });

  it('draws within [min, max], on the min + k * step grid for int, bool and enum', () => {
    const rng = rngOf(1);
    const bad: string[] = [];
    for (const v of bounded) {
      for (let i = 0; i < 50; i++) {
        const x = drawValue(v, rng);
        if (x < v.min || x > v.max || (STEPPED.has(v.type) && !onGrid(v, x)))
          bad.push(`${v.id}=${x}`);
      }
    }
    expect(bad).toEqual([]);
    // Both ends of a grid are reachable: a bool draws 0 and 1.
    const flag = bounded.find((v) => v.type === 'bool')!;
    const seen = new Set(Array.from({ length: 64 }, () => drawValue(flag, rng)));
    expect([...seen].sort()).toEqual([0, 1]);
  });

  it('200 vectors per tenant: presets cycle in file order, 100 local (1-8 variables) then 100 global (all bounded)', () => {
    for (const tenant of [seed, zz]) {
      const vectors = drawVectors(bundle, tenant, {
        seed: DEFAULT_FUZZ_SEED,
        count: UNIFORM_VECTORS,
        set: 'uniform',
      });
      expect(vectors).toHaveLength(UNIFORM_VECTORS);
      const presets = tenant.scenarios.scenarios.map((s) => s.id);
      expect(presets).toEqual(['rates', 'A', 'B', 'C', 'D']);
      const half = UNIFORM_VECTORS / 2;
      expect(vectors.map((v) => v.preset)).toEqual(
        vectors.map((_, i) => presets[i % presets.length]),
      );
      expect(vectors.map((v) => v.kind)).toEqual(
        vectors.map((_, i) => (i < half ? 'local' : 'global')),
      );
      const sizes = vectors.map((v) => Object.keys(v.values).length);
      expect(Math.min(...sizes.slice(0, half))).toBeGreaterThanOrEqual(1);
      expect(Math.max(...sizes.slice(0, half))).toBe(LOCAL_MAX_VARIABLES);
      expect(new Set(sizes.slice(half))).toEqual(new Set([bounded.length]));
      // One check per drawn number (hundreds of thousands): collect the violations, assert once.
      const bad = vectors.flatMap((v) =>
        drawn(v.values)
          .filter(
            ([variable, x]) =>
              x < variable.min ||
              x > variable.max ||
              (STEPPED.has(variable.type) && !onGrid(variable, x)),
          )
          .map(([variable, x]) => `#${v.index} ${variable.id}=${x}`),
      );
      expect(bad).toEqual([]);
      // A dimensioned variable is drawn for every member cell of the tenant, independently.
      const global = vectors[UNIFORM_VECTORS - 1]!.values['lev.on'] as Record<string, number>;
      expect(Object.keys(global).sort()).toEqual(
        Object.keys(tenant.variableValues['lev.on']!).sort(),
      );
    }
  });

  it('is deterministic per seed and differs between seeds', () => {
    const a = drawVectors(bundle, seed, { seed: 7, count: 10, set: 'uniform' });
    expect(drawVectors(bundle, seed, { seed: 7, count: 10, set: 'uniform' })).toEqual(a);
    expect(drawVectors(bundle, seed, { seed: 8, count: 10, set: 'uniform' })).not.toEqual(a);
  });

  it('edge vectors put a share of the values on min, max or 0', () => {
    const vectors = drawVectors(bundle, seed, { seed: DEFAULT_FUZZ_SEED, count: 20, set: 'edge' });
    const values = vectors.flatMap((v) => drawn(v.values));
    const atMin = values.filter(([v, x]) => x === v.min && v.type === 'number').length;
    const zeroOutside = values.filter(([v, x]) => x === 0 && v.min > 0).length;
    expect(vectors.every((v) => v.set === 'edge')).toBe(true);
    expect(atMin).toBeGreaterThan(0);
    expect(zeroOutside).toBeGreaterThan(0);
  });
});
