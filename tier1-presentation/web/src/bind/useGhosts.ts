import { useEffect, useMemo } from 'react';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import type { InputsResponse, ScenarioId } from '@glidepath/api-contract';
import type { SliderGhost } from '@glidepath/ui/inputs/slider';
import {
  STALE_TIME_MS,
  dataKeys,
  hashKey,
  useApiClient,
  useScenarios,
  useServerState,
} from '../data';
import { useBindContext } from './context';

/**
 * Ghost ticks of a slider: the value of `id[member]` in each scenario named by key (`C`, `D`),
 * read from tier 2's resolved inputs of that scenario (`GET /scenarios/:id/inputs`, shared with
 * `useInputs`). A key the tenant has no scenario for, or a cell with no value there, gives no tick.
 */
export function useGhosts(
  id: string,
  member: string,
  keys: readonly string[],
): readonly SliderGhost[] {
  const { tenant } = useBindContext();
  const client = useApiClient();
  const serverState = useServerState();
  const scenarios = useScenarios(tenant);

  const keysHash = JSON.stringify(keys);
  const wanted = useMemo(() => {
    const list = scenarios.data?.scenarios ?? [];
    return (JSON.parse(keysHash) as string[]).flatMap((key) => {
      const s = list.find((x) => x.key === key);
      return s ? [{ key, scenarioId: s.id }] : [];
    });
  }, [scenarios.data, keysHash]);
  const idsHash = JSON.stringify(wanted.map((w) => w.scenarioId));

  // Keep each ghost scenario's inputs loaded while mounted (one cache entry per scenario).
  useEffect(() => {
    const ids = JSON.parse(idsHash) as ScenarioId[];
    const releases = ids.map((scenarioId) => {
      const key = dataKeys.inputs(tenant, scenarioId);
      const fetcher = () => client.scenarioInputs({ params: { tenant, id: scenarioId } });
      const release = serverState.observe(key, fetcher, STALE_TIME_MS.inputs);
      void serverState.fetch(key, fetcher, { staleTime: STALE_TIME_MS.inputs });
      return release;
    });
    return () => releases.forEach((r) => r());
  }, [serverState, client, tenant, idsHash]);

  const bodies = useStore(
    serverState.store,
    useShallow((s) =>
      wanted.map(
        (w) =>
          s.entries[hashKey(dataKeys.inputs(tenant, w.scenarioId))]?.data as
            InputsResponse | undefined,
      ),
    ),
  );

  return useMemo(
    () =>
      wanted.flatMap((w, i) => {
        const hit = bodies[i]?.inputs.find((r) => r.var === id && r.member === member);
        return hit && hit.value !== null ? [{ label: w.key, value: hit.value }] : [];
      }),
    [wanted, bodies, id, member],
  );
}
