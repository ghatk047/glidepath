// Levers "Lever studio": families, monthly curve, bar scale (ADR-021, docs/ux/03_screens.md).
import type { DimId, Member, MemberId, TenantMembers } from '@glidepath/spec';
import { attrOf, inDisplayOrder, membersOf, valueOf } from './read';
import type {
  LeversFamiliesView,
  LeversMonthlyView,
  LeversScaleView,
  ViewEvaluation,
} from './types';

/** Months of the target year (calendar; the contract's `MONTHS_IN_YEAR`, `lev.start` max). */
export const MONTHS_IN_YEAR = 12;

/** The lever dimension, the family attribute, and the cells the lever views read (spec ids). */
export const LEVER_DIM: DimId = 'lever';
export const LEVER_FAMILY_ATTRIBUTE = 'category';
export const LEVER_CELLS = {
  inYear: 'lev.iy',
  totalInYear: 'res.tot_iy',
  effStart: 'lev.eff_start',
  ramp: 'lev.ramp',
} as const;

/** Levers in display order (`order` attribute), each with its family (`category`; else its id). */
function leversOf(members: TenantMembers): { lever: Member; family: string }[] {
  return inDisplayOrder(membersOf(members, LEVER_DIM)).map((lever) => ({
    lever,
    family: attrOf(lever, LEVER_FAMILY_ATTRIBUTE) || lever.id,
  }));
}

/** Families in order of their first lever, with their levers in display order. */
function familiesOf(members: TenantMembers): { key: string; levers: MemberId[] }[] {
  const families = new Map<string, MemberId[]>();
  for (const { lever, family } of leversOf(members)) {
    const list = families.get(family) ?? [];
    list.push(lever.id);
    families.set(family, list);
  }
  return [...families].map(([key, levers]) => ({ key, levers }));
}

/**
 * Σ `lev.iy` by lever `category`, families in order of their first lever (`order`), `total` =
 * `res.tot_iy`. The label is the category itself (the view carries no other name for it).
 */
export function leversFamilies(ev: ViewEvaluation, members: TenantMembers): LeversFamiliesView {
  return {
    total: valueOf(ev, LEVER_CELLS.totalInYear),
    families: familiesOf(members).map(({ key, levers }) => ({
      key,
      label: key,
      value: levers.reduce((s, id) => s + valueOf(ev, LEVER_CELLS.inYear, id), 0),
      levers,
    })),
  };
}

/**
 * The share of a month's full run-rate realised, month 1..12, by the formula graph's linear ramp:
 * from `lev.eff_start` the saving climbs by 1/`lev.ramp` a month until it reaches the run-rate. So
 * `Σ_m weight / 12` is `lev.ramp_factor`:
 * `IF(13 − s <= r, (13 − s)(14 − s) / 2r, (r + 1)/2 + (13 − s − r)) / 12`.
 * A ramp of 0 or less is a step at the start month.
 */
export function rampWeights(effStart: number, ramp: number): number[] {
  return Array.from({ length: MONTHS_IN_YEAR }, (_, i) => {
    const elapsed = i + 1 - effStart + 1; // months of work done by the end of month i + 1
    if (elapsed <= 0) return 0;
    return ramp <= 0 ? 1 : Math.min(1, elapsed / ramp);
  });
}

/**
 * The CY27 in-year saving of each lever spread over the months: month m gets
 * `lev.iy × w_m / Σ w`, with `w` the ramp weights of `lev.eff_start` and `lev.ramp`. As
 * `lev.iy = lev.rr × lev.ramp_factor × lev.realize` and `ramp_factor = Σ w / 12`, this is
 * `lev.rr × lev.realize × w_m / 12`, and the months sum to `lev.iy` (also when `lev.iy` is pinned).
 * Families are the month-by-month sums of their levers, in `levers.families` order.
 */
export function leversMonthly(ev: ViewEvaluation, members: TenantMembers): LeversMonthlyView {
  const levers = leversOf(members).map(({ lever, family }) => {
    const iy = valueOf(ev, LEVER_CELLS.inYear, lever.id);
    const w = rampWeights(
      valueOf(ev, LEVER_CELLS.effStart, lever.id),
      valueOf(ev, LEVER_CELLS.ramp, lever.id),
    );
    const total = w.reduce((s, x) => s + x, 0);
    return {
      key: lever.id,
      family,
      values: w.map((x) => (total === 0 ? 0 : (iy * x) / total)),
    };
  });
  const families = familiesOf(members).map(({ key }) => {
    const own = levers.filter((l) => l.family === key);
    return {
      key,
      values: Array.from({ length: MONTHS_IN_YEAR }, (_, m) =>
        own.reduce((s, l) => s + (l.values[m] ?? 0), 0),
      ),
    };
  });
  return { families, levers };
}

/**
 * Common scale of the lever in-year bars: the largest `lev.iy` across levers of the evaluation
 * given. The Levers screen scales to preset D ("Full stretch"), so the caller passes D's evaluation.
 * 0 when there are no levers.
 */
export function leversScale(
  evOfScalePreset: ViewEvaluation,
  members: TenantMembers,
): LeversScaleView {
  const values = membersOf(members, LEVER_DIM).map((l) =>
    valueOf(evOfScalePreset, LEVER_CELLS.inYear, l.id),
  );
  return { max: values.length === 0 ? 0 : Math.max(...values) };
}
