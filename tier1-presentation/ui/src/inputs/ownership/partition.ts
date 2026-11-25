/**
 * Row mechanics for the ownership bar: where a divider may sit and how segments follow from the
 * dividers. Everything is done in whole grid steps (units of `step`, 20 of them for 5%), so the
 * segments partition the row by construction and floating point never leaks into the total.
 * This is display geometry (clamp, snap, partition), not model maths: tier 2 owns the rules.
 */

/** Grid units in a full row: 1 / step, at least 1 (a 5% step gives 20). */
export function gridUnits(step: number): number {
  return step > 0 && Number.isFinite(step) ? Math.max(1, Math.round(1 / step)) : 1;
}

/**
 * The n - 1 divider positions (grid units from the left) that draw the given shares. Each is the
 * running total snapped to the grid and kept between its neighbours, so any input yields a valid
 * partition; the last segment is whatever remains to the right edge.
 */
export function dividersFromShares(shares: readonly number[], total: number): number[] {
  const out: number[] = [];
  let run = 0;
  let prev = 0;
  for (let i = 0; i < shares.length - 1; i++) {
    const s = shares[i]!;
    run += Number.isFinite(s) ? s : 0;
    const at = Math.min(total, Math.max(prev, Math.round(run * total)));
    out.push(at);
    prev = at;
  }
  return out;
}

/** Segment widths in grid units: gaps between the edges and the dividers. Always sum to `total`. */
export function segmentUnits(dividers: readonly number[], total: number): number[] {
  const edges = [0, ...dividers, total];
  return edges.slice(1).map((e, i) => e - edges[i]!);
}

/** A segment's share in model units (0.15). Division of integers, so no float drift. */
export const unitsToShare = (units: number, total: number): number => units / total;

/** The range divider `i` may move within: between its neighbours (or the row edges). */
export function dividerRange(
  dividers: readonly number[],
  i: number,
  total: number,
): readonly [lo: number, hi: number] {
  return [i > 0 ? dividers[i - 1]! : 0, i < dividers.length - 1 ? dividers[i + 1]! : total];
}

/** Move divider `i` to `to` grid units, clamped between its neighbours. Others stay put. */
export function moveDivider(
  dividers: readonly number[],
  i: number,
  to: number,
  total: number,
): number[] {
  const [lo, hi] = dividerRange(dividers, i, total);
  const at = Math.min(hi, Math.max(lo, Math.round(to)));
  return dividers.map((d, j) => (j === i ? at : d));
}

/** Pointer x along the bar as grid units, snapped to the nearest step. */
export function unitsAtPointer(
  clientX: number,
  left: number,
  width: number,
  total: number,
): number {
  if (!(width > 0)) return 0;
  return Math.round(Math.min(1, Math.max(0, (clientX - left) / width)) * total);
}
