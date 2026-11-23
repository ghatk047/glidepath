# data

Server-state hooks over the typed client of `@glidepath/api-contract` (WEB-02, 04 §4, 07 §2).
They return what tier 2 sent, zod-parsed; nothing is computed here. The cache underneath is a
thin `fetch` + zustand layer, not TanStack Query (ADR-026); screens only see the hooks.

- `server-state.ts`: `createServerState()`, a keyed cache with one request per key at a time,
  `pending / success / error` state (a failed refetch keeps the last good data), stale times,
  `invalidate(prefix, { exact? })` (mounted hooks refetch now, others on next use; a request in
  flight at invalidation re-runs when it lands) and `fetchMore` for cursor pages.
  Unchanged JSON keeps the same object, so unchanged data does not re-render.
- `use-query.ts`: `useServerQuery` binds one cache entry to a component (zustand `useStore`) and
  returns `QueryResult`: `data, error, status, isPending, isLoading, isSuccess, isError, isFetching, isStale, refetch`.
- `createDataClient({ baseUrl?, fetch? })`: `createClient` plus ETag revalidation for the bundle
  (`etag-fetch.ts`: `if-none-match` on the next request, a `304` is handed to the client as the
  remembered 200). `<DataProvider client serverState>` mounts both; `useApiClient()`, `useServerState()`.
- Hooks: `useMe()`, `useTenants()`, `useBundle(tenant)`, `useMembers(tenant)`,
  `useScenarios(tenant)`, `useInputs(tenant, scenarioId)`, `useCalc(tenant, scenarioId)`,
  `useHistory(tenant, scenarioId, { limit? })` (`hasNextPage`, `fetchNextPage`, `data.pages`).
- Stale times (`STALE_TIME_MS`): 15 min for scenario-bound data, 30 min for me / tenants,
  60 min for bundle / members. They are long because tier 2 says when data changed.
- `changeset` invalidation (`invalidate.ts`): `invalidateForChangeset` refetches the tenant's
  scenario list and, for the message's `scenarioId` (and `forkedFrom`), its history, calc and
  resolved inputs. The bundle, members, me and tenants stay cached.
  `bindChangesetInvalidation(serverState, tenant, source)` / `useChangesetInvalidation(tenant, source)`
  take a `ServerMessageSource` (`listener => unsubscribe`), so this folder does not depend on the
  session client in `../session` (WEB-03); wire its message stream in as `source`.
- Keys: `dataKeys` (`['t', tenant, 'scenario', id, 'calc']`, ...). Prefixes invalidate whole resources.
- Imports only `@glidepath/api-contract`, `react` and `zustand` (G13).
  Tests: `server-state.test.ts` (the layer) and `data.test.tsx` (hooks with msw, the contract's
  core and generated spec fixtures, and its mock session).

CSRF (WEB-09): `createDataClient` wraps its fetch in `withCsrfHeader` (`csrf-fetch.ts`): POST/PUT/PATCH/DELETE carry `x-csrf-token` read per request from the readable `gp_csrf` cookie, which tier 2 requires on state-changing calls of a session. Every call (changesets, Excel uploads, solver runs) goes through this client, so there is no other place to add it.
