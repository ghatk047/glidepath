import { useCallback, useEffect, useState } from 'react';
import {
  ApiError,
  type BenchmarkGap,
  type ConsolidationResult,
  type RenewalCalendar,
  type ScenarioId,
  type SourcingParams,
  type TenantSlug,
  type VendorSpend,
} from '@glidepath/api-contract';
import { useApiClient } from '../../data';

/** One sourcing read as tier 2 last answered it. `data` is kept while a reload is out. */
export interface Read<T> {
  data: T | null;
  /** Tier 2's one line (`problem.detail`) when the last request failed. */
  error: string | null;
  /** A request is out (first load or reload). */
  busy: boolean;
}

export interface SourcingData {
  vendors: Read<VendorSpend>;
  renewals: Read<RenewalCalendar>;
  benchmarks: Read<BenchmarkGap>;
  params: Read<SourcingParams>;
  consolidation: Read<ConsolidationResult>;
  /** Reads everything again and re-runs the consolidation optimizer (after a commit). */
  reload(): void;
}

const lineOf = (e: unknown): string =>
  e instanceof ApiError ? e.problem.detail : e instanceof Error ? e.message : 'Tier 2 did not answer';

const EMPTY = { data: null, error: null, busy: true } as const;

/**
 * The four sourcing views, the parameters and the consolidation run for one scenario, straight from
 * tier 2 (`GET /sourcing/*`, `POST /sourcing/consolidation`). Values are kept as tier 2 sent them;
 * nothing is derived here. A newer request supersedes an older one (scenario switch, reload).
 */
export function useSourcing(tenant: TenantSlug, scenarioId: ScenarioId): SourcingData {
  const api = useApiClient();
  const [rev, setRev] = useState(0);
  const [vendors, setVendors] = useState<Read<VendorSpend>>(EMPTY);
  const [renewals, setRenewals] = useState<Read<RenewalCalendar>>(EMPTY);
  const [benchmarks, setBenchmarks] = useState<Read<BenchmarkGap>>(EMPTY);
  const [params, setParams] = useState<Read<SourcingParams>>(EMPTY);
  const [consolidation, setConsolidation] = useState<Read<ConsolidationResult>>(EMPTY);

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
    follow(setVendors, () => api.sourcingVendors({ params: { tenant }, query }));
    follow(setRenewals, () => api.sourcingRenewals({ params: { tenant }, query }));
    follow(setBenchmarks, () => api.sourcingBenchmarks({ params: { tenant }, query }));
    follow(setParams, () => api.sourcingParams({ params: { tenant }, query }));
    follow(setConsolidation, () =>
      api.sourcingConsolidation({ params: { tenant }, body: { scenarioId } }),
    );
    return () => {
      live = false;
    };
  }, [api, tenant, scenarioId, rev]);

  const reload = useCallback(() => setRev((n) => n + 1), []);
  return { vendors, renewals, benchmarks, params, consolidation, reload };
}
