import { describe, expect, it } from 'vitest';
import { bundleOf, membersOf } from '../../test/helpers';
import { compile, compileModel, type EngineModel } from '../compile';
import { EngineError } from '../errors';
import type { CellKey, Change, Evaluation } from '../types';
import type { SlotEvaluation } from './evaluate';
import { float64Bits } from './input-hash';

type Nodes = Parameters<typeof bundleOf>[0]['nodes'];

/** A synthetic model over the scalar variables `x, y, z, f`. */
function modelOf(nodes: Nodes): EngineModel {
  const variables = ['x', 'y', 'z', 'f'].map((id) => ({ id }));
  return compileModel(bundleOf({ variables, nodes }), membersOf({}));
}

const cells = (o: Record<string, number>) => new Map(Object.entries(o));
const set = (cell: CellKey, value: number): Change => ({ target: 'variable', cell, value });
const pin = (cell: CellKey, value: number | null): Change => ({ target: 'override', cell, value });

/** Keys in topological order (the order a dirty walk must visit them). */
function topo(model: EngineModel, keys: readonly CellKey[]): CellKey[] {
  return [...keys].sort((a, b) => model.index.get(a)! - model.index.get(b)!);
}

/** Every node cell and input of `a` and `b` as float64 bit patterns: equal ⇔ bitwise equal. */
function bits(model: EngineModel, ev: SlotEvaluation): string[] {
  const p = model.program;
  return Array.from(ev.slots.subarray(0, p.constBase), float64Bits);
}

/** The EngineError a thunk throws. */
function errorOf(f: () => unknown): EngineError {
  try {
    f();
  } catch (e) {
    if (e instanceof EngineError) return e;
    throw e;
  }
  throw new Error('expected an EngineError');
}

