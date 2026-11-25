/**
 * Structural rows seen as dimension members, the projection `v_dimension_members` applies
 * (tier3-data/migrations/0003_views.sql). `applyChangeset` uses it to run the input rules on a
 * changeset's structural changes before anything is written, and in-memory stores use it for
 * `ChangesetTx.loadMembers`.
 */
import type { AttrValue, DimId, Member, MemberId } from '@glidepath/spec';
import { LINE_ITEM_DIM, type JsonObject, type JsonValue } from './changeset';

/**
 * line_item column -> the `line` member attribute it becomes (the names expressions read, e.g.
 * `line.pool`; formula_graph.json dimension `line`). member-rows.test.ts checks it against the view.
 */
export const LINE_ITEM_ATTRIBUTES = {
  pool_id: 'pool',
  domain_key: 'domain',
  addr_tag: 'addr',
  scale_driver: 'drv',
  l2: 'l2',
  name: 'name',
  vendor_key: 'vendor',
  nature: 'nature',
  accounting: 'accounting',
  in_scope: 'in_scope',
  memo: 'memo',
  confidence: 'confidence',
  legacy_id: 'legacy_id',
} as const satisfies Readonly<Record<string, string>>;

/**
 * `line` attributes the view reads from other tables (line_item_lever, source). A line_item row does
 * not carry them, so a changed line keeps the ones its member had.
 */
export const LINE_ITEM_JOINED_ATTRIBUTES = ['lever_ids', 'source'] as const;

/** bool columns the view turns into 0/1, as in the seed (expressions compare `in_scope == 1`). */
const FLAG_COLUMNS: ReadonlySet<string> = new Set(['in_scope', 'memo']);

const isObject = (v: JsonValue | undefined): v is JsonObject =>
  v !== null && v !== undefined && typeof v === 'object' && !Array.isArray(v);

/**
 * The member a structural row stands for, or null when the row is inactive (`active` false: a soft
 * delete; `loadMembers` returns active members only).
 *
 * - A dimension_member row `{ label, attrs, sort, active }` is `{ id, label, ...attrs }`.
 * - A line_item row (dim `line`) is `{ id, label: name, ... }` with its columns renamed by
 *   `LINE_ITEM_ATTRIBUTES`; columns the row does not carry are left out, and `previous` (the member
 *   before the change) supplies `LINE_ITEM_JOINED_ATTRIBUTES`.
 */
export function memberOfRow(
  dim: DimId,
  memberKey: MemberId,
  row: JsonObject,
  previous?: Member,
): Member | null {
  if (row.active === false) return null;
  if (dim !== LINE_ITEM_DIM) {
    const attrs = isObject(row.attrs) ? (row.attrs as Readonly<Record<string, AttrValue>>) : {};
    return {
      ...attrs,
      id: memberKey,
      ...(typeof row.label === 'string' ? { label: row.label } : {}),
    };
  }
  const member: Record<string, AttrValue> = { id: memberKey };
  for (const attr of LINE_ITEM_JOINED_ATTRIBUTES) {
    const kept = previous?.[attr];
    if (kept !== undefined) member[attr] = kept;
  }
  for (const [column, attr] of Object.entries(LINE_ITEM_ATTRIBUTES)) {
    const v = row[column];
    if (v === undefined) continue;
    member[attr] =
      FLAG_COLUMNS.has(column) && typeof v === 'boolean' ? Number(v) : (v as AttrValue);
  }
  if (typeof row.name === 'string') member.label = row.name;
  return member as Member;
}
