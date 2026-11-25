import { viewSchemas } from '@glidepath/api-contract';
import type { ViewName } from '@glidepath/api-contract';
import { VIEWS } from '@glidepath/domain';
import type { ViewEvaluation } from '@glidepath/domain';
import type { TenantMembers } from '@glidepath/spec';

/**
 * Session view subscriptions (ADR-021, API-12). A view is a derived display series (DOM-06 `VIEWS`) of the
 * evaluation the client sees; the session pushes it as `view{view, params, seq, payload}` after the
 * snapshot and after every rerun or commit that changes it.
 */

/** The preset the Levers screen scales its bars to ("Full stretch"): `levers.scale` reads its evaluation. */
export const SCALE_PRESET_KEY = 'D';

/** One subscribed view: what the client asked for and the payload last pushed (as JSON text). */
export interface ViewSub {
  readonly view: ViewName;
  readonly params: Record<string, unknown>;
  sent: string | null;
}

/** Same view and params, whatever the key order of `params`. */
export function viewKey(view: string, params: Record<string, unknown>): string {
  const sorted = Object.fromEntries(Object.entries(params).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  return `${view}:${JSON.stringify(sorted)}`;
}

/**
 * The payload of `sub` on `at` (`scale` is the scale preset's evaluation, read by `levers.scale` only),
 * checked against the contract's payload schema, as canonical JSON text.
 */
export function computeView(
  sub: Pick<ViewSub, 'view' | 'params'>,
  at: ViewEvaluation,
  members: TenantMembers,
  scale: ViewEvaluation | null,
): string {
  const fn = VIEWS[sub.view] as (ev: ViewEvaluation, m: TenantMembers, p: unknown) => unknown;
  const raw = fn(sub.view === 'levers.scale' ? (scale ?? at) : at, members, sub.params);
  return JSON.stringify(viewSchemas[sub.view].payload.parse(raw));
}
