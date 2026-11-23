import type { Violation } from '@glidepath/api-contract';
import { validatePreview } from '@glidepath/domain';
import type { InputValueRow } from '@glidepath/domain';
import type { CellKey as EngineCell, Evaluation } from '@glidepath/engine';
import { toViolation } from '../routes/write/errors';
import type { CachedModel } from './model-cache';

/**
 * Preview warnings (API-07, CON-02 `warnings{seq}`): DOM `validatePreview` on a session's scratch state.
 * The input rules read the scratch's resolved inputs (the evaluation's `values`, engine keys split into
 * `var_key` + `member_key`), the output rules read the scratch evaluation itself, with the model's
 * `upstream` so VR08 skips checks a pin feeds. Pure: nothing is written, nothing is rejected.
 */

/** `var` → `['var', '']`, `var[m1,m2]` → `['var', 'm1,m2']` (member keys verbatim). */
function splitEngineCell(cell: EngineCell): readonly [string, string] {
  const i = cell.indexOf('[');
  return i < 0 ? [cell, ''] : [cell.slice(0, i), cell.slice(i + 1, -1)];
}

/** The evaluation's resolved inputs as rule rows. */
export function inputRows(at: Evaluation): InputValueRow[] {
  const rows: InputValueRow[] = [];
  for (const [cell, value] of at.values) {
    const [var_key, member_key] = splitEngineCell(cell);
    rows.push({ var_key, member_key, value } as InputValueRow);
  }
  return rows;
}

/** Every rule entry of the scratch state `at`, in rule order, as the contract's violations. */
export function previewViolations(model: CachedModel, at: Evaluation): Violation[] {
  return validatePreview({
    bundle: model.bundle,
    members: model.members,
    values: inputRows(at),
    evaluation: at,
    upstream: (cell) => model.model.upstream(cell),
  }).map(toViolation);
}

/** Same list (order included): a repeat is not pushed again. */
export const sameViolations = (a: readonly Violation[], b: readonly Violation[]): boolean =>
  a.length === b.length && JSON.stringify(a) === JSON.stringify(b);
