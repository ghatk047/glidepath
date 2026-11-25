import { useEffect, useRef } from 'react';
import { useStore } from 'zustand';
import type { ExplainResponse, ScenarioId, TenantSlug } from '@glidepath/api-contract';
import { useApiClient, type QueryResult } from '../data';
import { useServerQuery } from '../data/use-query';
import { useBindContext } from './context';

/** Cache key of one explain answer; under the scenario's prefix like the other scenario reads. */
export const traceKey = (tenant: TenantSlug, scenarioId: ScenarioId, cell: string) =>
  ['t', tenant, 'scenario', scenarioId, 'explain', cell] as const;

/**
 * `useTrace(cell)`: `GET /nodes/:cell/explain` for the trace drawer (value, formula in words,
 * upstream chain, top drivers), exactly as tier 2 answers. Always fetched on mount (the drawer
 * mounts it when it opens) and again when the session reports a new scenario version; the cell
 * is subscribed meanwhile.
 */
export function useTrace(cell: string): QueryResult<ExplainResponse> {
  const { tenant, scenarioId, session } = useBindContext();
  const client = useApiClient();
  const result = useServerQuery(
    traceKey(tenant, scenarioId, cell),
    () => client.nodeExplain({ params: { tenant, cell }, query: { scenario: scenarioId } }),
    0,
  );

  // Holding the cell keeps the session on this scenario's versions while the drawer is open.
  useEffect(() => session.subscribe([cell]), [session, cell]);
  const version = useStore(session.store, (s) => s.version);
  const seen = useRef(version);
  const { refetch } = result;
  useEffect(() => {
    if (seen.current === version) return;
    seen.current = version;
    void refetch();
  }, [version, refetch]);

  return result;
}
