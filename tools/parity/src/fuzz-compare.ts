/**
 * Fuzz comparison (G4, PORTING.md §6 Fuzz step 3): one vector's TS outcome against the oracle's. Both
 * evaluate: every node cell within 1e-6 relative / 1e-9 absolute (non-finite: both NaN or the same
 * infinity). One raises: the other must raise too, with a TS code that matches the Python exception class
 * (PORTING.md §5) and on the same cell.
 */
import { EngineError, type EngineErrorCode, type Evaluation } from '@glidepath/engine';
import { GOLDEN_ABS, GOLDEN_REL } from './round';

/** A value as fuzz_ref.py writes it: a float, or a non-finite float as a string. */
export type OracleValue = number | 'nan' | 'inf' | '-inf';

export interface OracleError {
  /** Python exception class name, or `complex` (D5). */
  readonly type: string;
  readonly message: string;
  /** Cell being computed; null when input resolution failed. */
  readonly cell: string | null;
}

export type OracleResult =
  | { readonly values: readonly OracleValue[]; readonly error?: undefined }
  | { readonly error: OracleError; readonly values?: undefined };

/** The file fuzz_ref.py writes. */
export interface OracleFile {
  readonly python: string;
  /** `Model.order`: every node cell, in topological order. */
  readonly order: readonly string[];
  readonly results: readonly OracleResult[];
}

export type TsOutcome =
  | { readonly ok: Evaluation; readonly err?: undefined }
  | { readonly err: EngineError; readonly ok?: undefined };

/** Runs `f`; an `EngineError` becomes `{err}`, anything else is rethrown. */
export function outcome(f: () => Evaluation): TsOutcome {
  try {
    return { ok: f() };
  } catch (e) {
    if (e instanceof EngineError) return { err: e };
    throw e;
  }
}

/**
 * Python exception class → the TS codes that correspond to it (PORTING.md §5), by stage: `inputs`
 * (`Model.input_cells`, no cell computed yet) or `run` (a cell was being computed).
 */
export const PY_ERROR_CODES: Readonly<
  Record<'inputs' | 'run', Readonly<Record<string, readonly EngineErrorCode[]>>>
> = {
  inputs: {
    KeyError: ['BAD_INPUT'],
    ValueError: ['BAD_INPUT'],
    StopIteration: ['BAD_INPUT'],
  },
  run: {
    ZeroDivisionError: ['DIV_ZERO'],
    KeyError: ['MISSING'],
    OverflowError: ['OVERFLOW'],
    complex: ['COMPLEX'],
    // TYPE, UNKNOWN_FUNCTION and ARITY are compile errors in TS (D1), so a model that compiled never
    // matches these at run time: such a vector is reported as a mismatch for a person to look at.
    TypeError: ['TYPE'],
    NameError: ['UNKNOWN_FUNCTION'],
    IndexError: ['ARITY'],
  },
};

export function decode(v: OracleValue): number {
  if (v === 'nan') return NaN;
  if (v === 'inf') return Infinity;
  if (v === '-inf') return -Infinity;
  return v;
}

/** `|ts - ref| <= max(1e-6 |ref|, 1e-9)`; non-finite values are close only to the same non-finite value. */
export function fuzzClose(ts: number, ref: number): boolean {
  if (!Number.isFinite(ts) || !Number.isFinite(ref)) {
    return Object.is(ts, ref) || (Number.isNaN(ts) && Number.isNaN(ref));
  }
  return Math.abs(ts - ref) <= Math.max(GOLDEN_REL * Math.abs(ref), GOLDEN_ABS);
}

export interface CellDiff {
  readonly cell: string;
  /** TS value (null: TS has no such cell). */
  readonly ts: number | null;
  readonly ref: number;
  /** Bitwise equal (NaN equals NaN). */
  readonly same: boolean;
  /** `|ts - ref|`: 0 when `same`, Infinity when not comparable (missing, NaN against a number, ±inf). */
  readonly abs: number;
  /** `abs / |ref|`: 0 when `abs` is 0, Infinity when `ref` is 0 or `abs` is Infinity. */
  readonly rel: number;
  readonly pass: boolean;
}

