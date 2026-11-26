/**
 * SRC-02: the sourcing dimensions `contract`, `benchmark` and `sourcing_param` (docs/backlog/SRC.md,
 * "Data decisions"). They are tenant data, not part of the model: the spec's formula graph does not
 * define them, no formula expands over them and the engine never sees them, so editing one moves no
 * number and leaves the members hash and every calc_run input hash as they are. Their members carry
 * the numbers as attributes (`dimension_member.attrs`) and are edited as structural changes through
 * `applyChangeset`, like any tenant dimension.
 */
import type { JsonObject, JsonValue } from '../changeset';
import type { ValidationEntry } from './catalog';
import { toCellKey } from './state';

/** The sourcing dimensions, in seed order. */
export const SOURCING_DIMENSIONS = ['contract', 'benchmark', 'sourcing_param'] as const;
export type SourcingDimension = (typeof SOURCING_DIMENSIONS)[number];

/** The dimension holding the sourcing parameters (value, unit, min, max, step, group; label column). */
export const SOURCING_PARAM_DIM = 'sourcing_param' satisfies SourcingDimension;

const SOURCING = new Set<string>(SOURCING_DIMENSIONS);

/** True for `contract`, `benchmark` and `sourcing_param`: data-only tenant dimensions. */
export const isSourcingDimension = (dim: string): dim is SourcingDimension => SOURCING.has(dim);

/** The number attributes a `sourcing_param` member must carry. */
export const SOURCING_PARAM_NUMBERS = ['value', 'min', 'max', 'step'] as const;

const isObject = (v: JsonValue | undefined): v is JsonObject =>
  v !== null && v !== undefined && typeof v === 'object' && !Array.isArray(v);
const finite = (v: JsonValue | undefined): v is number =>
  typeof v === 'number' && Number.isFinite(v);

/**
 * The problems of one sourcing member row as it will be stored (`{ label, attrs, sort, active }`,
 * after a partial `set` is laid over the stored row), as VR04 entries of severity `error`: the
 * registry-bounds rule, which a `reject` origin also raises to an error. Empty when the row is valid
 * or is not a `sourcing_param` row.
 *
 * A `sourcing_param` needs finite numbers `value`, `min`, `max` and `step`, with `min <= max`,
 * `step > 0` and `value` in `[min, max]`.
 */
export function sourcingRowEntries(dim: string, memberKey: string, row: JsonObject): ValidationEntry[] {
  if (dim !== SOURCING_PARAM_DIM) return [];
  const cell = toCellKey(dim, memberKey);
  const error = (message: string): ValidationEntry => ({
    rule: 'VR04',
    severity: 'error',
    cells: [cell],
    message: `${cell}: ${message}`,
  });
  const attrs = isObject(row.attrs) ? row.attrs : {};
  const missing = SOURCING_PARAM_NUMBERS.filter((k) => !finite(attrs[k]));
  if (missing.length > 0) return [error(`${missing.join(', ')} must be finite numbers`)];
  const { value, min, max, step } = attrs as Record<(typeof SOURCING_PARAM_NUMBERS)[number], number>;
  const out: ValidationEntry[] = [];
  if (min > max) out.push(error(`min ${min} is above max ${max}`));
  if (step <= 0) out.push(error(`step ${step} must be positive`));
  if (min <= max && (value < min || value > max)) {
    out.push(error(`value ${value} is outside [${min}, ${max}]`));
  }
  return out;
}
