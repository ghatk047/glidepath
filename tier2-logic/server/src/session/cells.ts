import type { CellKey as WireCell, CellValues } from '@glidepath/api-contract';
import type { CellKey as EngineCell, Evaluation } from '@glidepath/engine';

/**
 * Cell keys on the wire and in the engine (03 §1, CON-01):
 *
 * - wire (`@glidepath/api-contract` `CellKey`): always `id[member]`; a scalar has the empty member, `res.net[]`;
 * - engine (`Model.key`): `id` for a scalar, `id[m1,m2]` for a dimensioned cell.
 *
 * Member keys are carried verbatim (`'pilots,fy27'`); the only difference is the scalar's `[]`.
 */

const WIRE_CELL = /^([^[\]\s]+)\[([^[\]]*)\]$/;

/** `id[member]` → `{ id, member }`, or null when the text is not a wire cell key. */
export function splitWireCell(cell: string): { id: string; member: string } | null {
  const m = WIRE_CELL.exec(cell);
  return m ? { id: m[1]!, member: m[2]! } : null;
}

/** Engine key of `id` with `member` (`''` = scalar). */
export const engineCell = (id: string, member: string): EngineCell => (member === '' ? id : `${id}[${member}]`);

/** Engine key of a wire cell key (`res.net[]` → `res.net`, `vp.net[vp_x]` unchanged). */
export function toEngineCell(cell: WireCell | string): EngineCell {
  const parts = splitWireCell(cell);
  if (!parts) throw new TypeError(`not a cell key: ${cell}`);
  return engineCell(parts.id, parts.member);
}

/** Wire key of an engine cell key (`res.net` → `res.net[]`). */
export const toWireCell = (cell: EngineCell): WireCell =>
  (cell.endsWith(']') ? cell : `${cell}[]`) as WireCell;

/** A value as pushed: a finite number, or `null` (the contract carries no NaN or infinity). */
export type WireValue = number | null;

/** The value of `cell` in `at`, or null when the evaluation has no such cell or it is not finite. */
export function wireValue(at: Evaluation, cell: EngineCell): WireValue {
  if (!at.has(cell)) return null;
  const v = at.get(cell);
  return Number.isFinite(v) ? v : null;
}

/**
 * The cells whose pushed value differs from what the client was last sent (`sent`), with their new
 * values; `sent` is updated to match. `-0` and `0` are the same on the wire (JSON has no `-0`).
 */
export function diffCells(
  at: Evaluation,
  subscribed: ReadonlyMap<WireCell, EngineCell>,
  sent: Map<WireCell, WireValue>,
): CellValues {
  const out: Record<string, WireValue> = {};
  for (const [wire, engine] of subscribed) {
    const v = wireValue(at, engine);
    if (sent.has(wire) && sent.get(wire) === v) continue;
    sent.set(wire, v);
    out[wire] = v;
  }
  return out as CellValues;
}
