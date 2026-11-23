import { notImplemented } from './errors';
import type { CompiledModel } from './types';

/** Which backlog item builds each `CompiledModel` method (PORTING.md §1). */
export const METHOD_OWNERS = {
  evaluate: 'ENG-05',
  rerun: 'ENG-07',
  evaluateBatch: 'ENG-08',
  upstream: 'ENG-09',
  downstream: 'ENG-09',
  explain: 'ENG-09',
  inputHash: 'ENG-05',
} as const satisfies Record<keyof CompiledModel, string>;

/**
 * A `CompiledModel` whose every method throws `not implemented`. Skeleton only (ENG-01): it proves the
 * interface is implementable; ENG-04 replaces it with the compiled program.
 */
export function pendingModel(): CompiledModel {
  const stub = (method: keyof CompiledModel) => (): never => {
    throw notImplemented(`CompiledModel.${method}`, METHOD_OWNERS[method]);
  };
  return {
    evaluate: stub('evaluate'),
    rerun: stub('rerun'),
    evaluateBatch: stub('evaluateBatch'),
    upstream: stub('upstream'),
    downstream: stub('downstream'),
    explain: stub('explain'),
    inputHash: stub('inputHash'),
  };
}
