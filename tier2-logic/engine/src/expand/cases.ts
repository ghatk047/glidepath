/**
 * `Model.pick_expr` (engine.py L144-150): the first case whose `when` matches the cell's members, then
 * the node's `expr`, else NO_CASE. PORTING.md S08.
 */
import type { DimId, MemberId, NodeDef } from '@glidepath/spec';
import { EngineError } from '../errors';

export interface PickedExpr {
  readonly expr: string;
  /** Index into `node.cases`, or -1 for `node.expr`. */
  readonly caseIndex: number;
}

/**
 * `when: null` (or `{}`) matches every cell; otherwise every listed dim's bound member must be in its
 * list. `bind` maps each of the node's dims to the cell's member.
 */
export function pickExpr(node: NodeDef, bind: ReadonlyMap<DimId, MemberId>): PickedExpr {
  const cases = node.cases ?? [];
  for (let i = 0; i < cases.length; i++) {
    const when = cases[i]!.when;
    if (when === null || when === undefined) return { expr: cases[i]!.expr, caseIndex: i };
    let ok = true;
    for (const [d, ms] of Object.entries(when)) {
      const m = bind.get(d);
      if (m === undefined) {
        throw new EngineError(
          'UNKNOWN_DIMENSION',
          `case ${i} of ${node.id} names dim '${d}', which the node does not have`,
        );
      }
      if (!ms.includes(m)) {
        ok = false;
        break;
      }
    }
    if (ok) return { expr: cases[i]!.expr, caseIndex: i };
  }
  if (node.expr !== undefined) return { expr: node.expr, caseIndex: -1 };
  const at = [...bind].map(([d, m]) => `${d}=${m}`).join(', ');
  throw new EngineError('NO_CASE', `no expression for ${node.id} at {${at}}`);
}
