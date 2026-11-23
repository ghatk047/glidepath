/**
 * The resolved expression of one cell: the expander's output, the lowerer's input (PORTING.md §1).
 * Bound variables and attributes are folded to constants, references are cell keys, aggregates are the
 * member-ordered list of their terms (members that pass `where` only).
 */
import type { AttrValue, MemberId } from '@glidepath/spec';
import type { BinOp } from '../parse';
import type { CellKey } from '../types';

/** Functions of the language with their arity (S27). */
export const FUNCTIONS = {
  IF: { min: 3, max: 3 },
  SAFEDIV: { min: 2, max: 3 },
  MIN: { min: 1, max: Infinity },
  MAX: { min: 1, max: Infinity },
  ABS: { min: 1, max: 1 },
  AND: { min: 0, max: Infinity },
  OR: { min: 0, max: Infinity },
  NOT: { min: 1, max: 1 },
} as const satisfies Record<string, { min: number; max: number }>;

export type FnName = keyof typeof FUNCTIONS;

export const isFunction = (name: string): name is FnName => Object.hasOwn(FUNCTIONS, name);

/** Comparison operators: their result is 1 or 0 (S13). */
export const COMPARISONS: ReadonlySet<BinOp> = new Set(['==', '!=', '<', '<=', '>', '>=']);

/** A compile-time value: a number literal, string literal, member id or raw attribute value. */
export type ConstValue = AttrValue;

export type Resolved =
  | { readonly kind: 'const'; readonly value: ConstValue; readonly pos: number }
  /**
   * A read of a node cell or an input cell. `sym` says which kind of symbol the key belongs to; a node
   * key without a cell (subset gap, bad literal) is dangling and fails only when read (S20).
   */
  | {
      readonly kind: 'cell';
      readonly key: CellKey;
      readonly symbol: string;
      readonly sym: 'var' | 'node';
      readonly pos: number;
    }
  /** A missing member attribute in a value position: MISSING when evaluated (S21). */
  | { readonly kind: 'missing'; readonly message: string; readonly pos: number }
  | { readonly kind: 'neg'; readonly arg: Resolved; readonly pos: number }
  | {
      readonly kind: 'bin';
      readonly op: BinOp;
      readonly left: Resolved;
      readonly right: Resolved;
      readonly pos: number;
    }
  | {
      readonly kind: 'call';
      readonly fn: FnName;
      readonly args: readonly Resolved[];
      readonly pos: number;
    }
  /** `SUM`, `MAXOVER`, `MINOVER`: one term per member that passed `where`, in member order. */
  | {
      readonly kind: 'agg';
      readonly fn: 'SUM' | 'MAXOVER' | 'MINOVER';
      readonly terms: readonly Resolved[];
      readonly members: readonly MemberId[];
      readonly pos: number;
    };

/** True for a value that Python arithmetic accepts as a number (a float, an int, or a bool). */
export const isNumeric = (v: ConstValue): v is number | boolean =>
  typeof v === 'number' || typeof v === 'boolean';
