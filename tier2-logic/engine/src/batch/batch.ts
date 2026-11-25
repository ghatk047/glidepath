/**
 * Batch mode (docs/architecture/03 §1 Modes, Batch; solvers.json `engine_contract.vectorised`):
 * `evaluateBatch(base, vectors)` runs N input vectors at once in structure-of-arrays form.
 *
 * - Only the downstream closure of the varied inputs runs: node cells reachable from them over the
 *   reverse CSR, stopping at pinned cells (a pin does not move). Every other slot keeps its value from
 *   the base evaluation and is read as a scalar, broadcast to the lanes.
 * - Each closure cell, varied input and temporary is one Float64Array of lanes. The lowered program of
 *   the scalar interpreter runs unchanged, one instruction over all active lanes at a time.
 * - Lanes carry masks. `IF` and `SAFEDIV` are elementwise selects: at a conditional jump the active
 *   lanes split by their own condition, the taken branch runs on its lanes only and the other branch on
 *   the rest. A lane never runs code of a branch it did not take, so an error there cannot reach it
 *   (S02, S03), and a lane never takes another lane's path.
 * - Errors are per lane. A lane that faults (DIV_ZERO in a taken branch, MISSING, pyPow) gets the very
 *   `EngineError` a scalar `evaluate` of that lane throws, is marked failed and drops out of the active
 *   set; the other lanes finish. A failed lane's values are NaN.
 *
 * Every operation is the scalar interpreter's (S04, S06, S13, S16, S18, S24) on one lane, in the same
 * order, so each lane is bitwise equal to `evaluate` of its inputs. Lanes run in blocks of
 * `LANE_BLOCK` so temporaries stay small and in cache whatever N is.
 */
import type { Adjacency } from '../compile/csr';
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
import { cellError, evaluate, pyPow, SlotEvaluation, type EvaluableModel } from '../eval';
import type { BatchInput, BatchResult, CellKey, Evaluation } from '../types';

/** Lanes per block: temporaries are `LANE_BLOCK` float64 each. */
export const LANE_BLOCK = 512;

/** What `evaluateBatch` needs of a compiled model: the program and the reverse adjacency. */
export interface BatchableModel extends EvaluableModel {
  readonly graph: Pick<Adjacency, 'userOff' | 'userIds'>;
}

/** What a batch did, beside the lane values. */
export interface BatchDiagnostics {
  /** Varied keys the model does not read (not inputs of the program): they move nothing. */
  readonly ignored: readonly CellKey[];
  /** Node cells that ran, in topological order (= the keys of `values`). */
  readonly computed: readonly CellKey[];
}

/** The result `evaluateBatch` returns. */
export type BatchEvaluation = BatchResult & { readonly diagnostics: BatchDiagnostics };

/**
 * `evaluateBatch(base, vectors)` (03 §1). `base` gives every input and pin a lane does not vary; when it
 * is not an evaluation of this model, its inputs and pins are evaluated first. Throws only for a bad
 * request (BAD_INPUT: size, vector length, a node cell as a varied key); lane errors go in `errors`.
 */
