import type {
  BundleResponse,
  CalcResponse,
  ChangesetHistoryResponse,
  InputsResponse,
  MeResponse,
  MembersResponse,
  ScenarioId,
  ScenariosResponse,
  TenantSlug,
  TenantsResponse,
} from '@glidepath/api-contract';
import { STALE_TIME_MS } from './client';
import { dataKeys } from './keys';
import { useApiClient, useServerState } from './provider';
import { useQueryEntry, useServerQuery, type QueryResult } from './use-query';

/**
 * Server state over the typed client (07 §2, 04 §4). Every hook returns the zod-parsed body
 * tier 2 sent plus loading / error state (`QueryResult`); nothing is derived here. Stale times
 * are long (`STALE_TIME_MS`); the `changeset` WS message invalidates what a commit changes
 * (`invalidate.ts`). The cache underneath is `server-state.ts` (ADR-026).
 */

export const useMe = (): QueryResult<MeResponse> => {
  const client = useApiClient();
  return useServerQuery(dataKeys.me(), () => client.me(), STALE_TIME_MS.me);
};

export const useTenants = (): QueryResult<TenantsResponse> => {
  const client = useApiClient();
  return useServerQuery(dataKeys.tenants(), () => client.tenants(), STALE_TIME_MS.tenants);
};

/** Definitions and labels for the tenant's pinned model version; revalidated by ETag. */
export const useBundle = (tenant: TenantSlug): QueryResult<BundleResponse> => {
  const client = useApiClient();
  return useServerQuery(
    dataKeys.bundle(tenant),
    () => client.bundle({ params: { tenant } }),
    STALE_TIME_MS.bundle,
  );
};

export const useMembers = (tenant: TenantSlug): QueryResult<MembersResponse> => {
  const client = useApiClient();
  return useServerQuery(
    dataKeys.members(tenant),
    () => client.members({ params: { tenant } }),
    STALE_TIME_MS.members,
  );
};

export const useScenarios = (tenant: TenantSlug): QueryResult<ScenariosResponse> => {
  const client = useApiClient();
  return useServerQuery(
    dataKeys.scenarios(tenant),
    () => client.scenarios({ params: { tenant } }),
    STALE_TIME_MS.scenarios,
  );
};

/** Resolved inputs of one scenario (`v_inputs_resolved`) plus its node overrides. */
export const useInputs = (
  tenant: TenantSlug,
  scenarioId: ScenarioId,
): QueryResult<InputsResponse> => {
  const client = useApiClient();
  return useServerQuery(
    dataKeys.inputs(tenant, scenarioId),
    () => client.scenarioInputs({ params: { tenant, id: scenarioId } }),
    STALE_TIME_MS.inputs,
  );
};

/** Latest stored calc run of one scenario; `stale` is tier 2's flag for the recalculate chip. */
export const useCalc = (tenant: TenantSlug, scenarioId: ScenarioId): QueryResult<CalcResponse> => {
  const client = useApiClient();
  return useServerQuery(
    dataKeys.calc(tenant, scenarioId),
    () => client.scenarioCalc({ params: { tenant, id: scenarioId } }),
    STALE_TIME_MS.calc,
  );
};

/** The pages fetched so far, in the order tier 2 sent them (first page first). */
export interface HistoryData {
  pages: ChangesetHistoryResponse[];
}

export interface HistoryResult extends QueryResult<HistoryData> {
  /** True while the last page tier 2 sent has a `nextCursor`. */
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  /** Fetches the page after the last one; no-op without a `nextCursor`. */
  fetchNextPage: () => Promise<void>;
}

/**
 * Changeset history of one scenario, one page per fetch. `fetchNextPage()` follows `nextCursor`.
 * An invalidation (a new changeset) refetches the first page only and drops later pages, so the
 * newest entries show at once; the caller pages again if it wants more.
 */
export const useHistory = (
  tenant: TenantSlug,
  scenarioId: ScenarioId,
  options: { limit?: number } = {},
): HistoryResult => {
  const client = useApiClient();
  const serverState = useServerState();
  const { limit } = options;
  const key = dataKeys.historyPages(tenant, scenarioId, limit);
  const page = (cursor?: string) =>
    client.changesetHistory({
      params: { tenant, id: scenarioId },
      query: {
        ...(cursor !== undefined ? { cursor } : {}),
        ...(limit !== undefined ? { limit } : {}),
      },
    });
  const { result, entry } = useQueryEntry<HistoryData>(
    key,
    async () => ({ pages: [await page()] }),
    STALE_TIME_MS.history,
  );
  const last = result.data?.pages.at(-1);
  return {
    ...result,
    hasNextPage: last?.nextCursor != null,
    isFetchingNextPage: entry?.fetchingMore ?? false,
    fetchNextPage: () =>
      serverState.fetchMore<HistoryData>(
        key,
        (current) => {
          const cursor = current.pages.at(-1)?.nextCursor;
          return cursor ? async () => ({ pages: [await page(cursor)] }) : null;
        },
        (current, next) => ({ pages: [...current.pages, ...next.pages] }),
      ),
  };
};
