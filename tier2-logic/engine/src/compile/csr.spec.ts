import { describe, expect, it } from 'vitest';
import { bundleOf, membersOf } from '../../test/helpers';
import { EngineError } from '../errors';
import { compileModel } from './compile';
import { downstreamIds } from './csr';

// 10 node cells over 2 inputs. Kahn order (Model._expand): a, b, g, c, h, d, e, f, j, k.
const model = compileModel(
  bundleOf({
    variables: [{ id: 'i1' }, { id: 'i2' }],
    nodes: [
      { id: 'a', expr: 'i1' },
      { id: 'b', expr: 'i2 * 2' },
      { id: 'c', expr: 'a + b' },
      { id: 'd', expr: 'IF(a > 0, c, i2)' },
      { id: 'e', expr: 'MAX(c, d)' },
      { id: 'f', expr: 'e - a' },
      { id: 'g', expr: '7' },
      { id: 'h', expr: 'g + i1' },
      { id: 'j', expr: 'SAFEDIV(f, h, b)' },
      { id: 'k', expr: 'j + d' },
    ],
  }),
  membersOf({}),
);
const g = model.graph;
const ORDER = ['a', 'b', 'g', 'c', 'h', 'd', 'e', 'f', 'j', 'k'];

describe('CSR adjacency (csr.spec.ts)', () => {
  it('forward and reverse CSR adjacency over cells in topological order and inputs', () => {
    expect(model.program.cellKeys).toEqual(ORDER);
    expect(g.keys).toEqual([...ORDER, 'i1', 'i2']);
    const deps = (k: string) => {
      const c = g.index.get(k)!;
      return Array.from(g.depIds.subarray(g.depOff[c]!, g.depOff[c + 1]!), (d) => g.keys[d]);
    };
    const users = (k: string) => {
      const c = g.index.get(k)!;
      return Array.from(g.userIds.subarray(g.userOff[c]!, g.userOff[c + 1]!), (u) => g.keys[u]);
    };
    // Deps in first-reference order; both IF branches count (Model.deps).
    expect(Object.fromEntries(ORDER.map((k) => [k, deps(k)]))).toEqual({
      a: ['i1'],
      b: ['i2'],
      g: [],
      c: ['a', 'b'],
      h: ['g', 'i1'],
      d: ['a', 'c', 'i2'],
      e: ['c', 'd'],
      f: ['e', 'a'],
      j: ['f', 'h', 'b'],
      k: ['j', 'd'],
    });
    // Users in topological order.
    expect(Object.fromEntries(g.keys.map((k) => [k, users(k)]))).toEqual({
      i1: ['a', 'h'],
      i2: ['b', 'd'],
      a: ['c', 'd', 'f'],
      b: ['c', 'j'],
      g: ['h'],
      c: ['d', 'e'],
      h: ['j'],
      d: ['e', 'k'],
      e: ['f'],
      f: ['j'],
      j: ['k'],
      k: [],
    });
    expect(g.depOff).toHaveLength(ORDER.length + 1);
    expect(g.userOff).toHaveLength(g.keys.length + 1);
    expect(g.depIds.length).toBe(g.userIds.length);
  });

  it('raw upstream/downstream correct on a 10-node fixture', () => {
    expect(model.upstream('k')).toEqual(['j', 'd', 'f', 'h', 'b', 'a', 'c', 'i2', 'e', 'g', 'i1']);
    expect(model.upstream('k', 1)).toEqual(['j', 'd']);
    expect(model.upstream('k', 2)).toEqual(['j', 'd', 'f', 'h', 'b', 'a', 'c', 'i2']);
    expect(model.upstream('k', 0)).toEqual([]);
    expect(model.upstream('g')).toEqual([]);
    expect(model.upstream('i1')).toEqual([]);

    expect(model.downstream('i1')).toEqual(['a', 'c', 'h', 'd', 'e', 'f', 'j', 'k']);
    expect(model.downstream('g')).toEqual(['h', 'j', 'k']);
    expect(model.downstream('b')).toEqual(['c', 'd', 'e', 'f', 'j', 'k']);
    expect(model.downstream('k')).toEqual([]);
    expect(
      Array.from(downstreamIds(g, [g.index.get('h')!, g.index.get('e')!]), (c) => g.keys[c]),
    ).toEqual(['f', 'j', 'k']);

    expect(() => model.upstream('nope')).toThrow(EngineError);
    expect(() => model.downstream('nope')).toThrow(/unknown cell nope/);
  });
});
