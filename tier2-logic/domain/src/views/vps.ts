// VPs "Who owns what": outlay per domain for the ownership editor (ADR-021, docs/ux/03_screens.md).
import type { DimId, TenantMembers } from '@glidepath/spec';
import { LINE_ITEM_DIM } from '../changeset';
import { OUT_OF_SCOPE_MEMO_DOMAIN } from '../validation/input-rules';
import { BASELINE_CELLS } from './baseline';
import { attrOf, inDisplayOrder, membersOf, valueOf } from './read';
import type { ViewEvaluation, VpsDomainOutlayView } from './types';

const DOMAIN_DIM: DimId = 'domain';

/**
 * Σ `base.line_outlay` over the lines of each domain, in domain order. The out-of-scope memo domain
 * is left out: no VP may own it (VR01 holds its shares at 0), so it has no row in the editor.
 * `Σ_domain value × org.dom_share[domain, vp]` is `vp.outlay[vp]`.
 */
export function vpsDomainOutlay(ev: ViewEvaluation, members: TenantMembers): VpsDomainOutlayView {
  const byDomain = new Map<string, number>();
  for (const line of membersOf(members, LINE_ITEM_DIM)) {
    const domain = attrOf(line, DOMAIN_DIM);
    if (domain === undefined) continue;
    byDomain.set(
      domain,
      (byDomain.get(domain) ?? 0) + valueOf(ev, BASELINE_CELLS.lineOutlay, line.id),
    );
  }
  return {
    domains: inDisplayOrder(membersOf(members, DOMAIN_DIM))
      .filter((d) => d.id !== OUT_OF_SCOPE_MEMO_DOMAIN)
      .map((d) => ({ key: d.id, value: byDomain.get(d.id) ?? 0 })),
  };
}
