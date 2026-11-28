import { SolverSpec as SolverSpecSchema } from '@glidepath/api-contract';
import type { SolverSpec } from '@glidepath/api-contract';
import { loadSourcingMembers } from '@glidepath/data-access';
import type { TenantTx } from '@glidepath/data-access';

/**
 * SRC-15: the tenant's defaults of a `wave_plan` run. The solver is pure and treats an absent cap as no cap, so the
 * route fills every field the request leaves out from the tenant's `sourcing_param` members of group `wave_plan`
 * (tier3-data/seed/aa/sourcing.json), before the run is stored: the stored spec, its cache key and the lookup all
 * carry the caps the run was solved with. A parameter the tenant lacks stays absent (no cap, the registry window).
 */

/** `sourcing_param` member ids the wave planner reads. */
export const WAVE_PLAN_PARAMS = {
  quarterlyOneTimeCap: 'quarterly_onetime_cap_musd',
  maxLaunchesPerQuarter: 'max_launches_per_quarter',
  earliestStart: 'earliest_start_month',
  latestStart: 'latest_start_month',
} as const;

type WavePlanParams = Extract<SolverSpec, { problem: 'wave_plan' }>['params'];

/** The `value` of each `sourcing_param` member that has a finite number there, by member id. */
export type SourcingParamValues = ReadonlyMap<string, number>;

export function sourcingParamValues(members: readonly { readonly id: string; readonly [attr: string]: unknown }[]): SourcingParamValues {
  const out = new Map<string, number>();
  for (const m of members) {
    const v = m.value;
    if (typeof v === 'number' && Number.isFinite(v)) out.set(m.id, v);
  }
  return out;
}

/** `params` with every absent field taken from the tenant's values (fields the request sent win). */
export function withWavePlanDefaults(params: WavePlanParams, values: SourcingParamValues): WavePlanParams {
  const cap = values.get(WAVE_PLAN_PARAMS.quarterlyOneTimeCap);
  const launches = values.get(WAVE_PLAN_PARAMS.maxLaunchesPerQuarter);
  const from = values.get(WAVE_PLAN_PARAMS.earliestStart);
  const to = values.get(WAVE_PLAN_PARAMS.latestStart);
  return {
    ...(params.quarterlyOneTimeCap === undefined && cap !== undefined ? { quarterlyOneTimeCap: cap } : {}),
    ...(params.maxLaunchesPerQuarter === undefined && launches !== undefined ? { maxLaunchesPerQuarter: launches } : {}),
    ...(params.window === undefined && from !== undefined && to !== undefined ? { window: { from, to } } : {}),
    ...params,
  };
}

/**
 * A `wave_plan` spec with the tenant's defaults filled in, checked against the contract again (a tenant value out of
 * range is a 422 like a bad request); any other spec as given.
 */
export async function withTenantDefaults(tx: TenantTx, spec: SolverSpec): Promise<SolverSpec> {
  if (spec.problem !== 'wave_plan') return spec;
  const { members } = await loadSourcingMembers(tx);
  const values = sourcingParamValues(members['sourcing_param'] ?? []);
  return SolverSpecSchema.parse({ ...spec, params: withWavePlanDefaults(spec.params, values) });
}