export function evaluateBatch(
  model: BatchableModel,
  base: Evaluation,
  vectors: BatchInput,
): BatchEvaluation {
  const p = model.program;
  const n = vectors.size;
  if (!Number.isInteger(n) || n < 0) {
    throw new EngineError('BAD_INPUT', `batch size must be a non-negative integer, got ${n}`);
  }
  const ev =
    base instanceof SlotEvaluation && base.model === model
      ? base
      : evaluate(model, base.values, base.overrides);

  // Varied input slots and their lane values.
  const inputEnd = p.inputBase + p.nInputs;
  const varied = new Map<number, Float64Array>();
  const ignored: CellKey[] = [];
  for (const [key, lanes] of vectors.values) {
    if (lanes.length !== n) {
      throw new EngineError(
        'BAD_INPUT',
        `${key} has ${lanes.length} lane values for a batch of ${n}`,
        key,
      );
    }
    const id = model.index.get(key);
    if (id !== undefined && id < p.nCells) {
      throw new EngineError(
        'BAD_INPUT',
        `${key} is a node cell: pin it in the base evaluation`,
        key,
      );
    }
    if (id === undefined || id >= inputEnd) ignored.push(key);
    else varied.set(id, lanes);
  }

  const closure = closureOf(model, ev, varied.keys());
  const computed = Array.from(closure, (t) => p.cellKeys[t]!);
  const out = new Map<CellKey, Float64Array>();
  const outArrays: Float64Array[] = [];
  for (const t of closure) {
    const a = new Float64Array(n);
    out.set(p.cellKeys[t]!, a);
    outArrays.push(a);
  }
  const failed = new Uint8Array(n);
  const errors = new Map<number, EngineError>();
  if (closure.length > 0 && n > 0) {
    new BatchRun(model, ev, varied, closure, outArrays, failed, errors).run();
    for (const lane of errors.keys()) for (const a of outArrays) a[lane] = NaN;
  }
  return { size: n, values: out, failed, errors, diagnostics: { ignored, computed } };
}

/**
 * Node cells downstream of the varied input slots, ascending (topological). A pinned cell takes its pin
 * whatever its deps are, so it is not in the closure and does not propagate.
 */
function closureOf(model: BatchableModel, ev: SlotEvaluation, from: Iterable<number>): Int32Array {
  const p = model.program;
  const { userOff, userIds } = model.graph;
  const pinned = new Uint8Array(p.nCells);
  for (const key of ev.overrides.keys()) pinned[model.index.get(key)!] = 1;
  const seen = new Uint8Array(p.nCells);
  const stack = [...from];
  let count = 0;
  while (stack.length > 0) {
    const k = stack.pop()!;
    for (let o = userOff[k]!; o < userOff[k + 1]!; o++) {
      const u = userIds[o]!;
      if (seen[u] === 1 || pinned[u] === 1) continue;
      seen[u] = 1;
      count++;
      stack.push(u);
    }
  }
  const out = new Int32Array(count);
  let i = 0;
  for (let c = 0; c < p.nCells && i < count; c++) if (seen[c] === 1) out[i++] = c;
  return out;
}

/** One batch run: lane state, block by block. */
class BatchRun {
  private readonly p: Program;
  /** Per slot: its lanes in the current block (closure cells, varied inputs, temps, broadcasts). */
  private readonly lanes: Float64Array[];
  /** Per lane of the block: 1 while the lane has not failed. */
  private readonly alive = new Uint8Array(LANE_BLOCK);
  /** Active-lane lists: [0] the block's lanes, then a (then, else) pair per branch depth. */
  private readonly pool: Int32Array[][] = [];
  /** Bumped on every lane fault, so active lists know to drop failed lanes. */
  private faults = 0;
  /** First lane of the current block, and the closure cell running (topological index). */
  private lo = 0;
  private t = 0;
  /** Scratch for list operations: the lane arrays of the list. */
  private listArrays: Float64Array[] = [];

