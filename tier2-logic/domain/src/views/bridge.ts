// Cockpit "CY26 → CY27 outlay" bridge (ADR-021, docs/ux/03_screens.md Cockpit).
import { contractCell, valueOf } from './read';
import type { BridgeView, ViewEvaluation } from './types';

/** The nodes the bridge reads, verbatim from formula_graph.json. */
export const BRIDGE_NODES = {
  base: 'base.total',
  growth: 'base.headwinds',
  savings: 'res.tot_iy',
  oneTime: 'res.tot_ot_it',
  outlay: 'res.cy27_outlay',
  target: 'res.target',
} as const;

/**
 * base.total → + base.headwinds → − res.tot_iy → + res.tot_ot_it → res.cy27_outlay, with each bar's
 * extent (`from`, `to`) chained from the previous one, and the target outlay `base.total − res.target`.
 * `gap` is CY27 outlay minus target outlay (positive: above the target line).
 */
export function bridge(ev: ViewEvaluation): BridgeView {
  const n = BRIDGE_NODES;
  const base = valueOf(ev, n.base);
  const growth = valueOf(ev, n.growth);
  const savings = -valueOf(ev, n.savings);
  const oneTime = valueOf(ev, n.oneTime);
  const outlay = valueOf(ev, n.outlay);
  const afterGrowth = base + growth;
  const afterSavings = afterGrowth + savings;
  const targetOutlay = base - valueOf(ev, n.target);
  return {
    steps: [
      { key: 'base', cell: contractCell(n.base), value: base, from: 0, to: base },
      { key: 'growth', cell: contractCell(n.growth), value: growth, from: base, to: afterGrowth },
      {
        key: 'savings',
        cell: contractCell(n.savings),
        value: savings,
        from: afterGrowth,
        to: afterSavings,
      },
      {
        key: 'oneTime',
        cell: contractCell(n.oneTime),
        value: oneTime,
        from: afterSavings,
        to: afterSavings + oneTime,
      },
      { key: 'outlay', cell: contractCell(n.outlay), value: outlay, from: 0, to: outlay },
    ],
    targetOutlay,
    gap: outlay - targetOutlay,
  };
}
