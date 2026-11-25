import type { ScenarioId, TenantSlug } from '@glidepath/api-contract';

/**
 * Query keys, one place. Tenant-scoped keys start with `['t', tenant]` and per-scenario keys
 * continue with `['scenario', id, <resource>]`, so a prefix invalidates a whole resource.
 */
export const dataKeys = {
  me: () => ['me'] as const,
  tenants: () => ['tenants'] as const,
  bundle: (tenant: TenantSlug) => ['t', tenant, 'bundle'] as const,
  members: (tenant: TenantSlug) => ['t', tenant, 'members'] as const,
  scenarios: (tenant: TenantSlug) => ['t', tenant, 'scenarios'] as const,
  inputs: (tenant: TenantSlug, id: ScenarioId) => ['t', tenant, 'scenario', id, 'inputs'] as const,
  calc: (tenant: TenantSlug, id: ScenarioId) => ['t', tenant, 'scenario', id, 'calc'] as const,
  /** Prefix of every page set of one scenario's history, whatever its page size. */
  history: (tenant: TenantSlug, id: ScenarioId) =>
    ['t', tenant, 'scenario', id, 'history'] as const,
  historyPages: (tenant: TenantSlug, id: ScenarioId, limit: number | undefined) =>
    ['t', tenant, 'scenario', id, 'history', { limit: limit ?? null }] as const,
};