  constructor(
    private readonly model: BatchableModel,
    private readonly ev: SlotEvaluation,
    private readonly varied: ReadonlyMap<number, Float64Array>,
    private readonly closure: Int32Array,
    private readonly outArrays: readonly Float64Array[],
    private readonly failed: Uint8Array,
    private readonly errors: Map<number, EngineError>,
  ) {
    const p = model.program;
    this.p = p;
    const block = Math.min(LANE_BLOCK, failed.length);
    this.lanes = new Array<Float64Array>(p.nSlots);
    for (let s = p.tempBase; s < p.nSlots; s++) this.lanes[s] = new Float64Array(block);
    // Every slot a closure cell reads that the batch never writes: its base value, broadcast once.
    const inClosure = new Uint8Array(p.nCells);
    for (const t of closure) inClosure[t] = 1;
    const isLane = (s: number) =>
      (s < p.nCells && inClosure[s] === 1) || varied.has(s) || s >= p.tempBase;
    const broadcast = (s: number) => {
      if (s < 0 || isLane(s) || this.lanes[s] !== undefined) return;
      this.lanes[s] = new Float64Array(block).fill(ev.slots[s]!);
    };
    for (const t of closure) {
      for (let pc = p.cellStart[t]!; pc < p.cellStart[t + 1]!; pc++) {
        const o = pc * WIDTH;
        const op = p.code[o]!;
        if (op === JMP || op === MISS || op === CHK) continue;
        if (isListOp(op)) {
          const a = p.code[o + A_WORD]!;
          const b = p.code[o + B_WORD]!;
          for (let i = a; i < a + b; i++) broadcast(p.lists[i]!);
          continue;
        }
        broadcast(p.code[o + A_WORD]!);
        if (op !== JF && op !== JZ) broadcast(p.code[o + B_WORD]!);
      }
    }
  }

  run(): void {
    const n = this.failed.length;
    const top = new Int32Array(Math.min(LANE_BLOCK, n));
    for (let lo = 0; lo < n; lo += LANE_BLOCK) {
      const m = Math.min(LANE_BLOCK, n - lo);
      this.lo = lo;
      for (const [s, v] of this.varied) this.lanes[s] = v.subarray(lo, lo + m);
      this.closure.forEach((t, j) => {
        this.lanes[t] = this.outArrays[j]!.subarray(lo, lo + m);
      });
      this.alive.fill(1, 0, m);
      let live = m;
      for (let i = 0; i < m; i++) top[i] = i;
      for (const t of this.closure) {
        if (live === 0) break;
        this.t = t;
        live = this.exec(this.p.cellStart[t]!, this.p.cellStart[t + 1]!, top, live, 0);
      }
    }
  }

  /** Keeps the lanes of `list[0 .. m)` that have not failed; returns how many. */
  private compact(list: Int32Array, m: number): number {
    let k = 0;
    for (let j = 0; j < m; j++) {
      const i = list[j]!;
      if (this.alive[i] === 1) list[k++] = i;
    }
    return k;
  }

  /** Lane `i` of the block faulted at instruction `instr` of the running cell. */
  private fault(i: number, code: EngineErrorCode, message: string, instr: number): void {
    if (this.alive[i] === 0) return;
    this.alive[i] = 0;
    this.faults++;
    const lane = this.lo + i;
    this.failed[lane] = 1;
    this.errors.set(lane, cellError(this.p, this.model.sources, this.t, code, message, instr));
  }

  /** The (then, else) lane lists of branch depth `depth`. */
  private split(depth: number): Int32Array[] {
    let pair = this.pool[depth];
    if (pair === undefined) {
      const size = this.alive.length;
      pair = [new Int32Array(size), new Int32Array(size)];
      this.pool[depth] = pair;
    }
    return pair;
  }

