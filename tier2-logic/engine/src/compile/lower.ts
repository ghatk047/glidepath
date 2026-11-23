/**
 * Lowering (docs/architecture/03 §1 step 4): resolved cell expressions → one flat program over a
 * Float64Array of slots (layout in `program.ts`). Python evaluation order is kept: operands left to
 * right, IF and SAFEDIV lazy through jumps (S02, S03), aggregates as member-ordered slot lists (S06),
 * a missing input checked where it is read (S20).
 */
import type { Cell, ConstValue, Resolved, SymbolTable } from '../expand';
import { EngineError } from '../errors';
import type { BinOp } from '../parse';
import type { CellKey } from '../types';
import {
  ABS,
  ADD,
  AND,
  CHK,
  DIV,
  EQ,
  GE,
  GT,
  JF,
  JMP,
  JZ,
  LE,
  LT,
  MAX,
  MAXOVER,
  MIN,
  MINOVER,
  MISS,
  MOV,
  MUL,
  NE,
  NEG,
  NOT,
  OP_NAMES,
  OR,
  POW,
  SDIV,
  SUB,
  SUM,
  WIDTH,
  type Program,
} from './program';

const BIN_OPS: Readonly<Record<BinOp, number>> = {
  '+': ADD,
  '-': SUB,
  '*': MUL,
  '/': DIV,
  '^': POW,
  '==': EQ,
  '!=': NE,
  '<': LT,
  '<=': LE,
  '>': GT,
  '>=': GE,
};

const LIST_OPS = { MIN, MAX, AND, OR, SUM, MAXOVER, MINOVER } as const;

/** Operand word for "no operand" and an unpatched jump target. */
const NONE = -1;

/** Argument index of SAFEDIV's optional alternative. */
const SAFEDIV_ALT = 2;

/** Dedup key of a constant: distinguishes -0 from 0 and keeps one NaN. */
const constKey = (v: number) => (Object.is(v, -0) ? '-0' : String(v));

export interface Lowered {
  readonly program: Program;
  /** Node keys read by some cell that have no cell (subset gap, bad literal): MISSING when read (S20). */
  readonly dangling: readonly CellKey[];
}

/** The symbol of a key: `id` of `id` or `id[m1,m2]` (identifiers contain no `[`). */
export const symbolOf = (key: CellKey): string => {
  const i = key.indexOf('[');
  return i < 0 ? key : key.slice(0, i);
};

/**
 * Lowers `cells` (expansion order) in topological `order` (positions into `cells`). `symbols` tells
 * input variables from nodes for the deps of each cell.
 */
