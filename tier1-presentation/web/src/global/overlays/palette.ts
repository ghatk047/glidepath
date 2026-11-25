import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ApiError,
  type ScenarioId,
  type SearchResult,
  type TenantSlug,
} from '@glidepath/api-contract';
import { MAX_RESULTS, type PaletteItem } from '@glidepath/ui/overlays/palette';
import { MODULE_IDS } from '../../app/modules';
import { useApiClient } from '../../data';
import { MODULE_COPY } from '../shell/modules';

/** The eight screens, listed before anything is typed (labels are the rail's copy). */
export const SCREEN_RESULTS: readonly SearchResult[] = MODULE_IDS.map((m) => ({
  kind: 'screen',
  id: m,
  label: MODULE_COPY[m].title,
  unit: null,
  group: MODULE_COPY[m].label,
  module: m,
  hint: null,
}));

const toItem = (r: SearchResult): PaletteItem => ({
  id: r.id,
  label: r.label,
  kind: r.kind,
  ...(r.unit ? { unit: r.unit } : {}),
});

export interface PaletteSearch {
  /** What the palette lists: tier 2's results for the query, the screens when it is empty. */
  readonly items: readonly PaletteItem[];
  /** The result behind a listed item. */
  resultOf(item: PaletteItem): SearchResult | undefined;
  /** Feed each typed query: asks `GET /search?q=` (the previous request is aborted). */
  setQuery(q: string): void;
  /** Last search failure, tier 2's one line. */
  readonly error: string | null;
}

/**
 * ⌘K controller: every typed query goes to tier 2's `/search` (scoped to the scenario on screen,
 * capped at the palette's `MAX_RESULTS`); results are listed exactly as tier 2 ranked them.
 */
export function usePaletteSearch(tenant: TenantSlug, scenarioId: ScenarioId): PaletteSearch {
  const api = useApiClient();
  const [results, setResults] = useState<readonly SearchResult[]>(SCREEN_RESULTS);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef<AbortController | null>(null);

  useEffect(() => () => inFlight.current?.abort(), []);

  const setQuery = useCallback(
    (raw: string) => {
      inFlight.current?.abort();
      inFlight.current = null;
      const q = raw.trim();
      setError(null);
      if (!q) {
        setResults(SCREEN_RESULTS);
        return;
      }
      const ctrl = new AbortController();
      inFlight.current = ctrl;
      api
        .search({
          params: { tenant },
          query: { q, limit: MAX_RESULTS, scenario: scenarioId },
          signal: ctrl.signal,
        })
        .then((r) => {
          if (!ctrl.signal.aborted) setResults(r.results);
        })
        .catch((e: unknown) => {
          if (ctrl.signal.aborted) return;
          setResults([]);
          setError(
            e instanceof ApiError ? e.problem.detail : e instanceof Error ? e.message : String(e),
          );
        });
    },
    [api, tenant, scenarioId],
  );

  const { items, byItem } = useMemo(() => {
    const map = new WeakMap<PaletteItem, SearchResult>();
    const list = results.map((r) => {
      const item = toItem(r);
      map.set(item, r);
      return item;
    });
    return { items: list, byItem: map };
  }, [results]);

  const resultOf = useCallback((item: PaletteItem) => byItem.get(item), [byItem]);
  return { items, resultOf, setQuery, error };
}
