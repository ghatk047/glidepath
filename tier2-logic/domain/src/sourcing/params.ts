// SRC-06..09: the `sourcing_param` members as a typed lookup, and the attribute readers the sourcing
// views share. No number is defaulted here: a parameter the tenant does not hold is an error that
// names it (the defaults live in tier3-data/seed/aa/sourcing.json).
import type { AttrValue, Member } from '@glidepath/spec';
import type { SourcingParamRow } from './types';

/** Sourcing data a view needs is missing or malformed (a parameter, a contract or benchmark attribute). */
export class SourcingDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SourcingDataError';
  }
}

/** The `sourcing_param` keys the views read (spec of tier3-data/seed/aa/sourcing.json). */
export const SOURCING_PARAM_KEYS = {
  asofYear: 'asof_year',
  asofMonth: 'asof_month',
  windowMonths: 'window_months',
  actNowDays: 'act_now_days',
  targetPercentile: 'target_percentile',
  capturePct: 'capture_pct',
} as const;

// ---------------------------------------------------------------------------------- attribute readers

export const str = (m: Member, attr: string): string => {
  const v = m[attr];
  return typeof v === 'string' ? v : '';
};

export const strOrNull = (m: Member, attr: string): string | null => {
  const v = m[attr];
  return typeof v === 'string' && v !== '' ? v : null;
};

/** A finite number attribute, or `undefined`. Numeric strings (jsonb text) count. */
export const numOrUndef = (v: AttrValue | undefined): number | undefined => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
};

/** A number attribute a view cannot do without: throws `SourcingDataError` naming the member. */
export function requiredNum(m: Member, attr: string, dim: string): number {
  const n = numOrUndef(m[attr]);
  if (n === undefined) throw new SourcingDataError(`${dim} ${m.id}: ${attr} must be a number`);
  return n;
}

/** A 0/1 or boolean flag (the view turns bool columns into 0/1). */
export const flag = (v: AttrValue | undefined): boolean => v === true || v === 1 || v === '1';

export const strings = (v: AttrValue | undefined): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

export const memberLabel = (m: Member): string => {
  const l = m['label'];
  return typeof l === 'string' && l !== '' ? l : m.id;
};

// ---------------------------------------------------------------------------------- parameters

export interface SourcingParamsLookup {
  /** Every parameter, in member order. */
  readonly params: readonly SourcingParamRow[];
  /** A parameter's value; throws `SourcingDataError` when the tenant holds no such parameter. */
  value(key: string): number;
  has(key: string): boolean;
}

/**
 * The `sourcing_param` members as rows (`key`, `label`, `group`, `value`, `unit`, `min`, `max`, `step`)
 * and a lookup by key. A member without finite value, min, max and step is malformed: applyChangeset
 * refuses one (VR04), so meeting one here is a data error, not a default.
 */
export function readSourcingParams(members: readonly Member[]): SourcingParamsLookup {
  const params: SourcingParamRow[] = members.map((m) => ({
    key: m.id,
    label: memberLabel(m),
    group: str(m, 'group'),
    value: requiredNum(m, 'value', 'sourcing_param'),
    unit: str(m, 'unit'),
    min: requiredNum(m, 'min', 'sourcing_param'),
    max: requiredNum(m, 'max', 'sourcing_param'),
    step: requiredNum(m, 'step', 'sourcing_param'),
  }));
  const byKey = new Map(params.map((p) => [p.key, p.value]));
  return {
    params,
    has: (key) => byKey.has(key),
    value(key) {
      const v = byKey.get(key);
      if (v === undefined) throw new SourcingDataError(`sourcing_param ${key} is missing: add it to the tenant's parameters`);
      return v;
    },
  };
}
