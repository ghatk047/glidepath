// SRC-08 · F6 renewal calendar: renewals, notice deadlines, status, escalator exposure, plan-year capture.
import type { Member } from '@glidepath/spec';
import { MONTHS_IN_YEAR } from '../views/levers';
import { VendorDirectory } from './lines';
import { SOURCING_PARAM_KEYS as K, SourcingDataError, flag, memberLabel, requiredNum, str, strOrNull, strings } from './params';
import type { SourcingParamsLookup } from './params';
import { fraction } from './vendor-spend';
import { RENEWAL_STATUSES } from './types';
import type { RenewalCalendarView, RenewalMonthRow, RenewalRow, RenewalStatus, SourcingLine } from './types';

const DAY_MS = 86_400_000;

/** A calendar month as a month index (year x 12 + month - 1), so months add and compare as integers. */
export const monthIndex = (year: number, month: number): number => year * MONTHS_IN_YEAR + (month - 1);
const pad = (n: number, w = 2): string => String(n).padStart(w, '0');
/** `YYYY-MM` of a month index. */
export const isoMonth = (idx: number): string => `${pad(Math.floor(idx / MONTHS_IN_YEAR), 4)}-${pad((idx % MONTHS_IN_YEAR) + 1)}`;
/** Midnight UTC on the first day of a month index. */
const firstDayMs = (idx: number): number => Date.UTC(Math.floor(idx / MONTHS_IN_YEAR), idx % MONTHS_IN_YEAR, 1);
const isoDate = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** Month index of a `YYYY-MM` attribute; throws `SourcingDataError` when malformed. */
export function parseMonth(value: string, where: string): number {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(value);
  if (!m) throw new SourcingDataError(`${where} must be YYYY-MM, got '${value}'`);
  return monthIndex(Number(m[1]), Number(m[2]));
}

export interface RenewalCalendarArgs {
  scenarioId: string;
  /** `contract` members. */
  contracts: readonly Member[];
  /** The scenario's lines: a contract's annual value is the sum of their `outlay` over its `lines`. */
  lines: readonly SourcingLine[];
  /** `vendor` members (contract vendor key -> member). */
  vendors: readonly Member[];
  params: SourcingParamsLookup;
  /** The plan year: its `iyear` member and its calendar year (the tenant's target year). */
  planYear: { key: string; calendarYear: number };
}

/**
 * The renewal calendar of every contract, counted from `asOf` = the first day of the month given by the
 * `asof_year` / `asof_month` parameters.
 *
 * - **Next renewal.** `renewal_month` when it is at or after the as-of month. A renewal already past rolls
 *   forward by `term_months` (until at or after the as-of month) when the contract auto-renews: it renewed
 *   unchanged, and the next one is the one to work on. A past renewal of a contract that does not auto-renew
 *   stays where it is: the contract is running out without a negotiated renewal.
 * - **Notice deadline** = the first day of the renewal month minus `notice_days`; `daysToDeadline` is
 *   counted from `asOf` (negative once it has passed).
 * - **Status**, first that holds: `overdue` the deadline has passed; `act_now` the deadline is at most
 *   `act_now_days` away; `plan` the renewal falls inside the planning window (`window_months` months from
 *   the as-of month on); `later` otherwise.
 * - **Escalator exposure** = annual value x `escalator_pct` (the cost of renewing unchanged, a year).
 * - **Capture** = annual value x `target_cut_pct` x (months of the plan year from the renewal month on) / 12;
 *   a renewal before the plan year captures the whole year, one after it nothing. An auto-renew contract whose
 *   notice deadline has passed captures nothing: it renews unchanged (escalator included) and the cut waits for
 *   the next term. A contract that does not auto-renew keeps the formula even when overdue: it must be
 *   renegotiated anyway.
 *
 * Every contract is listed (sorted by notice deadline, then key); `byMonth` covers the window only.
 */