  /**
   * Runs instructions `pc .. end` on lanes `L[0 .. m)`. A conditional jump splits the lanes by their
   * condition: the code up to the branch's closing JMP runs on the lanes that fall through, the code
   * from the jump target to the JMP's target on the lanes that jump (the lowering emits IF and SAFEDIV
   * in exactly this shape). Lanes that fail are dropped from `L` in place; returns how many remain.
   */
  private exec(pc: number, end: number, L: Int32Array, m: number, depth: number): number {
    const p = this.p;
    const code = p.code;
    const S = this.lanes;
    while (pc < end && m > 0) {
      const o = pc * WIDTH;
      const op = code[o]!;
      const dst = code[o + DST_WORD]!;
      const a = code[o + A_WORD]!;
      const b = code[o + B_WORD]!;
      const instr = pc;
      const before = this.faults;
      pc++;
      switch (op) {
        case JF:
        case JZ: {
          const join = code[(b - 1) * WIDTH + B_WORD]!;
          if (code[(b - 1) * WIDTH]! !== JMP || join < b) {
            throw new EngineError('NOT_IMPLEMENTED', `unstructured jump at ${instr} in batch`);
          }
          const C = S[a]!;
          const [T, F] = this.split(depth + 1) as [Int32Array, Int32Array];
          let mt = 0;
          let mf = 0;
          for (let k = 0; k < m; k++) {
            const i = L[k]!;
            // JF and JZ both jump when the slot is ±0 (Python truthiness, S16; SAFEDIV divisor, S03).
            if (C[i] === 0) F[mf++] = i;
            else T[mt++] = i;
          }
          if (mt > 0) this.exec(pc, b - 1, T, mt, depth + 1);
          if (mf > 0) this.exec(b, join, F, mf, depth + 1);
          pc = join;
          break;
        }
        case JMP:
          pc = b;
          break;
        case CHK:
          if (!this.varied.has(a) && !this.ev.values.has(p.inputKeys[a - p.inputBase]!)) {
            const message = `missing ${p.inputKeys[a - p.inputBase]!}`;
            for (let k = 0; k < m; k++) this.fault(L[k]!, 'MISSING', message, instr);
          }
          break;
        case MISS:
          for (let k = 0; k < m; k++) this.fault(L[k]!, 'MISSING', p.messages[a]!, instr);
          break;
        default:
          this.op(op, S[dst]!, a, b, L, m, instr);
      }
      if (this.faults !== before) m = this.compact(L, m);
    }
    return m;
  }

  /** One value instruction on lanes `L[0 .. m)`: the scalar interpreter's operation, per lane. */
  private op(
    op: number,
    D: Float64Array,
    a: number,
    b: number,
    L: Int32Array,
    m: number,
    instr: number,
  ): void {
    const S = this.lanes;
    switch (op) {
      case MOV: {
        const A = S[a]!;
        for (let k = 0; k < m; k++) {
          const i = L[k]!;
          D[i] = A[i]!;
        }
        return;
      }
      case NEG: {
        const A = S[a]!;
        for (let k = 0; k < m; k++) {
          const i = L[k]!;
          D[i] = -A[i]!;
        }
        return;
      }
      case ABS: {
        const A = S[a]!;
        for (let k = 0; k < m; k++) {
          const i = L[k]!;
          D[i] = Math.abs(A[i]!);
        }
        return;
      }
      case NOT: {
        const A = S[a]!;
        for (let k = 0; k < m; k++) {
          const i = L[k]!;
          D[i] = A[i] === 0 ? 1 : 0;
        }
        return;
      }
      case MIN:
      case MAX:
      case MINOVER:
      case MAXOVER:
      case AND:
      case OR:
      case SUM:
        return this.listOp(op, D, a, b, L, m);
    }
    const A = S[a]!;
    const B = S[b]!;
    switch (op) {
      case ADD:
        for (let k = 0; k < m; k++) {
          const i = L[k]!;
          D[i] = A[i]! + B[i]!;
        }
        return;
      case SUB:
        for (let k = 0; k < m; k++) {
          const i = L[k]!;
          D[i] = A[i]! - B[i]!;
        }
        return;
      case MUL:
        for (let k = 0; k < m; k++) {
          const i = L[k]!;
          D[i] = A[i]! * B[i]!;
        }
        return;
      case DIV:
        for (let k = 0; k < m; k++) {
          const i = L[k]!;
          const y = B[i]!;
          if (y === 0) this.fault(i, 'DIV_ZERO', 'division by zero', instr);
          else D[i] = A[i]! / y;
        }
        return;
      case SDIV:
        for (let k = 0; k < m; k++) {
          const i = L[k]!;
          D[i] = A[i]! / B[i]!;
        }
        return;
      case POW:
        for (let k = 0; k < m; k++) {
          const i = L[k]!;
          try {
            D[i] = pyPow(A[i]!, B[i]!);
          } catch (e) {
            const err = e as EngineError;
            this.fault(i, err.code, err.message, instr);
          }
        }
        return;
      case EQ:
        for (let k = 0; k < m; k++) {
          const i = L[k]!;
          D[i] = A[i] === B[i] ? 1 : 0;
        }
        return;
      case NE:
        for (let k = 0; k < m; k++) {
          const i = L[k]!;
          D[i] = A[i] !== B[i] ? 1 : 0;
        }
        return;
      case LT:
        for (let k = 0; k < m; k++) {
          const i = L[k]!;
          D[i] = A[i]! < B[i]! ? 1 : 0;
        }
        return;
      case LE:
        for (let k = 0; k < m; k++) {
          const i = L[k]!;
          D[i] = A[i]! <= B[i]! ? 1 : 0;
        }
        return;
      case GT:
        for (let k = 0; k < m; k++) {
          const i = L[k]!;
          D[i] = A[i]! > B[i]! ? 1 : 0;
        }
        return;
      case GE:
        for (let k = 0; k < m; k++) {
          const i = L[k]!;
          D[i] = A[i]! >= B[i]! ? 1 : 0;
        }
        return;
    }
    throw new EngineError('NOT_IMPLEMENTED', `opcode ${op} in batch`);
  }

