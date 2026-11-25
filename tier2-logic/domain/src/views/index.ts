// Display view-models for derived series (ADR-021, DOM-06). Pure functions of an engine evaluation and
// the tenant's members; the session (API-12) pushes their results as the contract's `view` messages.
import type { TenantMembers } from '@glidepath/spec';
import { baselineGroups, baselineSummary } from './baseline';
import { bridge } from './bridge';
import { leversFamilies, leversMonthly, leversScale } from './levers';
import type { ViewEvaluation, ViewName, ViewParamsOf, ViewPayloads } from './types';
import { vpsDomainOutlay } from './vps';

export { BASELINE_CELLS, baselineGroups, baselineSummary, domShareKey } from './baseline';
export { BRIDGE_NODES, bridge } from './bridge';
export {
  LEVER_CELLS,
  LEVER_DIM,
  LEVER_FAMILY_ATTRIBUTE,
  MONTHS_IN_YEAR,
  leversFamilies,
  leversMonthly,
  leversScale,
  rampWeights,
} from './levers';
export { engineCell } from './read';
export { BASELINE_GROUP_BY, VIEW_NAMES } from './types';
export type {
  BaselineGroupBy,
  BaselineGroupsView,
  BaselineSummaryView,
  BridgeStep,
  BridgeView,
  LeversFamiliesView,
  LeversMonthlyView,
  LeversScaleView,
  ViewEvaluation,
  ViewName,
  ViewParamsOf,
  ViewPayloads,
  VpsDomainOutlayView,
} from './types';
export { vpsDomainOutlay } from './vps';

/** A view's function: `(evaluation, members, params)` → payload. */
export type ViewFn<V extends ViewName> = (
  ev: ViewEvaluation,
  members: TenantMembers,
  params: ViewParamsOf[V],
) => ViewPayloads[V];

/**
 * Every view by its contract name. `levers.scale` reads the evaluation of the scale preset (D), not
 * the session's scenario; the others read the session's evaluation.
 */
export const VIEWS: { readonly [V in ViewName]: ViewFn<V> } = {
  bridge: (ev) => bridge(ev),
  'baseline.groups': (ev, members, { by }) => baselineGroups(ev, members, by),
  'baseline.summary': (_ev, members) => baselineSummary(members),
  'levers.families': leversFamilies,
  'levers.monthly': leversMonthly,
  'levers.scale': leversScale,
  'vps.domain_outlay': vpsDomainOutlay,
};
