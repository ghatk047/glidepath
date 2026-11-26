// SRC-06..09: what the sourcing views share: the lines with the scenario's amounts, vendor matching,
// third-party pools and the year members.
import type { Member, TenantMembers } from '@glidepath/spec';
import { engineCell } from '../views/read';
import type { ViewEvaluation } from '../views/types';
import { flag, memberLabel, numOrUndef, str, strOrNull, strings } from './params';
import type { SourcingLine } from './types';

/** Spec ids the sourcing views read (formula_graph.json; 03b node catalogue). */
export const SOURCING_CELLS = {
  /** `line.amount[line]`: the line's input amount, $M. */
  lineAmount: 'line.amount',
  /** `base.line_outlay[line]`: the line's outlay, $M (amount x headcount scale); sums to base.pool_outlay. */
  lineOutlay: 'base.line_outlay',
  /** `lev.eff[lever,pool]`: a lever's run-rate saving on a pool, $M. */
  leverPoolSaving: 'lev.eff',
} as const;

/** The line_item columns the members view does not expose (vendor_text, vendor_key, qty, unit). */
export interface LineItemColumns {
  readonly vendor_text?: unknown;
  readonly vendor_key?: unknown;
  readonly qty?: unknown;
  readonly unit?: unknown;
}

const text = (v: unknown): string => (typeof v === 'string' ? v : '');

/**
 * The tenant's active lines with the scenario's `line.amount` and `base.line_outlay` (read from `ev`, the
 * evaluation of the scenario) and the line_item columns of `rows` (by line key). A line with no row
 * keeps qty 0 and no vendor name.
 */
export function sourcingLines(
  members: TenantMembers,
  rows: ReadonlyMap<string, LineItemColumns>,
  ev: ViewEvaluation,
): SourcingLine[] {
  const read = (id: string, line: string): number => {
    const cell = engineCell(id, line);
    return ev.has(cell) ? ev.get(cell) : 0;
  };
  return (members['line'] ?? []).map((m) => {
    const row = rows.get(m.id) ?? {};
    return {
      id: m.id,
      label: memberLabel(m),
      pool: str(m, 'pool'),
      vendor: text(row.vendor_text).trim(),
      vendorKey: typeof row.vendor_key === 'string' && row.vendor_key !== '' ? row.vendor_key : strOrNull(m, 'vendor'),
      qty: numOrUndef(typeof row.qty === 'number' || typeof row.qty === 'string' ? row.qty : undefined) ?? 0,
      unit: text(row.unit),
      addr: str(m, 'addr'),
      inScope: flag(m['in_scope']),
      memo: flag(m['memo']),
      leverIds: strings(m['lever_ids']),
      amount: read(SOURCING_CELLS.lineAmount, m.id),
      outlay: read(SOURCING_CELLS.lineOutlay, m.id),
    };
  });
}

/** Lines that count as spend: in scope and not memo. */
export const counted = (l: SourcingLine): boolean => l.inScope && !l.memo;

/** Pool keys whose `third_party` flag is set. */
export function thirdPartyPools(members: TenantMembers): Set<string> {
  return new Set((members['pool'] ?? []).filter((p) => flag(p['third_party'])).map((p) => p.id));
}

const norm = (s: string): string => s.trim().toLowerCase();

/**
 * Vendor name -> `vendor` member, in this order: the line's own `vendor_key`; a `contract` member naming
 * the vendor (`vendor_name`) with a `vendor` key; a `vendor` member whose label or key equals the name
 * (case and outer spaces ignored). The contract mapping keeps a relabelled vendor member matched.
 */
export class VendorDirectory {
  private readonly byKey = new Map<string, Member>();
  private readonly byName = new Map<string, string>();

  constructor(vendors: readonly Member[], contracts: readonly Member[] = []) {
    for (const v of vendors) this.byKey.set(v.id, v);
    for (const v of vendors) {
      this.byName.set(norm(v.id), v.id);
      this.byName.set(norm(memberLabel(v)), v.id);
    }
    for (const c of contracts) {
      const key = strOrNull(c, 'vendor');
      const name = str(c, 'vendor_name');
      if (key && this.byKey.has(key) && name !== '') this.byName.set(norm(name), key);
    }
  }

  /** The `vendor` member key of a name (or of an explicit key), null for a tail vendor. */
  keyOf(name: string, explicitKey: string | null = null): string | null {
    if (explicitKey && this.byKey.has(explicitKey)) return explicitKey;
    return this.byName.get(norm(name)) ?? null;
  }

  preferred(key: string | null): boolean {
    return key !== null && flag(this.byKey.get(key)?.['preferred']);
  }
}

export interface SourcingYears {
  /** `year` member of the baseline the spend is taken from (the plan year's `prev`). */
  readonly baseYear: string;
  /** `iyear` member of the plan year (the last one). */
  readonly planYear: string;
}

/**
 * The plan year is the last `iyear` member; the baseline year is the `prev` of the `year` members that
 * fall in it (`year.in == planYear`). Structural, from the model's members: no year is written here.
 */
export function sourcingYears(members: TenantMembers): SourcingYears {
  const iyears = members['iyear'] ?? [];
  const planYear = iyears[iyears.length - 1]?.id ?? '';
  const inPlan = (members['year'] ?? []).find((y) => str(y, 'in') === planYear && str(y, 'prev') !== '');
  return { planYear, baseYear: inPlan ? str(inPlan, 'prev') : planYear };
}