  /** List operations over `lists[a .. a + b)`, per lane in list order (S06, S18). */
  private listOp(
    op: number,
    D: Float64Array,
    a: number,
    b: number,
    L: Int32Array,
    m: number,
  ): void {
    const lists = this.p.lists;
    const X = this.listArrays;
    X.length = b;
    for (let j = 0; j < b; j++) X[j] = this.lanes[lists[a + j]!]!;
    const X0 = X[0]!;
    switch (op) {
      case MIN:
      case MINOVER:
        // Python min(): first element, replaced only by a strictly smaller one (S18).
        for (let k = 0; k < m; k++) {
          const i = L[k]!;
          let r = X0[i]!;
          for (let j = 1; j < b; j++) {
            const x = X[j]![i]!;
            if (x < r) r = x;
          }
          D[i] = r;
        }
        return;
      case MAX:
      case MAXOVER:
        for (let k = 0; k < m; k++) {
          const i = L[k]!;
          let r = X0[i]!;
          for (let j = 1; j < b; j++) {
            const x = X[j]![i]!;
            if (x > r) r = x;
          }
          D[i] = r;
        }
        return;
      case AND:
        for (let k = 0; k < m; k++) {
          const i = L[k]!;
          let r = 1;
          for (let j = 0; j < b; j++) if (X[j]![i] === 0) r = 0;
          D[i] = r;
        }
        return;
      case OR:
        for (let k = 0; k < m; k++) {
          const i = L[k]!;
          let r = 0;
          for (let j = 0; j < b; j++) if (X[j]![i] !== 0) r = 1;
          D[i] = r;
        }
        return;
      default:
        // SUM: CPython >= 3.12 sum(), start 0 then Neumaier compensation, in member order (S06).
        for (let k = 0; k < m; k++) {
          const i = L[k]!;
          let f = 0 + X0[i]!;
          let c = 0;
          for (let j = 1; j < b; j++) {
            const x = X[j]![i]!;
            const s = f + x;
            if (Math.abs(f) >= Math.abs(x)) c += f - s + x;
            else c += x - s + f;
            f = s;
          }
          if (c !== 0 && Number.isFinite(c)) f += c;
          D[i] = f;
        }
    }
  }
}

function isListOp(op: number): boolean {
  return (
    op === MIN ||
    op === MAX ||
    op === AND ||
    op === OR ||
    op === SUM ||
    op === MAXOVER ||
    op === MINOVER
  );
}
