// SRC-06 · F5 vendor spend cube: third-party spend by vendor, shares, concentration, preferred vs tail.
import type { Member, TenantMembers } from '@glidepath/spec';
import { VendorDirectory, counted, sourcingYears, thirdPartyPools } from './lines';
import { str } from './params';
import type { SourcingLine, VendorSpendRow, VendorSpendView } from './types';

/** `addr_tag` members whose spend counts as addressable (spec ids: addressable, partly addressable). */
export const ADDRESSABLE_TAGS: ReadonlySet<string> = new Set(['addressable', 'partly']);
/** Vendors in the top-N share. */
export const TOP_VENDORS = 5;
/** HHI is on the 0..10 000 scale: shares in percent, squared. */
const PERCENT = 100;
/** Name shown for a line that names no vendor. */
export const NO_VENDOR = 'Unnamed vendor';

/** Clamp a share against float drift into [0, 1]. */
export const fraction = (x: number): number => Math.min(1, Math.max(0, x));
const ratio = (a: number, b: number): number => (b > 0 ? fraction(a / b) : 0);

interface Acc {
  vendor: string;
  vendorKey: string | null;
  spend: number;
  addressable: number;
  lineCount: number;
  pools: Set<string>;
  levers: Set<string>;
}

/** Vendor names of the `vendor_bucket` members (aggregates such as 'Various'), compared like vendor names. */
export function bucketNames(buckets: readonly Member[]): Set<string> {
  return new Set(buckets.map((b) => str(b, 'vendor_name').trim().toLowerCase()).filter((n) => n !== ''));
}

/**
 * The spend cube of a scenario: every in-scope, non-memo line of a third-party pool (`pool.third_party`),
 * grouped by the vendor name it carries; spend is the line's `outlay` ($M), so the total reconciles to
 * the third-party baseline (sum of `base.pool_outlay` over third-party pools). A vendor is preferred when
 * it maps to a `vendor` member with `preferred` set (see `VendorDirectory`). Vendors are sorted by spend,
 * descending (then by name); shares and HHI are over the third-party total.
 *
 * Aggregate buckets (`vendor_bucket` members: names such as 'Various' that stand for many counterparties)
 * keep their rows, after every named vendor, so the spend still reconciles; they are left out of the HHI,
 * the top-5 share and the vendor count (`totals.vendorCount` = the named vendors, so the rows from index
 * `vendorCount` on are the buckets). Shares stay over the whole third-party total.
 */
export function vendorSpend(args: {
  scenarioId: string;
  lines: readonly SourcingLine[];
  members: TenantMembers;
  /** `contract` members (their vendor_name -> vendor key mapping); optional. */
  contracts?: TenantMembers[string];
  /** `vendor_bucket` members (aggregate vendor names); optional. */
  buckets?: TenantMembers[string];
}): VendorSpendView {
  const { members } = args;
  const pools = thirdPartyPools(members);
  const directory = new VendorDirectory(members['vendor'] ?? [], args.contracts ?? []);

  const byVendor = new Map<string, Acc>();
  for (const l of args.lines) {
    if (!counted(l) || !pools.has(l.pool)) continue;
    const vendor = l.vendor === '' ? NO_VENDOR : l.vendor;
    let acc = byVendor.get(vendor);
    if (!acc) {
      acc = { vendor, vendorKey: null, spend: 0, addressable: 0, lineCount: 0, pools: new Set(), levers: new Set() };
      byVendor.set(vendor, acc);
    }
    acc.vendorKey ??= directory.keyOf(vendor, l.vendorKey);
    acc.spend += l.outlay;
    if (ADDRESSABLE_TAGS.has(l.addr)) acc.addressable += l.outlay;
    acc.lineCount += 1;
    acc.pools.add(l.pool);
    for (const lever of l.leverIds) acc.levers.add(lever);
  }

  const aggregate = bucketNames(args.buckets ?? []);
  const isBucket = (a: Acc): boolean => aggregate.has(a.vendor.trim().toLowerCase());
  const accs = [...byVendor.values()].sort(
    (a, b) => Number(isBucket(a)) - Number(isBucket(b)) || b.spend - a.spend || (a.vendor < b.vendor ? -1 : a.vendor > b.vendor ? 1 : 0),
  );
  const named = accs.filter((a) => !isBucket(a)).length;
  const total = accs.reduce((s, a) => s + a.spend, 0);
  const poolOrder = (members['pool'] ?? []).map((p) => p.id);
  const byPoolOrder = (a: string, b: string) => poolOrder.indexOf(a) - poolOrder.indexOf(b);

  let running = 0;
  const vendors: VendorSpendRow[] = accs.map((a) => {
    running += a.spend;
    return {
      vendor: a.vendor,
      vendorKey: a.vendorKey,
      preferred: directory.preferred(a.vendorKey),
      aggregate: isBucket(a),
      spend: a.spend,
      share: ratio(a.spend, total),
      cumulativeShare: ratio(running, total),
      lineCount: a.lineCount,
      pools: [...a.pools].sort(byPoolOrder),
      levers: [...a.levers].sort(),
      addressableShare: ratio(a.addressable, a.spend),
    };
  });

  const namedRows = vendors.slice(0, named);
  const hhi = Math.min(PERCENT * PERCENT, namedRows.reduce((s, v) => s + (v.share * PERCENT) ** 2, 0));
  const top = namedRows.slice(0, TOP_VENDORS).reduce((s, v) => s + v.spend, 0);
  const preferred = vendors.filter((v) => v.preferred).reduce((s, v) => s + v.spend, 0);
  return {
    scenarioId: args.scenarioId,
    year: sourcingYears(members).baseYear,
    vendors,
    totals: {
      thirdPartySpend: total,
      hhi,
      top5Share: ratio(top, total),
      preferredShare: ratio(preferred, total),
      vendorCount: named,
    },
  };
}
