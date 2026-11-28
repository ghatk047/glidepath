import { NO_VENDOR, counted, thirdPartyPools } from '@glidepath/domain';
import type { SourcingLine, VendorSpendView } from '@glidepath/domain';
import type { Member, TenantMembers } from '@glidepath/spec';
import type { ConsolidationVendor } from '@glidepath/solvers';

/**
 * SRC-07/SRC-10: the spend cube rows with their spend split by pool, the optimizer's input. The split is taken
 * from the same lines and filters as `vendorSpend` (in-scope, non-memo lines of third-party pools, grouped by the
 * vendor name they carry, spend = the line's outlay), so it sums back to each row's `spend`.
 */
export function consolidationVendors(cube: VendorSpendView, lines: readonly SourcingLine[], members: TenantMembers): ConsolidationVendor[] {
  const pools = thirdPartyPools(members);
  const byVendor = new Map<string, Record<string, number>>();
  for (const l of lines) {
    if (!counted(l) || !pools.has(l.pool)) continue;
    const vendor = l.vendor === '' ? NO_VENDOR : l.vendor;
    const split = byVendor.get(vendor) ?? {};
    split[l.pool] = (split[l.pool] ?? 0) + l.outlay;
    byVendor.set(vendor, split);
  }
  return cube.vendors.map((row) => ({
    vendor: row.vendor,
    vendorKey: row.vendorKey,
    preferred: row.preferred,
    aggregate: row.aggregate,
    spendByPool: byVendor.get(row.vendor) ?? {},
  }));
}

/** The pools of the `consolidation_scope` members (attr `pool`): where the optimizer may move spend. */
export function consolidationScope(scope: readonly Member[]): string[] {
  return [...new Set(scope.map((m) => m['pool']).filter((p): p is string => typeof p === 'string' && p !== ''))];
}
