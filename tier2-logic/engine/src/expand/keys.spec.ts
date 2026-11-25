import { describe, expect, it } from 'vitest';
import { membersOf } from '../../test/helpers';
import { EngineError } from '../errors';
import { cellKey, combos } from './keys';
import { MemberTable } from './members';
import { symbolDims } from './symbols';

const table = new MemberTable(membersOf({ a: ['a1', 'a2'], b: ['b1', 'b2', 'b3'], c: [] }));

describe('cell keys and combos (keys.spec.ts)', () => {
  it('cellKey and combos match Model.key and Model.combos', () => {
    // Model.key: f"{name}[{','.join(mem)}]" if mem else name
    expect(cellKey('res.net', [])).toBe('res.net');
    expect(cellKey('lev.rr', ['L01'])).toBe('lev.rr[L01]');
    expect(cellKey('hc.cost', ['pilots', 'fy27'])).toBe('hc.cost[pilots,fy27]');

    // Model.combos: first dim outermost; [()] for no dims.
    expect(combos([], table)).toEqual([[]]);
    expect(combos(['a', 'b'], table)).toEqual([
      ['a1', 'b1'],
      ['a1', 'b2'],
      ['a1', 'b3'],
      ['a2', 'b1'],
      ['a2', 'b2'],
      ['a2', 'b3'],
    ]);
    expect(combos(['b', 'a'], table, { b: ['b2'] })).toEqual([
      ['b2', 'a1'],
      ['b2', 'a2'],
    ]);
    expect(combos(['a'], table, { a: [] })).toEqual([['a1'], ['a2']]);
    expect(combos(['a', 'c'], table)).toEqual([]); // a dim without members has no cells
    expect(() => combos(['zz'], table)).toThrow(EngineError);
    expect(combos(['zz'], table, { zz: ['z1'] })).toEqual([['z1']]);
  });

  it('MemberTable keeps tenant order and reads attributes (id included)', () => {
    const t = new MemberTable(
      membersOf({
        line: [
          { id: 'l2', pool: 'sw' },
          { id: 'l1', pool: 'lab', q: 0 },
        ],
      }),
    );
    expect(t.ids('line')).toEqual(['l2', 'l1']);
    expect(t.attr('line', 'l1', 'pool')).toBe('lab');
    expect(t.attr('line', 'l1', 'q')).toBe(0);
    expect(t.attr('line', 'l1', 'id')).toBe('l1');
    expect(t.attr('line', 'l2', 'q')).toBeUndefined();
    expect(t.attr('line', 'l9', 'pool')).toBeUndefined();
    expect(t.attr('nodim', 'l1', 'pool')).toBeUndefined();
    expect(t.has('line')).toBe(true);
    expect(t.has('nodim')).toBe(false);
  });

  it('symbolDims lists variables and nodes with their dims (nodes win)', () => {
    const s = symbolDims({
      variables: [
        { id: 'x', dims: ['a'] },
        { id: 'y', dims: [] },
      ] as never,
      nodes: [{ id: 'y', dims: ['b'] }] as never,
    });
    expect(s.get('x')).toEqual({ kind: 'var', dims: ['a'] });
    expect(s.get('y')).toEqual({ kind: 'node', dims: ['b'] });
  });
});