export function lower(cells: readonly Cell[], order: Int32Array, symbols: SymbolTable): Lowered {
  const nCells = order.length;
  const cellSlot = new Map<CellKey, number>();
  order.forEach((e, t) => cellSlot.set(cells[e]!.key, t));

  // Pass 1: input slots in first-reference order (deps of cells in topological order, so inputs read
  // only by a branch folded at compile time still get a slot), and constants.
  const inputSlot = new Map<CellKey, number>();
  const inputKeys: CellKey[] = [];
  const dangling: CellKey[] = [];
  const danglingSet = new Set<CellKey>();
  const constIndex = new Map<string, number>();
  const consts: number[] = [];
  const addConst = (v: number) => {
    const k = constKey(v);
    if (!constIndex.has(k)) {
      constIndex.set(k, consts.length);
      consts.push(v);
    }
  };
  addConst(0); // SAFEDIV default alt, empty aggregates
  addConst(NaN); // operand of an instruction a MISS makes unreachable
  const collect = (e: Resolved): void => {
    switch (e.kind) {
      case 'const':
        return addConst(numericConst(e.value, e.pos));
      case 'cell':
      case 'missing':
        return;
      case 'neg':
        return collect(e.arg);
      case 'bin':
        collect(e.left);
        return collect(e.right);
      case 'call':
        return e.args.forEach(collect);
      case 'agg':
        return e.terms.forEach(collect);
    }
  };
  for (let t = 0; t < nCells; t++) {
    const cell = cells[order[t]!]!;
    collect(cell.resolved);
  }
  for (let t = 0; t < nCells; t++) {
    const cell = cells[order[t]!]!;
    for (const d of cell.deps) {
      if (cellSlot.has(d) || inputSlot.has(d) || danglingSet.has(d)) continue;
      if (symbols.get(symbolOf(d))?.kind === 'var') {
        inputSlot.set(d, inputKeys.length);
        inputKeys.push(d);
      } else {
        danglingSet.add(d);
        dangling.push(d);
      }
    }
  }

  const inputBase = nCells;
  const constBase = inputBase + inputKeys.length;
  const tempBase = constBase + consts.length;
  const ZERO = constBase + constIndex.get(constKey(0))!;
  const NAN = constBase + constIndex.get(constKey(NaN))!;

  // Pass 2: code.
  const code: number[] = [];
  const lists: number[] = [];
  const messages: string[] = [];
  const cellStart = new Int32Array(nCells + 1);
  let nextTemp = 0;
  let maxTemp = 0;

  const emit = (op: number, dst: number, a: number, b: number): number => {
    code.push(op, dst, a, b);
    return code.length / WIDTH - 1;
  };
  const here = () => code.length / WIDTH;
  const patchTarget = (instr: number, target: number) => {
    code[instr * WIDTH + WIDTH - 1] = target;
  };
  const temp = (): number => {
    const s = tempBase + nextTemp++;
    if (nextTemp > maxTemp) maxTemp = nextTemp;
    return s;
  };
  const isTemp = (s: number) => s >= tempBase;
  /** The slot to write: the requested target, else a fresh temp at the current mark. */
  const dest = (target: number) => (target >= 0 ? target : temp());
  /** A leaf value (slot) delivered to `target`, if any. */
  const deliver = (slot: number, target: number): number => {
    if (target < 0 || target === slot) return slot;
    emit(MOV, target, slot, NONE);
    return target;
  };
  /** Release temps above `mark`, keeping `result` reserved when it is a temp. */
  const release = (mark: number, result: number) => {
    nextTemp = isTemp(result) ? Math.max(mark, result - tempBase + 1) : mark;
  };
  const miss = (message: string, target: number): number => {
    emit(MISS, NONE, messages.length, NONE);
    messages.push(message);
    return deliver(NAN, target);
  };

  /** Emits code computing `e`; returns the slot holding its value (`target` when given). */
  const lowerExpr = (e: Resolved, target: number): number => {
    const mark = nextTemp;
    switch (e.kind) {
      case 'const':
        return deliver(constBase + constIndex.get(constKey(numericConst(e.value, e.pos)))!, target);
      case 'cell': {
        const input = inputSlot.get(e.key);
        if (input !== undefined) {
          emit(CHK, NONE, inputBase + input, NONE);
          return deliver(inputBase + input, target);
        }
        const slot = cellSlot.get(e.key);
        if (slot !== undefined) return deliver(slot, target);
        return miss(`missing ${e.key}`, target);
      }
      case 'missing':
        return miss(e.message, target);
      case 'neg': {
        const a = lowerExpr(e.arg, NONE);
        nextTemp = mark;
        const dst = dest(target);
        emit(NEG, dst, a, NONE);
        release(mark, dst);
        return dst;
      }
      case 'bin': {
        const a = lowerExpr(e.left, NONE);
        const b = lowerExpr(e.right, NONE);
        nextTemp = mark;
        const dst = dest(target);
        emit(BIN_OPS[e.op], dst, a, b);
        release(mark, dst);
        return dst;
      }
      case 'call': {
        const args = e.args;
        switch (e.fn) {
          case 'IF': {
            const c = lowerExpr(args[0]!, NONE);
            nextTemp = mark;
            const dst = dest(target);
            const jf = emit(JF, NONE, c, NONE);
            lowerExpr(args[1]!, dst);
            const jmp = emit(JMP, NONE, NONE, NONE);
            patchTarget(jf, here());
            lowerExpr(args[2]!, dst);
            patchTarget(jmp, here());
            release(mark, dst);
            return dst;
          }
          case 'SAFEDIV': {
            // Divisor first; the numerator only when the divisor is non-zero; the alt only when it is.
            const b = lowerExpr(args[1]!, NONE);
            const dst = dest(target);
            const jz = emit(JZ, NONE, b, NONE);
            const a = lowerExpr(args[0]!, NONE);
            emit(SDIV, dst, a, b);
            const jmp = emit(JMP, NONE, NONE, NONE);
            patchTarget(jz, here());
            if (args.length > SAFEDIV_ALT) lowerExpr(args[SAFEDIV_ALT]!, dst);
            else emit(MOV, dst, ZERO, NONE);
            patchTarget(jmp, here());
            release(mark, dst);
            return dst;
          }
          case 'ABS':
          case 'NOT': {
            const a = lowerExpr(args[0]!, NONE);
            nextTemp = mark;
            const dst = dest(target);
            emit(e.fn === 'ABS' ? ABS : NOT, dst, a, NONE);
            release(mark, dst);
            return dst;
          }
          default:
            return lowerList(LIST_OPS[e.fn], args, target, mark);
        }
      }
      case 'agg':
        if (e.terms.length === 0) return deliver(ZERO, target); // S07; an empty SUM is 0 too
        return lowerList(LIST_OPS[e.fn], e.terms, target, mark);
    }
  };

  const lowerList = (op: number, items: readonly Resolved[], target: number, mark: number) => {
    const slots = items.map((x) => lowerExpr(x, NONE));
    nextTemp = mark;
    const dst = dest(target);
    const off = lists.length;
    lists.push(...slots);
    emit(op, dst, off, slots.length);
    release(mark, dst);
    return dst;
  };

  for (let t = 0; t < nCells; t++) {
    cellStart[t] = here();
    nextTemp = 0;
    const cell = cells[order[t]!]!;
    try {
      lowerExpr(cell.resolved, t);
    } catch (err) {
      if (err instanceof EngineError && err.cell === undefined) {
        throw new EngineError(err.code, `${err.message} (cell ${cell.key})`, cell.key, {
          pos: err.pos ?? 0,
          source: cell.expr,
        });
      }
      throw err;
    }
  }
  cellStart[nCells] = here();

  const program: Program = {
    code: Int32Array.from(code),
    lists: Int32Array.from(lists),
    cellStart,
    nCells,
    inputBase,
    nInputs: inputKeys.length,
    constBase,
    consts: Float64Array.from(consts),
    tempBase,
    nTemps: maxTemp,
    nSlots: tempBase + maxTemp,
    cellKeys: Array.from(order, (e) => cells[e]!.key),
    inputKeys,
    messages,
  };
  return { program, dangling };
}

