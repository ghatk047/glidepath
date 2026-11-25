import { describe, expect, it } from 'vitest';
import {
  bundleOf,
  loadSeedModel,
  membersOf,
  readFixture,
  type DepsFixture,
} from '../../test/helpers';
import { EngineError } from '../errors';
import { expand } from '../expand';
import { compileModel } from './compile';
import { topoSort } from './toposort';

const fixture = readFixture<DepsFixture>('deps.json');

const keysInOrder = (cells: { key: string }[], order: Int32Array) =>
  Array.from(order, (i) => cells[i]!.key);

describe('topological sort (toposort.spec.ts)', () => {
  it('Kahn order equals Model.order', async () => {
    const { bundle, seed } = await loadSeedModel();
    const cells = expand(bundle, seed.dimensionMembers);
    expect(keysInOrder(cells, topoSort(cells))).toEqual(fixture.order);
    expect(compileModel(bundle, seed.dimensionMembers).program.cellKeys).toEqual(fixture.order);
  });

  it('starts with zero in-degree cells in expansion order and visits users FIFO', () => {
    // The Kahn loop of Model._expand on the same graph gives: a, b, c, x, d, e.
    const cells = [
      { key: 'c', deps: ['a', 'in'] },
      { key: 'a', deps: [] },
      { key: 'd', deps: ['c', 'b'] },
      { key: 'b', deps: ['in'] },
      { key: 'e', deps: ['d', 'a', 'dangling'] },
      { key: 'x', deps: ['a'] },
    ];
    expect(keysInOrder(cells, topoSort(cells))).toEqual(['a', 'b', 'c', 'x', 'd', 'e']);
    expect(Array.from(topoSort([]))).toEqual([]);
  });

  it('a cycle is a load-time error naming up to 10 cells (cyclic fixture)', () => {
    // c01 → c02 → … → c12 → c01, plus `after` reading the ring and `ok` outside it.
    const ring = Array.from({ length: 12 }, (_, i) => `c${String(i + 1).padStart(2, '0')}`);
    const bundle = bundleOf({
      nodes: [
        { id: 'ok', expr: '1' },
        ...ring.map((id, i) => ({ id, expr: `${ring[(i + 1) % ring.length]} + ok` })),
        { id: 'after', expr: 'c05 * 2' },
      ],
    });
    let err: unknown;
    try {
      compileModel(bundle, membersOf({}));
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(EngineError);
    const e = err as EngineError;
    expect(e.code).toBe('CYCLE');
    // Python: RuntimeError(f"cycle in formula graph near {bad}"), bad = first 10 with in-degree > 0.
    expect(e.message).toBe(`cycle in formula graph near ${JSON.stringify(ring.slice(0, 10))}`);
    expect(e.cell).toBe('c01');

    const self = () => topoSort([{ key: 'n', deps: ['n'] }]);
    expect(self).toThrow(/cycle in formula graph near \["n"\]/);
    const dims = () =>
      compileModel(
        bundleOf({ nodes: [{ id: 'v', dims: ['d'], expr: "v['b'] + 1" }] }),
        membersOf({ d: ['a', 'b'] }),
      );
    expect(dims).toThrow(/cycle in formula graph near \["v\[a\]","v\[b\]"\]/);
  });
});
