import { seedToTenantData } from '@glidepath/spec';
import { describe, expect, it } from 'vitest';
import { bundleOf, loadSeedModel } from '../../test/helpers';
import { EngineError } from '../errors';
import { findScenario, putValue, resolveInputs, variableDims } from './inputs';

const bundle = bundleOf({
  variables: [{ id: 's' }, { id: 'v', dims: ['d'] }, { id: 'w', dims: ['d', 'e'] }],
  nodes: [],
});

function codeOf(f: () => unknown): string {
  try {
    f();
  } catch (e) {
    if (e instanceof EngineError) return e.code;
    throw e;
  }
  return 'no error';
}

describe('resolveInputs (Model.input_cells)', () => {
  it('resolveInputs merges per cell like Model.input_cells', () => {
    const tenant = { s: 1, v: { p: 10, q: 20 }, w: { 'p,x': 5 } };
    const scenario = { values: { v: { q: 21 }, s: 2 }, overrides: { n: 1, m: 2 } };
    const extra = { values: { v: { p: 11, r: 30 } }, overrides: { m: 3 } };
    const { values, overrides } = resolveInputs(bundle, tenant, scenario, extra);
    // Tenant < scenario < extra, per cell: a dict replaces only the members it lists.
    expect(Object.fromEntries(values)).toEqual({
      s: 2,
      'v[p]': 11,
      'v[q]': 21,
      'v[r]': 30,
      'w[p,x]': 5,
    });
    // Overrides: scenario < extra.
    expect(Object.fromEntries(overrides)).toEqual({ n: 1, m: 3 });
    expect(Object.fromEntries(resolveInputs(bundle, tenant).values)).toEqual({
      s: 1,
      'v[p]': 10,
      'v[q]': 20,
      'w[p,x]': 5,
    });
  });

  it('rejects an unknown variable or scenario, a scalar for a dimensioned variable and a dict for a scalar with BAD_INPUT', () => {
    const dims = variableDims(bundle);
    const cells = new Map<string, number>();
    expect(codeOf(() => putValue(cells, dims, 'nope', 1))).toBe('BAD_INPUT');
    expect(codeOf(() => putValue(cells, dims, 'v', 1))).toBe('BAD_INPUT');
    expect(codeOf(() => putValue(cells, dims, 's', { a: 1 }))).toBe('BAD_INPUT'); // D7
    expect(codeOf(() => resolveInputs(bundle, {}, { values: { v: 3 } }))).toBe('BAD_INPUT');
    expect(codeOf(() => findScenario({ scenarios: [] }, 'C'))).toBe('BAD_INPUT');
    expect(cells.size).toBe(0);
  });

  it('every seed scenario resolves to what seedToTenantData gives', async () => {
    const { bundle: aa, seed } = await loadSeedModel();
    for (const sc of seed.scenarios.scenarios) {
      const mine = resolveInputs(aa, seed.variableValues, findScenario(seed.scenarios, sc.id));
      const spec = seedToTenantData(seed, sc.id, aa);
      expect([...mine.values], sc.id).toEqual([...spec.values]);
      expect([...mine.overrides], sc.id).toEqual([...spec.overrides]);
    }
  });
});
