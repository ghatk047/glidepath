/**
 * The scalar interpreter of the lowered program: `Model.ev` + the loop of `Model.run` (engine.py
 * L205-261, L317-328). Runtime semantics are Python's (PORTING.md S02-S04, S06, S07, S13, S16-S18, S24).
 */
import {
  A_WORD,
  ABS,
  ADD,
  AND,
  B_WORD,
  CHK,
  DIV,
  DST_WORD,
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
  OR,
  POW,
  SDIV,
  SUB,
  SUM,
  WIDTH,
  type Program,
} from '../compile/program';
import { EngineError, type EngineErrorCode } from '../errors';
import { pyPow } from './pyops';

/** Thrown inside the loop; `runCells` adds the cell being computed and its source position. */
class Fault {
  constructor(
    readonly code: EngineErrorCode,
    readonly message: string,
    readonly instr: number,
  ) {}
}

/**
 * Runs node cells `from .. to` (topological indices) over `slots`. A pinned cell takes its pin and its
 * code does not run (S15). `present[i]` says whether input `i` was provided; a missing input fails
 * only when read (S20). Errors are `EngineError`s naming the cell being computed (`sources[c]` is that
 * cell's expression, for the position).
 */
export function runCells(
  p: Program,
  slots: Float64Array,
  present: Uint8Array,
  pinned: Uint8Array | null,
  pins: Float64Array | null,
  sources: readonly string[],
  from = 0,
  to = p.nCells,
): void {
  const code = p.code;
  const lists = p.lists;
  const start = p.cellStart;
  const inputBase = p.inputBase;
  let t = from;
  try {
    for (; t < to; t++) {
      if (pinned !== null && pinned[t] === 1) {
        slots[t] = pins![t]!;
        continue;
      }
      let pc = start[t]!;
      const end = start[t + 1]!;
      while (pc < end) {
        const o = pc * WIDTH;
        const op = code[o]!;
        const dst = code[o + DST_WORD]!;
        const a = code[o + A_WORD]!;
        const b = code[o + B_WORD]!;
        pc++;
        switch (op) {
          case MOV:
            slots[dst] = slots[a]!;
            break;
          case NEG:
            slots[dst] = -slots[a]!;
            break;
          case ADD:
            slots[dst] = slots[a]! + slots[b]!;
            break;
          case SUB:
            slots[dst] = slots[a]! - slots[b]!;
            break;
          case MUL:
            slots[dst] = slots[a]! * slots[b]!;
            break;
          case DIV: {
            const y = slots[b]!;
            if (y === 0) throw new Fault('DIV_ZERO', 'division by zero', pc - 1);
            slots[dst] = slots[a]! / y;
            break;
          }
          case POW:
            try {
              slots[dst] = pyPow(slots[a]!, slots[b]!);
            } catch (e) {
              const err = e as EngineError;
              throw new Fault(err.code, err.message, pc - 1);
            }
            break;
          case EQ:
            slots[dst] = slots[a] === slots[b] ? 1 : 0;
            break;
          case NE:
            slots[dst] = slots[a] !== slots[b] ? 1 : 0;
            break;
          case LT:
            slots[dst] = slots[a]! < slots[b]! ? 1 : 0;
            break;
          case LE:
            slots[dst] = slots[a]! <= slots[b]! ? 1 : 0;
            break;
          case GT:
            slots[dst] = slots[a]! > slots[b]! ? 1 : 0;
            break;
          case GE:
            slots[dst] = slots[a]! >= slots[b]! ? 1 : 0;
            break;
          case ABS:
            slots[dst] = Math.abs(slots[a]!);
            break;
          case NOT:
            // Python truthiness: only ±0 is false, NaN is true (S16).
            slots[dst] = slots[a] === 0 ? 1 : 0;
            break;
          case MIN:
          case MINOVER: {
            // Python min(): first element, replaced only by a strictly smaller one (S18).
            let r = slots[lists[a]!]!;
            for (let i = 1; i < b; i++) {
              const x = slots[lists[a + i]!]!;
              if (x < r) r = x;
            }
            slots[dst] = r;
            break;
          }
          case MAX:
          case MAXOVER: {
            let r = slots[lists[a]!]!;
            for (let i = 1; i < b; i++) {
              const x = slots[lists[a + i]!]!;
              if (x > r) r = x;
            }
            slots[dst] = r;
            break;
          }
          case AND: {
            let r = 1;
            for (let i = 0; i < b; i++) if (slots[lists[a + i]!] === 0) r = 0;
            slots[dst] = r;
            break;
          }
          case OR: {
            let r = 0;
            for (let i = 0; i < b; i++) if (slots[lists[a + i]!] !== 0) r = 1;
            slots[dst] = r;
            break;
          }
          case SUM: {
            // CPython >= 3.12 sum(): start 0, then Neumaier compensation, in member order (S06).
            let f = 0 + slots[lists[a]!]!;
            let c = 0;
            for (let i = 1; i < b; i++) {
              const x = slots[lists[a + i]!]!;
              const s = f + x;
              if (Math.abs(f) >= Math.abs(x)) c += f - s + x;
              else c += x - s + f;
              f = s;
            }
            if (c !== 0 && Number.isFinite(c)) f += c;
            slots[dst] = f;
            break;
          }
          case JF:
          case JZ:
            if (slots[a] === 0) pc = b;
            break;
          case JMP:
            pc = b;
            break;
          case SDIV:
            slots[dst] = slots[a]! / slots[b]!;
            break;
          case CHK:
            if (present[a - inputBase] !== 1) {
              throw new Fault('MISSING', `missing ${p.inputKeys[a - inputBase]!}`, pc - 1);
            }
            break;
          case MISS:
            throw new Fault('MISSING', p.messages[a]!, pc - 1);
        }
      }
    }
  } catch (e) {
    if (!(e instanceof Fault)) throw e;
    throw cellError(p, sources, t, e.code, e.message, e.instr);
  }
}

/**
 * The error of cell `t` (topological index) faulting at instruction `instr`: names the cell and the
 * position of the construct in its expression (D2). Scalar and batch evaluation both build it here.
 */
export function cellError(
  p: Program,
  sources: readonly string[],
  t: number,
  code: EngineErrorCode,
  message: string,
  instr: number,
): EngineError {
  const key = p.cellKeys[t]!;
  const source = sources[t] ?? '';
  const pos = p.positions[instr]!;
  return new EngineError(
    code,
    `while computing ${key}: ${message} (at ${pos} in '${source}')`,
    key,
    { pos, source },
  );
}
