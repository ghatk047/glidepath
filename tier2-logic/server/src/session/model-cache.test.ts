import type { CompiledModel, Evaluation } from '@glidepath/engine';
import type { ModelBundle, TenantMembers } from '@glidepath/spec';
import { describe, expect, it, vi } from 'vitest';
import { diffCells, engineCell, splitWireCell, toEngineCell, toWireCell, wireValue } from './cells';
import { ModelCache, memberOrder } from './model-cache';
import type { ModelKey } from './model-cache';

/** A compiled model stand-in: `evaluate` returns an evaluation over the values it was given. */
function fakeModel(): CompiledModel {
  const evaluation = (values: ReadonlyMap<string, number>, overrides: ReadonlyMap<string, number>): Evaluation => ({
    get: (c) => values.get(c) ?? NaN,
    has: (c) => values.has(c),
    values,
    overrides,
  });
  return {
    evaluate: vi.fn((values, overrides = new Map()) => evaluation(values, overrides)),
  } as unknown as CompiledModel;
}

const bundle = { variables: [{ id: 'g.x', dims: [] }, { id: 'hc.rate', dims: ['lgroup', 'iyear'] }] } as unknown as ModelBundle;
const members = (...ids: string[]): TenantMembers => ({ vp: ids.map((id) => ({ id })) });
const key = (over: Partial<ModelKey> = {}): ModelKey => ({ tenantId: 't1', modelVersionId: 'mv1', membersHash: 'h1', ...over });

function cache(maxModels?: number) {
  const compile = vi.fn(() => fakeModel());
  const models = new ModelCache({ compile, ...(maxModels ? { maxModels } : {}) });
  const load = vi.fn(async () => bundle);
  return { models, compile, load };
}

describe('ModelCache keyed (tenant, model_version, members_hash)', () => {
  it('compiles once per key and hands every later lookup the same model', async () => {
    const { models, compile, load } = cache();
    const a = await models.get(key(), members('v1', 'v2'), load);
    const b = await models.get(key(), members('v1', 'v2'), load);
    expect(b).toBe(a);
    expect(a.key).toEqual(key());
    expect(compile).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledTimes(1);
    expect(models.stats()).toMatchObject({ hits: 1, misses: 1, compiles: 1, size: 1 });
    expect(models.keys()).toEqual([key()]);
  });

  it('another tenant, model version or members hash is another entry', async () => {
    const { models, compile, load } = cache();
    const base = await models.get(key(), members('v1'), load);
    for (const k of [key({ tenantId: 't2' }), key({ modelVersionId: 'mv2' }), key({ membersHash: 'h2' })]) {
      expect(await models.get(k, members('v1'), load)).not.toBe(base);
    }
    expect(compile).toHaveBeenCalledTimes(4);
    expect(models.stats().size).toBe(4);
  });

  it('concurrent lookups share one compile', async () => {
    const { models, compile, load } = cache();
    const [a, b, c] = await Promise.all([1, 2, 3].map(() => models.get(key(), members('v1'), load)));
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(compile).toHaveBeenCalledTimes(1);
  });

  it('a member order change (same hash: membersHash ignores order) recompiles, as SUM runs in member order', async () => {
    const { models, compile, load } = cache();
    const a = await models.get(key(), members('v1', 'v2'), load);
    const b = await models.get(key(), members('v2', 'v1'), load);
    expect(b).not.toBe(a);
    expect(compile).toHaveBeenCalledTimes(2);
    expect(memberOrder(members('v1', 'v2'))).not.toBe(memberOrder(members('v2', 'v1')));
    expect(await models.get(key(), members('v2', 'v1'), load)).toBe(b);
  });

  it('a failed bundle load is not kept', async () => {
    const { models, compile } = cache();
    await expect(models.get(key(), members('v1'), () => Promise.reject(new Error('no bundle')))).rejects.toThrow('no bundle');
    expect(models.stats().size).toBe(0);
    await models.get(key(), members('v1'), async () => bundle);
    expect(compile).toHaveBeenCalledTimes(1);
  });

  it('drops the least recently used model beyond maxModels', async () => {
    const { models, load } = cache(2);
    await models.get(key({ tenantId: 'a' }), members('v1'), load);
    await models.get(key({ tenantId: 'b' }), members('v1'), load);
    await models.get(key({ tenantId: 'a' }), members('v1'), load); // a is now the most recent
    await models.get(key({ tenantId: 'c' }), members('v1'), load);
    expect(models.keys().map((k) => k.tenantId)).toEqual(['a', 'c']);
  });

  it('exposes variable dims and member ids for preview checks', async () => {
    const { models, load } = cache();
    const m = await models.get(key(), members('v1', 'v2'), load);
    expect(m.variableDims.get('hc.rate')).toEqual(['lgroup', 'iyear']);
    expect([...(m.memberIds.get('vp') ?? [])]).toEqual(['v1', 'v2']);
  });
});

