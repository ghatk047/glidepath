// View-model payloads (ADR-021). Domain may not import contract/api-contract (02 §1: domain → spec,
// engine), so these mirror the contract's view payloads in ws.ts field for field: `BridgeView`,
// `BaselineGroupsView`, `BaselineSummaryView`, `LeversFamiliesView`, `LeversMonthlyView`,
// `LeversScaleView`, `VpsDomainOutlayView`. Keys are plain strings here; the server parses each payload
// with the contract's `viewSchemas[name].payload`, which brands them (MemberKey, CellKey).
import type { DimId, MemberId } from '@glidepath/spec';

/** The contract's view names (ws.ts `viewNames`), in its order. */
export const VIEW_NAMES = [
  'bridge',
  'baseline.groups',
  'baseline.summary',
  'levers.families',
  'levers.monthly',
  'levers.scale',
  'vps.domain_outlay',
] as const;
export type ViewName = (typeof VIEW_NAMES)[number];

/**
 * What a view reads: an engine `Evaluation` (03 §1) satisfies it. Keys are engine CellKeys: `id` for a
 * scalar, `id[m1,m2]` for a dimensioned cell. Inputs and node cells both resolve.
 */
export interface ViewEvaluation {
  get(cell: string): number;
  has(cell: string): boolean;
}

/** One waterfall bar of the Cockpit bridge. */
export interface BridgeStep<K extends string = string> {
  readonly key: K;
  /** The node the step comes from, as a contract CellKey (`base.total[]`), for the trace drawer. */
  readonly cell: string | null;
  /** Level for `base` / `outlay`; signed change to outlay for the steps between. */
  readonly value: number;
  /** Bar extent, so tier 1 draws the waterfall without summing. */
  readonly from: number;
  readonly to: number;
}

/** Cockpit "CY26 → CY27 outlay" (contract `BridgeView`). */
export interface BridgeView {
  readonly steps: readonly [
    BridgeStep<'base'>,
    BridgeStep<'growth'>,
    BridgeStep<'savings'>,
    BridgeStep<'oneTime'>,
    BridgeStep<'outlay'>,
  ];
  /** Dashed target line: `base.total − res.target`. */
  readonly targetOutlay: number;
  /** Red bracket: CY27 outlay minus target outlay. */
  readonly gap: number;
}

/** Baseline grouping: a dimension id of `formula_graph.json` (contract `BaselineGroupBy`). */
export const BASELINE_GROUP_BY = ['pool', 'domain', 'vp'] as const satisfies readonly DimId[];
export type BaselineGroupBy = (typeof BASELINE_GROUP_BY)[number];

/** Baseline treemap, group → line (contract `BaselineGroupsView`). */
export interface BaselineGroupsView {
  readonly total: number;
  readonly groups: readonly {
    readonly key: MemberId;
    readonly label: string;
    readonly value: number;
    readonly lines: readonly { readonly key: MemberId; readonly value: number }[];
  }[];
}

/** Baseline header strip counts (contract `BaselineSummaryView`). */
export interface BaselineSummaryView {
  readonly lines: number;
  readonly linesInScope: number;
}

/** Lever list families: Σ `lev.iy` by lever `category` (contract `LeversFamiliesView`). */
export interface LeversFamiliesView {
  readonly total: number;
  readonly families: readonly {
    readonly key: string;
    readonly label: string;
    readonly value: number;
    readonly levers: readonly MemberId[];
  }[];
}

/** "2027 by month" (contract `LeversMonthlyView`): every series has `MONTHS_IN_YEAR` values. */
export interface LeversMonthlyView {
  readonly families: readonly { readonly key: string; readonly values: readonly number[] }[];
  readonly levers: readonly {
    readonly key: MemberId;
    readonly family: string;
    readonly values: readonly number[];
  }[];
}

/** Common scale for the lever in-year bars (contract `LeversScaleView`). */
export interface LeversScaleView {
  readonly max: number;
}

/** Outlay per domain for the ownership editor (contract `VpsDomainOutlayView`). */
export interface VpsDomainOutlayView {
  readonly domains: readonly { readonly key: MemberId; readonly value: number }[];
}

/** Payload of each view by name. */
export interface ViewPayloads {
  bridge: BridgeView;
  'baseline.groups': BaselineGroupsView;
  'baseline.summary': BaselineSummaryView;
  'levers.families': LeversFamiliesView;
  'levers.monthly': LeversMonthlyView;
  'levers.scale': LeversScaleView;
  'vps.domain_outlay': VpsDomainOutlayView;
}

/** Params of each view by name (contract `viewSchemas[name].params`; `{}` when none). */
export interface ViewParamsOf {
  bridge: Record<string, never>;
  'baseline.groups': { readonly by: BaselineGroupBy };
  'baseline.summary': Record<string, never>;
  'levers.families': Record<string, never>;
  'levers.monthly': Record<string, never>;
  'levers.scale': Record<string, never>;
  'vps.domain_outlay': Record<string, never>;
}
