/**
 * The flat program a compiled model runs (docs/architecture/03 §1 Compilation pipeline, step 4).
 *
 * Every value lives in one Float64Array of slots:
 *
 *   [0, nCells)            node cells, in topological order (slot = cell id)
 *   [inputBase, +nInputs)  input cells the model reads, in first-reference order
 *   [constBase, +nConsts)  constants (filled from `consts` before a run)
 *   [tempBase, +nTemps)    temporaries, reused by every cell
 *
 * Each instruction is 4 int32 (`op, dst, a, b`), reads slots and writes at most one. Cell `c`'s code is
 * instructions `cellStart[c]` to `cellStart[c + 1]`; its last write is to slot `c`. Jumps are absolute
 * instruction indices inside the cell's code, so `IF` and `SAFEDIV` stay lazy. List operations (MIN,
 * MAX, AND, OR, SUM, MAXOVER, MINOVER) read `lists[a .. a + b)`, slot indices in argument / member order.
 */

/** Words per instruction. */
export const WIDTH = 4;
/** Word offsets inside an instruction: `op, dst, a, b`. */
export const DST_WORD = 1;
export const A_WORD = 2;
export const B_WORD = 3;

// Opcodes. `dst` is always the second word.
/** dst = slot a */
export const MOV = 0;
/** dst = -a */
export const NEG = 1;
export const ADD = 2;
export const SUB = 3;
export const MUL = 4;
/** dst = a / b; DIV_ZERO when b == ±0 (S04). */
export const DIV = 5;
/** dst = pyPow(a, b) (S24). */
export const POW = 6;
/** Comparisons: dst = 1 or 0 (S13). */
export const EQ = 7;
export const NE = 8;
export const LT = 9;
export const LE = 10;
export const GT = 11;
export const GE = 12;
export const ABS = 13;
/** dst = pyTruthy(a) ? 0 : 1 */
export const NOT = 14;
/** List ops over `lists[a .. a + b)`. */
export const MIN = 15;
export const MAX = 16;
export const AND = 17;
export const OR = 18;
/** Neumaier sum in member order (S06). */
export const SUM = 19;
/** Over at least one term (an empty MAXOVER/MINOVER is the constant 0, S07). */
export const MAXOVER = 20;
export const MINOVER = 21;
/** if (!pyTruthy(slot a)) goto b (IF, S02/S16). */
export const JF = 22;
/** if (slot a == 0) goto b (SAFEDIV divisor, S03). */
export const JZ = 23;
/** goto b */
export const JMP = 24;
/** dst = a / b for a divisor known to be non-zero (SAFEDIV). */
export const SDIV = 25;
/** MISSING unless input slot a was provided (S20: a missing input fails only when read). */
export const CHK = 26;
/** MISSING with `messages[a]` (a dangling key or a missing attribute, S20/S21). */
export const MISS = 27;

export const OP_NAMES: readonly string[] = [
  'MOV',
  'NEG',
  'ADD',
  'SUB',
  'MUL',
  'DIV',
  'POW',
  'EQ',
  'NE',
  'LT',
  'LE',
  'GT',
  'GE',
  'ABS',
  'NOT',
  'MIN',
  'MAX',
  'AND',
  'OR',
  'SUM',
  'MAXOVER',
  'MINOVER',
  'JF',
  'JZ',
  'JMP',
  'SDIV',
  'CHK',
  'MISS',
];

export interface Program {
  readonly code: Int32Array;
  /** Per instruction: offset in its cell's expression of the construct it computes (errors, D2). */
  readonly positions: Int32Array;
  readonly lists: Int32Array;
  /** nCells + 1 instruction offsets: cell c runs `cellStart[c] .. cellStart[c + 1]`. */
  readonly cellStart: Int32Array;
  readonly nCells: number;
  readonly inputBase: number;
  readonly nInputs: number;
  readonly constBase: number;
  /** Constant values, copied into `[constBase, constBase + consts.length)` before a run. */
  readonly consts: Float64Array;
  readonly tempBase: number;
  readonly nTemps: number;
  readonly nSlots: number;
  /** Key of each node cell (topological order) and input slot (first-reference order). */
  readonly cellKeys: readonly string[];
  readonly inputKeys: readonly string[];
  /** Messages of MISS instructions. */
  readonly messages: readonly string[];
}