export type VectorStatus = 'ok' | 'raised' | 'miss' | 'raise-mismatch';

export interface VectorComparison {
  readonly status: VectorStatus;
  /** Node cells compared (0 when either side raised). */
  readonly cells: number;
  /** Cells whose values are bitwise equal (NaN equals NaN). */
  readonly bitEqual: number;
  /** Cells outside the tolerance (or missing in TS). */
  readonly misses: readonly CellDiff[];
  /** The cell with the largest relative difference among those not bitwise equal. */
  readonly worst: CellDiff | null;
  readonly python?: OracleError;
  readonly ts?: {
    readonly code: EngineErrorCode;
    readonly message: string;
    readonly cell: string | null;
  };
  /** Why a raise did not match. */
  readonly reason?: string;
}

export function diffOf(cell: string, ts: number | null, ref: number): CellDiff {
  if (ts === null) return { cell, ts, ref, same: false, abs: Infinity, rel: Infinity, pass: false };
  const same = Object.is(ts, ref) || (Number.isNaN(ts) && Number.isNaN(ref));
  const raw = same ? 0 : Math.abs(ts - ref);
  const abs = Number.isNaN(raw) ? Infinity : raw;
  const rel = abs === 0 ? 0 : ref === 0 || !Number.isFinite(abs) ? Infinity : abs / Math.abs(ref);
  return { cell, ts, ref, same, abs, rel, pass: fuzzClose(ts, ref) };
}

function tsError(err: EngineError): NonNullable<VectorComparison['ts']> {
  return { code: err.code, message: err.message, cell: err.cell ?? null };
}

/** Orders diffs for the report: failing first, then by relative, then by absolute difference. */
export function worse(a: CellDiff, b: CellDiff): boolean {
  if (a.pass !== b.pass) return !a.pass;
  if (a.rel !== b.rel) return a.rel > b.rel;
  return a.abs > b.abs;
}

/** Compares one vector: `order` is the oracle's Model.order, `ts` the TS outcome of the same inputs. */
export function compareVector(
  order: readonly string[],
  ref: OracleResult,
  ts: TsOutcome,
): VectorComparison {
  const none = { cells: 0, bitEqual: 0, misses: [], worst: null } as const;
  if (ref.error !== undefined || ts.err !== undefined) {
    const python = ref.error;
    const tsErr = ts.err === undefined ? undefined : tsError(ts.err);
    const fail = (reason: string): VectorComparison => ({
      ...none,
      status: 'raise-mismatch',
      ...(python && { python }),
      ...(tsErr && { ts: tsErr }),
      reason,
    });
    if (python === undefined) return fail(`TS raised ${tsErr!.code}, engine.py did not`);
    if (tsErr === undefined) return fail(`engine.py raised ${python.type}, TS did not`);
    const codes = PY_ERROR_CODES[python.cell === null ? 'inputs' : 'run'][python.type] ?? [];
    if (!codes.includes(tsErr.code)) {
      return fail(
        `engine.py ${python.type} expects ${codes.join('/') || 'no TS code'}, TS raised ${tsErr.code}`,
      );
    }
    if (python.cell !== tsErr.cell) {
      return fail(`engine.py raised computing ${python.cell}, TS computing ${tsErr.cell}`);
    }
    return { ...none, status: 'raised', python, ts: tsErr };
  }
  const ev = ts.ok!;
  const values = ref.values!;
  if (values.length !== order.length) {
    throw new Error(`fuzz: oracle wrote ${values.length} values for ${order.length} cells`);
  }
  const misses: CellDiff[] = [];
  let bitEqual = 0;
  let worst: CellDiff | null = null;
  for (let i = 0; i < order.length; i++) {
    const cell = order[i]!;
    const d = diffOf(cell, ev.has(cell) ? ev.get(cell) : null, decode(values[i]!));
    if (d.same) bitEqual++;
    else if (worst === null || worse(d, worst)) worst = d;
    if (!d.pass) misses.push(d);
  }
  return {
    status: misses.length === 0 ? 'ok' : 'miss',
    cells: order.length,
    bitEqual,
    misses,
    worst,
  };
}
