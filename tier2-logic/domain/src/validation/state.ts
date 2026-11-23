/**
 * What the input rules read, and the lookups they share. Rules are pure functions over one
 * `ValidationState`; the lookups are built once per state object and cached.
 */
import type {
  DimId,
  Member,
  MemberId,
  ModelBundle,
  TenantMembers,
  VarId,
  VariableDef,
} from '@glidepath/spec';
import type { MemberKey } from '../member-key';
import type { InputValueRow } from '../resolve';

/** The state the input rules validate: one scenario's resolved inputs after a change. */
export interface ValidationState {
  /** The tenant's pinned model version: `variables` (min/max, dims) and `nodes` (VR10). */
  readonly bundle: Pick<ModelBundle, 'variables' | 'nodes'>;
  /** Tenant dimension members with attributes (v_dimension_members, `ChangesetTx.loadMembers`). */
  readonly members: TenantMembers;
  /**
   * The resolved input cells, one per (var_key, member_key): `resolveInputs(...).values` passes as is.
   * A cell that is absent counts as 0 in a sum; a comparison with an absent side is not made.
   */
  readonly values: readonly InputValueRow[];
}

/** The contract's CellKey (`id[member_key]`, `id[]` for a scalar), as in api-contract `toCellKey`. */
export function toCellKey(id: string, memberKey: MemberKey = ''): string {
  return `${id}[${memberKey}]`;
}

/** Lookups over one state. */
export interface RuleContext {
  readonly state: ValidationState;
  readonly variables: ReadonlyMap<VarId, VariableDef>;
  /** The resolved value of a cell, or undefined when no level sets it. */
  value(varKey: VarId, memberKey: MemberKey): number | undefined;
  /** The members of a dimension, in tenant order (empty when the tenant has none). */
  members(dim: DimId): readonly Member[];
  /** A member by id, or undefined. */
  member(dim: DimId, id: MemberId): Member | undefined;
}

const contexts = new WeakMap<ValidationState, RuleContext>();

/** The lookups of `state`, built on first use. */
export function contextOf(state: ValidationState): RuleContext {
  const cached = contexts.get(state);
  if (cached) return cached;

  const variables = new Map(state.bundle.variables.map((v) => [v.id, v]));
  const values = new Map<VarId, Map<MemberKey, number>>();
  for (const r of state.values) {
    const byMember = values.get(r.var_key) ?? new Map<MemberKey, number>();
    values.set(r.var_key, byMember.set(r.member_key, r.value));
  }
  const byDim = new Map<DimId, Map<MemberId, Member>>();
  const memberMap = (dim: DimId): Map<MemberId, Member> => {
    let map = byDim.get(dim);
    if (!map) {
      map = new Map((state.members[dim] ?? []).map((m) => [m.id, m]));
      byDim.set(dim, map);
    }
    return map;
  };

  const ctx: RuleContext = {
    state,
    variables,
    value: (varKey, memberKey) => values.get(varKey)?.get(memberKey),
    members: (dim) => state.members[dim] ?? [],
    member: (dim, id) => memberMap(dim).get(id),
  };
  contexts.set(state, ctx);
  return ctx;
}

/** A member's label for messages: its `label` attribute, else its id. */
export function memberLabel(ctx: RuleContext, dim: DimId, id: MemberId): string {
  const label = ctx.member(dim, id)?.label;
  return typeof label === 'string' && label.trim() !== '' ? label.trim() : id;
}

/** A variable's label for messages, else its id. */
export function variableLabel(ctx: RuleContext, varKey: VarId): string {
  const label = ctx.variables.get(varKey)?.label;
  return label !== undefined && label.trim() !== '' ? label.trim() : varKey;
}

/** The labels of a member key's members, comma-separated, e.g. `Pilots (APA), FY2027E`. */
export function memberKeyLabel(ctx: RuleContext, dims: readonly DimId[], key: MemberKey): string {
  if (dims.length === 0) return '';
  const ids = key.split(',');
  return ids
    .map((id, i) => (dims[i] === undefined ? id : memberLabel(ctx, dims[i], id)))
    .join(', ');
}

/** Significant digits shown in messages: enough for any registry value, no float noise. */
const SIGNIFICANT_DIGITS = 6;
const PERCENT = 100;

/** A number for a message: `0.30000000000000004` reads `0.3`. */
export function formatNumber(x: number): string {
  if (!Number.isFinite(x)) return String(x);
  return String(Number(x.toPrecision(SIGNIFICANT_DIGITS)));
}

/** A share for a message: `0.9` reads `90%`. */
export function formatShare(x: number): string {
  return `${formatNumber(x * PERCENT)}%`;
}

/** `a`, `a and b`, `a, b and c`, or `a, b, c and 3 more` beyond `max` items. */
export function formatList(items: readonly string[], max = 3): string {
  if (items.length <= 1) return items[0] ?? '';
  if (items.length > max) {
    return `${items.slice(0, max).join(', ')} and ${items.length - max} more`;
  }
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/**
 * Absolute tolerance of the rules' sums and bounds: float noise (`0.3 + 0.6 + 0.1` is
 * 0.9999999999999999) never fails a rule, any real difference does.
 */
export const RULE_TOLERANCE = 1e-9;
