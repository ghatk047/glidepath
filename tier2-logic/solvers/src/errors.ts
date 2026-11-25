/** Error codes of the solvers. */
export type SolverErrorCode =
  /** Parameters the problem cannot run with (unknown problem, set or cell; empty range …). */
  | 'BAD_PARAMS'
  /** The model lacks something the solver needs (members of a dimension …). */
  | 'BAD_MODEL'
  /** A result moves a cell its problem may not move (an estimate, or an input other than the named one). */
  | 'ILLEGAL_MOVE'
  /** The problem is specified but its backlog item has not landed. */
  | 'NOT_IMPLEMENTED';

export class SolverError extends Error {
  override readonly name = 'SolverError';

  constructor(
    readonly code: SolverErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/** Thrown by a run's checkpoint once its `AbortSignal` has fired; `runSolver` turns it into `cancelled`. */
export class SolverCancelled extends Error {
  override readonly name = 'SolverCancelled';

  constructor() {
    super('solver run cancelled');
  }
}
