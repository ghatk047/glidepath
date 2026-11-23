import type { CellKey } from './types';

/**
 * Error codes of the engine. Each maps to the exception the Python reference raises in the same
 * situation (PORTING.md §5), so the fuzz harness can require "raises in TS ⇔ raises in Python".
 */
export type EngineErrorCode =
  /** A stub not built yet (ENG-01 skeleton). */
  | 'NOT_IMPLEMENTED'
  /** Tokenizer or parser (Python `SyntaxError`). */
  | 'SYNTAX'
  /** Compile time (Python raises these while `Model()` loads, or later; TS raises them in `compile`). */
  | 'UNKNOWN_SYMBOL'
  | 'UNKNOWN_DIMENSION'
  | 'BAD_INDEX'
  | 'IMPLICIT_INDEX'
  | 'NO_CASE'
  | 'WHERE_NOT_STATIC'
  | 'UNKNOWN_FUNCTION'
  | 'ARITY'
  | 'TYPE'
  | 'CYCLE'
  /** Input resolution (`Model.input_cells`): unknown variable or scenario, scalar for a dimensioned variable. */
  | 'BAD_INPUT'
  /** Evaluation (Python `ZeroDivisionError`, `KeyError`, `OverflowError`, complex result of `**`). */
  | 'DIV_ZERO'
  | 'MISSING'
  | 'OVERFLOW'
  | 'COMPLEX'
  | 'UNKNOWN_CELL';

/** Every error the engine throws. `cell` names the cell being compiled or computed, when there is one. */
export class EngineError extends Error {
  override readonly name = 'EngineError';
  readonly code: EngineErrorCode;
  readonly cell: CellKey | undefined;

  constructor(code: EngineErrorCode, message: string, cell?: CellKey) {
    super(message);
    this.code = code;
    this.cell = cell;
  }
}

/** The error a stub throws: message `not implemented: <what> (<item>)`. */
export function notImplemented(what: string, item: string): EngineError {
  return new EngineError('NOT_IMPLEMENTED', `not implemented: ${what} (${item})`);
}
