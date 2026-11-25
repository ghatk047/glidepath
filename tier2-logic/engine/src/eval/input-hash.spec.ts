import { describe, expect, it } from 'vitest';
import { bundleOf, membersOf } from '../../test/helpers';
import { compileModel } from '../compile';
import { float64Bits } from './input-hash';

const nodes = [{ id: 'r', dims: ['d'], expr: 'x + 1' }];
const variables = [{ id: 'x' }, { id: 'y' }];
const model = compileModel(bundleOf({ variables, nodes }), membersOf({ d: ['p', 'q'] }));
const values = new Map([
  ['x', 0.1],
  ['y', 2],
]);
const overrides = new Map([['r[p]', 5]]);
const HEX_SHA256 = /^[0-9a-f]{64}$/;

describe('inputHash', () => {
  it('is a SHA-256 of the sorted cells, independent of map order', () => {
    const h = model.inputHash(values, overrides);
    expect(h).toMatch(HEX_SHA256);
    const reversed = new Map([...values].reverse());
    expect(model.inputHash(reversed, new Map(overrides))).toBe(h);
    // Values and overrides are separate sections: moving a cell between them changes the hash.
    expect(model.inputHash(new Map([...values, ['r[p]', 5]]), new Map())).not.toBe(h);
  });

  it('a one-ulp change, a sign of zero or a new cell changes it', () => {
    const h = model.inputHash(values, overrides);
    const ulp = new Map(values).set('x', 0.10000000000000002);
    expect(0.10000000000000002 - 0.1).toBe(Number.EPSILON / 8 / 2);
    expect(model.inputHash(ulp, overrides)).not.toBe(h);
    const zero = model.inputHash(new Map([['x', 0]]), new Map());
    expect(model.inputHash(new Map([['x', -0]]), new Map())).not.toBe(zero);
    expect(model.inputHash(values, new Map([['r[p]', 5.000000000000001]]))).not.toBe(h);
    expect(model.inputHash(new Map(values).set('z', 0), overrides)).not.toBe(h);
  });

  it('includes the model version: the same cells on another model hash differently', () => {
    const h = model.inputHash(values, overrides);
    const reordered = compileModel(bundleOf({ variables, nodes }), membersOf({ d: ['q', 'p'] }));
    const otherSpec = compileModel(
      bundleOf({ variables, nodes: [{ id: 'r', dims: ['d'], expr: 'x + 2' }] }),
      membersOf({ d: ['p', 'q'] }),
    );
    expect(reordered.inputHash(values, overrides)).not.toBe(h);
    expect(otherSpec.inputHash(values, overrides)).not.toBe(h);
    expect(compileModel(model.bundle, model.members).inputHash(values, overrides)).toBe(h);
  });

  it('float64Bits is the big-endian bit pattern', () => {
    expect(float64Bits(1)).toBe('3ff0000000000000');
    expect(float64Bits(-0)).toBe('8000000000000000');
    expect(float64Bits(0.1)).toBe('3fb999999999999a');
  });
});
