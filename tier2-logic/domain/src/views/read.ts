// Shared reads of the view-models: cell keys, members in display order, member labels.
import type { DimId, Member, TenantMembers } from '@glidepath/spec';
import { toCellKey } from '../validation/state';
import type { ViewEvaluation } from './types';

/** The engine CellKey: `id` for a scalar, `id[member_key]` otherwise (`Model.key` in engine.py). */
export function engineCell(id: string, memberKey = ''): string {
  return memberKey === '' ? id : `${id}[${memberKey}]`;
}

/** The contract CellKey of a cell (`id[]` for a scalar), for the trace drawer. */
export const contractCell = toCellKey;

/** The value of a cell; an input or node the evaluation does not hold reads as 0. */
export function valueOf(ev: ViewEvaluation, id: string, memberKey = ''): number {
  const cell = engineCell(id, memberKey);
  return ev.has(cell) ? ev.get(cell) : 0;
}

/** A dimension's members, `[]` when the tenant has none. */
export function membersOf(members: TenantMembers, dim: DimId): readonly Member[] {
  return members[dim] ?? [];
}

/**
 * A dimension's members in display order: by the numeric `order` attribute when every member has
 * one (pool, lever), else as given (the evaluation order). The sort is stable.
 */
export function inDisplayOrder(list: readonly Member[]): readonly Member[] {
  const orders = list.map((m) => m['order']);
  if (!orders.every((o): o is number => typeof o === 'number')) return list;
  return list
    .map((m, i) => ({ m, o: orders[i] as number, i }))
    .sort((a, b) => a.o - b.o || a.i - b.i)
    .map((x) => x.m);
}

/** A member's `label` attribute, else its id. */
export function labelOf(member: Member): string {
  const label = member['label'];
  return typeof label === 'string' && label !== '' ? label : member.id;
}

/** A string attribute of a member, `undefined` when absent or not a string. */
export function attrOf(member: Member, attr: string): string | undefined {
  const v = member[attr];
  return typeof v === 'string' ? v : undefined;
}
