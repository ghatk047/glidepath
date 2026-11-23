import { EngineError, type Evaluation } from '@glidepath/engine';
import { describe, expect, it } from 'vitest';
import {
  compareVector,
  decode,
  diffOf,
  fuzzClose,
  type OracleResult,
  type TsOutcome,
} from './fuzz-compare';

/** A TS evaluation holding exactly these cells. */
function evaluation(cells: Record<string, number>): TsOutcome {
  const map = new Map(Object.entries(cells));
  const ok = {
    has: (k: string) => map.has(k),
    get: (k: string) => map.get(k)!,
    values: new Map(),
    overrides: new Map(),
  } as unknown as Evaluation;
  return { ok };
}
const raised = (code: EngineError['code'], cell?: string): TsOutcome => ({
  err: new EngineError(code, `${code} test`, cell),
});
const pyError = (type: string, cell: string | null): OracleResult => ({
  error: { type, message: `${type} test`, cell },
});

const order = ['a', 'b', 'c'];

describe('fuzz comparison', () => {
  it('values: within 1e-6 relative / 1e-9 absolute; non-finite only against the same non-finite value', () => {
    expect(fuzzClose(1 + 0.9e-6, 1)).toBe(true);
    expect(fuzzClose(1 + 1.1e-6, 1)).toBe(false);
    expect(fuzzClose(0.9e-9, 0)).toBe(true);
    expect(fuzzClose(1.1e-9, 0)).toBe(false);
    expect(fuzzClose(-0, 0)).toBe(true);
    expect(fuzzClose(NaN, NaN)).toBe(true);
    expect(fuzzClose(Infinity, Infinity)).toBe(true);
    expect(fuzzClose(Infinity, -Infinity)).toBe(false);
    expect(fuzzClose(NaN, 0)).toBe(false);
    expect(fuzzClose(1e308, Infinity)).toBe(false);
    expect([decode('nan'), decode('inf'), decode('-inf'), decode(-0)]).toEqual([
      NaN,
      Infinity,
      -Infinity,
      -0,
    ]);
    expect(diffOf('x', -0, 0)).toMatchObject({ same: false, abs: 0, rel: 0, pass: true });
    expect(diffOf('x', null, 1)).toMatchObject({ abs: Infinity, pass: false });
  });

  it('both evaluate: every cell compared, bitwise equal counted, misses listed', () => {
    const ok = compareVector(
      order,
      { values: [1, 'nan', 2] },
      evaluation({ a: 1, b: NaN, c: 2 + 1e-12 }),
    );
    expect(ok).toMatchObject({ status: 'ok', cells: 3, bitEqual: 2, misses: [] });
    expect(ok.worst?.cell).toBe('c');
    const miss = compareVector(order, { values: [1, 2, 3] }, evaluation({ a: 1, b: 2.1, c: 3 }));
    expect(miss.status).toBe('miss');
    expect(miss.misses.map((d) => d.cell)).toEqual(['b']);
    const gone = compareVector(order, { values: [1, 2, 3] }, evaluation({ a: 1, b: 2 }));
    expect(gone.misses).toMatchObject([{ cell: 'c', ts: null, pass: false }]);
  });

  it('engine.py raises and TS does not: raise mismatch', () => {
    const c = compareVector(
      order,
      pyError('ZeroDivisionError', 'b'),
      evaluation({ a: 1, b: 2, c: 3 }),
    );
    expect(c.status).toBe('raise-mismatch');
    expect(c.reason).toBe('engine.py raised ZeroDivisionError, TS did not');
  });

  it('TS raises and engine.py does not: raise mismatch', () => {
    const c = compareVector(order, { values: [1, 2, 3] }, raised('DIV_ZERO', 'b'));
    expect(c.status).toBe('raise-mismatch');
    expect(c.reason).toBe('TS raised DIV_ZERO, engine.py did not');
  });

  it('both raise: the TS code must match the Python class (PORTING.md §5) and the cell must be the same', () => {
    expect(
      compareVector(order, pyError('ZeroDivisionError', 'b'), raised('DIV_ZERO', 'b')),
    ).toMatchObject({
      status: 'raised',
      python: { type: 'ZeroDivisionError', cell: 'b' },
      ts: { code: 'DIV_ZERO', cell: 'b' },
    });
    expect(compareVector(order, pyError('KeyError', 'c'), raised('MISSING', 'c')).status).toBe(
      'raised',
    );
    expect(compareVector(order, pyError('KeyError', null), raised('BAD_INPUT')).status).toBe(
      'raised',
    );
    expect(compareVector(order, pyError('StopIteration', null), raised('BAD_INPUT')).status).toBe(
      'raised',
    );
    expect(compareVector(order, pyError('complex', 'a'), raised('COMPLEX', 'a')).status).toBe(
      'raised',
    );
    expect(
      compareVector(order, pyError('OverflowError', 'a'), raised('OVERFLOW', 'a')).status,
    ).toBe('raised');

    const code = compareVector(order, pyError('ZeroDivisionError', 'b'), raised('MISSING', 'b'));
    expect([code.status, code.reason]).toEqual([
      'raise-mismatch',
      'engine.py ZeroDivisionError expects DIV_ZERO, TS raised MISSING',
    ]);
    // A KeyError while computing a cell is MISSING; before any cell (input_cells) it is BAD_INPUT.
    expect(compareVector(order, pyError('KeyError', 'b'), raised('BAD_INPUT')).status).toBe(
      'raise-mismatch',
    );
    const cell = compareVector(order, pyError('ZeroDivisionError', 'b'), raised('DIV_ZERO', 'c'));
    expect([cell.status, cell.reason]).toEqual([
      'raise-mismatch',
      'engine.py raised computing b, TS computing c',
    ]);
  });
});