describe('rerun (Model.rerun, S23, D3)', () => {
  // x feeds a clamp (a) whose chain (b, c) stops early, and a direct path (d) that does not.
  const clamp: Nodes = [
    { id: 'a', expr: 'MAX(x, 10)' },
    { id: 'b', expr: 'a * 2' },
    { id: 'c', expr: 'b + y' },
    { id: 'd', expr: 'x + 1' },
    { id: 'e', expr: 'c + d' },
  ];

  it('rerun walks the reverse CSR in topological order and stops where a recomputed value is bitwise unchanged', () => {
    const model = modelOf(clamp);
    const prev = model.evaluate(cells({ x: 3, y: 1 }));
    expect(model.downstream('x')).toHaveLength(5);

    // a = MAX(5, 10) is recomputed and unchanged: its users b and c are not recomputed.
    const r1 = model.rerun(prev, [set('x', 5)]);
    expect(r1.diagnostics.recomputed).toEqual(topo(model, ['a', 'd', 'e']));
    expect(r1.diagnostics.recomputed).toHaveLength(3);
    expect(r1.diagnostics.changed).toEqual(topo(model, ['d', 'e']));
    expect(r1.diagnostics.full).toBe(false);
    expect(bits(model, r1)).toEqual(bits(model, model.evaluate(cells({ x: 5, y: 1 }))));
    expect([r1.get('a'), r1.get('e'), r1.get('x')]).toEqual([10, 27, 5]);

    // Past the clamp everything moves; e has two changed deps and is recomputed once, after both.
    const r2 = model.rerun(r1, [set('x', 20)]);
    expect(r2.diagnostics.recomputed).toEqual(topo(model, ['a', 'b', 'c', 'd', 'e']));
    expect(r2.diagnostics.changed).toEqual(r2.diagnostics.recomputed);
    expect(bits(model, r2)).toEqual(bits(model, model.evaluate(cells({ x: 20, y: 1 }))));

    // An input set to its current value (bitwise) dirties nothing.
    const r3 = model.rerun(r2, [set('y', 1)]);
    expect(r3.diagnostics.recomputed).toEqual([]);
    expect(bits(model, r3)).toEqual(bits(model, r2));

    // y reaches only c and e.
    const r4 = model.rerun(r2, [set('y', 2)]);
    expect(r4.diagnostics.recomputed).toEqual(topo(model, ['c', 'e']));
  });

  it('early stop compares float64 bits: 0 → −0 is a change, NaN → NaN is not', () => {
    const model = modelOf([
      { id: 'm', expr: 'x * 1' },
      { id: 'n', expr: 'm + 0' },
      { id: 'q', expr: 'n * 5' },
    ]);
    const prev = model.evaluate(cells({ x: 0 }));
    // m turns −0 (a change); n = −0 + 0 = 0 is unchanged, so q is not recomputed.
    const r = model.rerun(prev, [set('x', -0)]);
    expect(r.diagnostics.recomputed).toEqual(topo(model, ['m', 'n']));
    expect(r.diagnostics.changed).toEqual(['m']);
    expect(Object.is(r.get('m'), -0)).toBe(true);
    expect(bits(model, r)).toEqual(bits(model, model.evaluate(cells({ x: -0 }))));

    const nan = model.evaluate(cells({ x: NaN }));
    expect(model.rerun(nan, [set('x', NaN)]).diagnostics.recomputed).toEqual([]);
  });

  it('adding or removing an override marks that cell dirty', () => {
    const nodes: Nodes = [
      { id: 'a', expr: 'x / y' },
      { id: 'b', expr: 'a + 1' },
      { id: 'c', expr: 'b * 2' },
      { id: 'k', expr: 'y + 1' },
    ];
    const model = modelOf(nodes);
    const values = cells({ x: 6, y: 3 });
    const prev = model.evaluate(values);

    // A pin equal to the computed value: a is re-applied, nothing downstream moves.
    const same = model.rerun(prev, [pin('a', 2)]);
    expect(same.diagnostics.recomputed).toEqual(['a']);
    expect(same.diagnostics.changed).toEqual([]);
    expect([...same.overrides]).toEqual([['a', 2]]);

    // A new pin: a and its users, not its deps or the unrelated k.
    const added = model.rerun(prev, [pin('a', 5)]);
    expect(added.diagnostics.recomputed).toEqual(topo(model, ['a', 'b', 'c']));
    expect([added.get('a'), added.get('b'), added.get('c')]).toEqual([5, 6, 12]);
    expect(bits(model, added)).toEqual(bits(model, model.evaluate(values, cells({ a: 5 }))));

    // Changing the pin's value is the same walk.
    const moved = model.rerun(added, [pin('a', 7)]);
    expect(moved.diagnostics.recomputed).toEqual(topo(model, ['a', 'b', 'c']));
    expect([...moved.overrides]).toEqual([['a', 7]]);

    // Removing the pin recomputes a from its expression (Python would keep the stale pin, D3).
    const removed = model.rerun(added, [pin('a', null)]);
    expect(removed.diagnostics.recomputed).toEqual(topo(model, ['a', 'b', 'c']));
    expect([...removed.overrides]).toEqual([]);
    expect(bits(model, removed)).toEqual(bits(model, prev));

    // Removing a pin that is not there still marks the cell dirty; early stop keeps it local.
    expect(model.rerun(prev, [pin('b', null)]).diagnostics.recomputed).toEqual(['b']);

    // A pinned cell downstream of a changed input keeps its pin and stops the walk.
    const pinnedA = model.rerun(prev, [pin('a', 5)]);
    const moveX = model.rerun(pinnedA, [set('x', 9)]);
    expect(moveX.diagnostics.recomputed).toEqual(['a']);
    expect(moveX.get('a')).toBe(5);
    expect(bits(model, moveX)).toEqual(
      bits(model, model.evaluate(cells({ x: 9, y: 3 }), cells({ a: 5 }))),
    );

    // Only node cells can be pinned: other keys are ignored and reported, as evaluate does.
    const ignored = model.rerun(prev, [pin('x', 1), pin('ghost', 2), pin('y', null)]);
    expect(ignored.diagnostics.ignoredOverrides).toEqual(['x', 'ghost', 'y']);
    expect(ignored.diagnostics.recomputed).toEqual([]);
    expect([...ignored.overrides]).toEqual([]);
  });

  it('a pinned cell is not evaluated; removing the pin raises what evaluate raises', () => {
    const model = modelOf([
      { id: 'a', expr: 'x / y' },
      { id: 'b', expr: 'a + 1' },
    ]);
    const values = cells({ x: 1, y: 0 });
    const pinned = model.evaluate(values, cells({ a: 4 }));
    expect(model.rerun(pinned, [set('x', 2)]).get('b')).toBe(5);
    const full = errorOf(() => model.evaluate(values));
    const inc = errorOf(() => model.rerun(pinned, [pin('a', null)]));
    expect([inc.code, inc.cell, inc.message, inc.pos, inc.source]).toEqual([
      full.code,
      full.cell,
      full.message,
      full.pos,
      full.source,
    ]);
    expect(inc.code).toBe('DIV_ZERO');
  });

  it('an input change that makes a cell fail raises the error evaluate raises', () => {
    const model = modelOf([
      { id: 'a', expr: 'x / y' },
      { id: 'g', expr: 'IF(f, z, 0)' },
    ]);
    const prev = model.evaluate(cells({ x: 6, y: 3, f: 0 }));
    const before = bits(model, prev);
    const div = errorOf(() => model.rerun(prev, [set('y', 0)]));
    expect([div.code, div.cell]).toEqual(['DIV_ZERO', 'a']);
    expect(div.message).toBe(errorOf(() => model.evaluate(cells({ x: 6, y: 0, f: 0 }))).message);
    // z was never provided: taking the branch that reads it raises MISSING, as evaluate does.
    const miss = errorOf(() => model.rerun(prev, [set('f', 1)]));
    expect([miss.code, miss.cell]).toEqual(['MISSING', 'g']);
    // prev is untouched by a rerun that failed.
    expect(bits(model, prev)).toEqual(before);
  });

  it('an input that becomes present dirties its users, even when it was 0 before', () => {
    const model = modelOf([{ id: 'g', expr: 'IF(f, z, 0)' }]);
    const prev = model.evaluate(cells({ f: 0 }));
    expect(prev.has('z')).toBe(false);
    const withZ = model.rerun(prev, [set('z', 0)]);
    expect(withZ.diagnostics.recomputed).toEqual(['g']);
    expect(withZ.get('z')).toBe(0);
    const taken = model.rerun(withZ, [set('f', 1)]);
    expect(taken.get('g')).toBe(0);
    expect(model.rerun(taken, [set('z', 7)]).get('g')).toBe(7);
  });

  it('applies changes in order (last write wins) and keeps keys the model does not read', () => {
    const model = modelOf(clamp);
    const prev = model.evaluate(cells({ x: 3, y: 1 }));
    const r = model.rerun(prev, [set('x', 40), set('zz', 4), set('x', 30)]);
    expect(bits(model, r)).toEqual(bits(model, model.evaluate(cells({ x: 30, y: 1 }))));
    expect(r.get('zz')).toBe(4);
    expect([...r.values]).toEqual([
      ['x', 30],
      ['y', 1],
      ['zz', 4],
    ]);
    expect(model.rerun(prev, [set('zz', 4)]).diagnostics.recomputed).toEqual([]);
    expect(model.rerun(prev, []).diagnostics.recomputed).toEqual([]);
  });

  it("a 'variable' change naming a node cell is BAD_INPUT: pins are 'override' changes (D3)", () => {
    const model = modelOf(clamp);
    const prev = model.evaluate(cells({ x: 3, y: 1 }));
    const e = errorOf(() => model.rerun(prev, [set('b', 1)]));
    expect([e.code, e.cell]).toEqual(['BAD_INPUT', 'b']);
  });

  it('leaves prev unchanged: a rerun returns a new evaluation', () => {
    const model = modelOf(clamp);
    const prev = model.evaluate(cells({ x: 3, y: 1 }), cells({ c: 1 }));
    const before = bits(model, prev);
    const r = model.rerun(prev, [set('x', 50), set('y', 2), pin('c', null), pin('b', 9)]);
    expect(bits(model, prev)).toEqual(before);
    expect([...prev.values]).toEqual([
      ['x', 3],
      ['y', 1],
    ]);
    expect([...prev.overrides]).toEqual([['c', 1]]);
    expect(r.slots).not.toBe(prev.slots);
    expect(bits(model, r)).toEqual(
      bits(model, model.evaluate(cells({ x: 50, y: 2 }), cells({ b: 9 }))),
    );
  });

  it('an evaluation from another compiled model or implementation is rerun in full', () => {
    const model = modelOf(clamp);
    const twin = modelOf(clamp);
    const values = cells({ x: 3, y: 1 });
    const foreign = twin.evaluate(values, cells({ b: 4 }));
    const r = model.rerun(foreign, [set('x', 5)]);
    expect(r.diagnostics.full).toBe(true);
    expect(r.diagnostics.recomputed).toEqual(model.program.cellKeys);
    // Compared with the foreign values: x moved d and e; b keeps its pin.
    expect(r.diagnostics.changed).toEqual(topo(model, ['d', 'e']));
    expect(bits(model, r)).toEqual(
      bits(model, model.evaluate(cells({ x: 5, y: 1 }), cells({ b: 4 }))),
    );

    // Any Evaluation works; its non-node override keys are ignored and reported.
    const plain: Evaluation = {
      values,
      overrides: cells({ ghost: 1 }),
      get: (k) => values.get(k) ?? 0,
      has: (k) => values.has(k),
    };
    const r2 = model.rerun(plain, [pin('nope', 1)]);
    expect(r2.diagnostics.full).toBe(true);
    expect(r2.diagnostics.ignoredOverrides).toEqual(['nope', 'ghost']);
    expect(r2.diagnostics.changed).toEqual(model.program.cellKeys);
    expect(bits(model, r2)).toEqual(bits(model, model.evaluate(values)));
  });

  it('is CompiledModel.rerun of the public interface', () => {
    const model = compile(bundleOf({ variables: [{ id: 'x' }], nodes: clamp.slice(0, 2) }), {});
    const r = model.rerun(model.evaluate(cells({ x: 30 })), [set('x', 31)]);
    expect([r.get('a'), r.get('b')]).toEqual([31, 62]);
  });
});