describe('committed evaluations', () => {
  it('evaluates once per scenario while its inputs stay bitwise the same', async () => {
    const { models, load } = cache();
    const m = await models.get(key(), members('v1'), load);
    const values = () => new Map([['g.x', 1], ['hc.rate[a,fy27]', 0.5]]);
    const a = m.committed('s1', values(), new Map());
    expect(m.committed('s1', values(), new Map())).toBe(a);
    expect(m.committed('s2', values(), new Map())).not.toBe(a);
    expect(m.committed('s1', new Map([['g.x', 1], ['hc.rate[a,fy27]', 0.25]]), new Map())).not.toBe(a);
    expect(m.committed('s1', new Map([['g.x', 1]]), new Map())).not.toBe(a);
    const pinned = m.committed('s1', values(), new Map([['res.net', 3]]));
    expect(m.committed('s1', values(), new Map([['res.net', 3]]))).toBe(pinned);
    expect(m.committed('s1', new Map([['g.x', -0], ['hc.rate[a,fy27]', 0.5]]), new Map())).not.toBe(
      m.committed('s1', new Map([['g.x', 0], ['hc.rate[a,fy27]', 0.5]]), new Map()),
    );
    expect(models.stats()).toMatchObject({ evaluationHits: 2 });
  });
});

describe('cell keys: wire `id[member]` and engine keys', () => {
  it('maps scalars (`res.net[]` ↔ `res.net`) and keeps member keys verbatim', () => {
    expect(toEngineCell('res.net[]')).toBe('res.net');
    expect(toEngineCell('hc.rate[pilots,fy27]')).toBe('hc.rate[pilots,fy27]');
    expect(toWireCell('res.net')).toBe('res.net[]');
    expect(toWireCell('vp.net[vp_x]')).toBe('vp.net[vp_x]');
    expect(engineCell('g.target_net', '')).toBe('g.target_net');
    expect(splitWireCell('res.net')).toBeNull();
    expect(() => toEngineCell('res.net')).toThrow(TypeError);
  });

  it('pushes non-finite or unknown values as null, and diffs against what was last sent', () => {
    const at = { has: (c: string) => c !== 'gone', get: (c: string) => (c === 'nan' ? NaN : c === 'neg0' ? -0 : 7) } as Evaluation;
    expect(wireValue(at, 'nan')).toBeNull();
    expect(wireValue(at, 'gone')).toBeNull();
    const subscribed = new Map([
      ['a[]', 'a'],
      ['nan[]', 'nan'],
      ['neg0[]', 'neg0'],
    ]) as never;
    const sent = new Map<never, number | null>([
      ['a[]' as never, 7],
      ['neg0[]' as never, 0],
    ]);
    expect(diffCells(at, subscribed, sent)).toEqual({ 'nan[]': null });
    expect(diffCells(at, subscribed, sent)).toEqual({});
  });
});
