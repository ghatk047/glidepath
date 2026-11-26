import { useCallback, useEffect, useState } from 'react';
import {
  ApiError,
  type BusinessCase,
  type ScenarioId,
  type SourcingParams,
  type TenantSlug,
} from '@glidepath/api-contract';
import { useApiClient } from '../../data';
import type { Read } from '../sourcing/useSourcing';

export interface PlanReads {
  businessCase: Read<BusinessCase>;
  /** The `sourcing_param` members (business case and wave plan groups are edited here). */
  params: Read<SourcingParams>;
  /** Reads both again (after a parameter commit). */
  reload(): void;
}

const lineOf = (e: unknown): string =>
  e instanceof ApiError ? e.problem.detail : e instanceof Error ? e.message : 'Tier 2 did not answer';

const EMPTY = { data: null, error: null, busy: true } as const;

/**
 * The plan route's lever business case and the sourcing parameters for one scenario, straight from tier 2
 * (`GET /plan/business-case`, `GET /sourcing/params`). Nothing is derived; a newer request supersedes an older.
 */
export function usePlanReads(tenant: TenantSlug, scenarioId: ScenarioId): PlanReads {
  const api = useApiClient();
  const [rev, setRev] = useState(0);
  const [businessCase, setBusinessCase] = useState<Read<BusinessCase>>(EMPTY);
  const [params, setParams] = useState<Read<SourcingParams>>(EMPTY);

  useEffect(() => {
    let live = true;
    const follow = <T,>(set: (f: (r: Read<T>) => Read<T>) => void, request: () => Promise<T>) => {
      set((r) => ({ ...r, busy: true }));
      request().then(
        (data) => live && set(() => ({ data, error: null, busy: false })),
        (e: unknown) => live && set((r) => ({ data: r.data, error: lineOf(e), busy: false })),
      );
    };
    const query = { scenario: scenarioId };
    follow(setBusinessCase, () => api.planBusinessCase({ params: { tenant }, query }));
    follow(setParams, () => api.sourcingParams({ params: { tenant }, query }));
    return () => {
      live = false;
    };
  }, [api, tenant, scenarioId, rev]);

  const reload = useCallback(() => setRev((n) => n + 1), []);
  return { businessCase, params, reload };
}