export function renewalCalendar(args: RenewalCalendarArgs): RenewalCalendarView {
  const { params } = args;
  const asOfIdx = monthIndex(params.value(K.asofYear), params.value(K.asofMonth));
  const asOfMs = firstDayMs(asOfIdx);
  const window = params.value(K.windowMonths);
  const actNow = params.value(K.actNowDays);
  const planStart = monthIndex(args.planYear.calendarYear, 1);
  const outlay = new Map(args.lines.map((l) => [l.id, l.outlay]));
  const directory = new VendorDirectory(args.vendors);

  const renewals: RenewalRow[] = args.contracts.map((c) => {
    const where = `contract ${c.id}`;
    let renewal = parseMonth(str(c, 'renewal_month'), `${where}: renewal_month`);
    if (renewal < asOfIdx && flag(c['auto_renew'])) {
      const term = requiredNum(c, 'term_months', 'contract');
      if (term <= 0) throw new SourcingDataError(`${where}: term_months must be positive to roll an auto-renewal forward`);
      renewal += Math.ceil((asOfIdx - renewal) / term) * term;
    }
    const deadlineMs = firstDayMs(renewal) - requiredNum(c, 'notice_days', 'contract') * DAY_MS;
    const daysToDeadline = Math.round((deadlineMs - asOfMs) / DAY_MS);
    const status: RenewalStatus =
      daysToDeadline < 0 ? 'overdue' : daysToDeadline <= actNow ? 'act_now' : renewal < asOfIdx + window ? 'plan' : 'later';
    const annualValue = strings(c['lines']).reduce((s, id) => s + (outlay.get(id) ?? 0), 0);
    const targetCut = fraction(requiredNum(c, 'target_cut_pct', 'contract'));
    const lockedIn = flag(c['auto_renew']) && daysToDeadline < 0;
    const months = lockedIn ? 0 : Math.min(MONTHS_IN_YEAR, Math.max(0, planStart + MONTHS_IN_YEAR - Math.max(renewal, planStart)));
    const vendorName = str(c, 'vendor_name');
    return {
      contract: c.id,
      vendor: vendorName !== '' ? vendorName : memberLabel(c),
      vendorKey: directory.keyOf(vendorName, strOrNull(c, 'vendor')),
      category: str(c, 'category') || memberLabel(c),
      annualValue,
      renewalMonth: isoMonth(renewal),
      noticeDeadline: isoDate(deadlineMs),
      daysToDeadline,
      status,
      escalatorExposure: annualValue * requiredNum(c, 'escalator_pct', 'contract'),
      targetCut,
      capture: (annualValue * targetCut * months) / MONTHS_IN_YEAR,
    };
  });
  renewals.sort((a, b) => a.daysToDeadline - b.daysToDeadline || (a.contract < b.contract ? -1 : a.contract > b.contract ? 1 : 0));

  const byStatus = Object.fromEntries(RENEWAL_STATUSES.map((s) => [s, 0])) as Record<RenewalStatus, number>;
  for (const r of renewals) byStatus[r.status] += 1;
  const sum = (f: (r: RenewalRow) => number, rows: readonly RenewalRow[] = renewals) => rows.reduce((s, r) => s + f(r), 0);

  const byMonth: RenewalMonthRow[] = [];
  for (let i = 0; i < window; i++) {
    const month = isoMonth(asOfIdx + i);
    const rows = renewals.filter((r) => r.renewalMonth === month);
    byMonth.push({ month, renewals: rows.length, annualValue: sum((r) => r.annualValue, rows), capture: sum((r) => r.capture, rows) });
  }

  return {
    scenarioId: args.scenarioId,
    asOf: isoDate(asOfMs),
    planYear: args.planYear.key,
    renewals,
    totals: {
      contracts: renewals.length,
      annualValue: sum((r) => r.annualValue),
      escalatorExposure: sum((r) => r.escalatorExposure),
      capture: sum((r) => r.capture),
      byStatus,
    },
    byMonth,
  };
}