/** A constant the program can hold: numbers, and bools as Python ints. */
function numericConst(v: ConstValue, pos: number): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  // The expander rejects non-numeric constants outside comparisons and indices (S26).
  throw new EngineError(
    'TYPE',
    `non-numeric constant ${JSON.stringify(v)} in a value position`,
    undefined,
    {
      pos,
      source: '',
    },
  );
}

/** Human-readable code of cell `t` (topological index): one line per instruction. */
export function disassemble(p: Program, t: number): string[] {
  const name = (s: number): string => {
    if (s < p.nCells) return p.cellKeys[s]!;
    if (s < p.constBase) return `in:${p.inputKeys[s - p.inputBase]!}`;
    if (s < p.tempBase) {
      const v = p.consts[s - p.constBase]!;
      return `#${Object.is(v, -0) ? '-0' : String(v)}`;
    }
    return `t${s - p.tempBase}`;
  };
  const start = p.cellStart[t]!;
  const out: string[] = [];
  for (let i = start; i < p.cellStart[t + 1]!; i++) {
    const [op, dst, a, b] = p.code.subarray(i * WIDTH, i * WIDTH + WIDTH) as unknown as number[];
    const opName = OP_NAMES[op!]!;
    let text: string;
    switch (op) {
      case JF:
      case JZ:
        text = `${opName} ${name(a!)} -> @${b! - start}`;
        break;
      case JMP:
        text = `JMP -> @${b! - start}`;
        break;
      case CHK:
        text = `CHK ${name(a!)}`;
        break;
      case MISS:
        text = `MISS ${JSON.stringify(p.messages[a!])}`;
        break;
      case MIN:
      case MAX:
      case AND:
      case OR:
      case SUM:
      case MAXOVER:
      case MINOVER:
        text = `${name(dst!)} = ${opName} [${Array.from(p.lists.subarray(a!, a! + b!), name).join(', ')}]`;
        break;
      case MOV:
        text = `${name(dst!)} = ${name(a!)}`;
        break;
      case NEG:
      case ABS:
      case NOT:
        text = `${name(dst!)} = ${opName} ${name(a!)}`;
        break;
      default:
        text = `${name(dst!)} = ${opName} ${name(a!)}, ${name(b!)}`;
    }
    out.push(`@${i - start} ${text}`);
  }
  return out;
}
