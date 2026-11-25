// Baseline "Where the money is": treemap grouping and header counts (ADR-021, docs/ux/03_screens.md).
import type { Member, MemberId, TenantMembers } from '@glidepath/spec';
import { LINE_ITEM_DIM } from '../changeset';
import { attrOf, inDisplayOrder, labelOf, membersOf, valueOf } from './read';
import type {
  BaselineGroupBy,
  BaselineGroupsView,
  BaselineSummaryView,
  ViewEvaluation,
} from './types';

/** Nodes, inputs and attributes the baseline views read, verbatim from the spec. */
export const BASELINE_CELLS = {
  total: 'base.total',
  lineOutlay: 'base.line_outlay',
  poolOutlay: 'base.pool_outlay',
  vpOutlay: 'vp.outlay',
  domShare: 'org.dom_share',
  inScope: 'in_scope',
} as const;

/** `org.dom_share` member key: dims `[domain, vp]` in variables.json order. */
export function domShareKey(domain: MemberId, vp: MemberId): string {
  return `${domain},${vp}`;
}

type Group = BaselineGroupsView['groups'][number];
type Line = Group['lines'][number];

/** Lines of the tenant in evaluation order, each with its `base.line_outlay`. */
function lineOutlays(
  ev: ViewEvaluation,
  members: TenantMembers,
): { line: Member; value: number }[] {
  return membersOf(members, LINE_ITEM_DIM).map((line) => ({
    line,
    value: valueOf(ev, BASELINE_CELLS.lineOutlay, line.id),
  }));
}

const sum = (lines: readonly Line[]): number => lines.reduce((s, l) => s + l.value, 0);

/**
 * Two-level grouping of the CY26 outlay (group → line), `total` = `base.total`.
 *
 * - `pool`: lines by their `pool` attribute; group value = `base.pool_outlay[pool]`.
 * - `domain`: lines by their `domain` attribute; group value = Σ of its lines.
 * - `vp`: each line split by its domain's ownership, line value
 *   `base.line_outlay[l] × org.dom_share[l.domain, vp]` (only lines with a non-zero share are listed);
 *   group value = `vp.outlay[vp]`, the VP module's own figure, which is the same sum
 *   (`vp.outlay = Σ_pool vp.pool_usd`, `vp.pool_usd = Σ_line line_outlay × dom_share`).
 *
 * Groups follow the grouping dimension's display order, lines the line order. Every line sits in
 * exactly one pool and one domain group, so those groups sum to `base.total`; VP groups do too when
 * every domain's shares sum to 1 (VR01). Lines of a domain no VP owns (the out-of-scope memo domain,
 * shares 0) appear in no VP group.
 */
export function baselineGroups(
  ev: ViewEvaluation,
  members: TenantMembers,
  by: BaselineGroupBy,
): BaselineGroupsView {
  const lines = lineOutlays(ev, members);
  const groupMembers = inDisplayOrder(membersOf(members, by));
  const groups: Group[] = groupMembers.map((g) => {
    if (by === 'vp') {
      const owned = lines.flatMap(({ line, value }): Line[] => {
        const domain = attrOf(line, 'domain');
        const share =
          domain === undefined
            ? 0
            : valueOf(ev, BASELINE_CELLS.domShare, domShareKey(domain, g.id));
        return share === 0 ? [] : [{ key: line.id, value: value * share }];
      });
      return {
        key: g.id,
        label: labelOf(g),
        value: valueOf(ev, BASELINE_CELLS.vpOutlay, g.id),
        lines: owned,
      };
    }
    const own = lines
      .filter(({ line }) => attrOf(line, by) === g.id)
      .map(({ line, value }) => ({ key: line.id, value }));
    const value = by === 'pool' ? valueOf(ev, BASELINE_CELLS.poolOutlay, g.id) : sum(own);
    return { key: g.id, label: labelOf(g), value, lines: own };
  });
  return { total: valueOf(ev, BASELINE_CELLS.total), groups };
}

/** Header strip counts: every line, and the lines whose `in_scope` attribute is set. */
export function baselineSummary(members: TenantMembers): BaselineSummaryView {
  const lines = membersOf(members, LINE_ITEM_DIM);
  const inScope = (m: Member): boolean => {
    const v = m[BASELINE_CELLS.inScope];
    return v === true || (typeof v === 'number' && v !== 0);
  };
  return { lines: lines.length, linesInScope: lines.filter(inScope).length };
}
