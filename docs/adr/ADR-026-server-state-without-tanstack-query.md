# ADR-026: Server state without TanStack Query

## Context
ADR-009 named TanStack Query for tier 1 server state (bundle, members, scenarios, calc, history). The tier-boundary test `tier1-presentation/web/src/app/imports.test.ts` (G13) holds an allow-list of runtime libraries for the SPA, and `@tanstack/react-query` is not on it. The list is a guard we do not widen to fit one item. WEB-02 still needs a keyed cache with in-flight de-duplication, loading and error state, long stale times, and invalidation when tier 2 reports a `changeset` (04 §4).

## Decision
Tier 1 gets a thin server-state layer built on `fetch` (through the typed client of `@glidepath/api-contract`) and zustand, in `tier1-presentation/web/src/data/server-state.ts`. It provides a keyed cache of what tier 2 sent, one request per key at a time, `pending / success / error` state that keeps the last good data on a failed refetch, stale times, invalidate-by-key-prefix (mounted hooks refetch now, others on next use, and a request in flight at invalidation re-runs once), and `fetchMore` for cursor paging. Screens use stable hooks (`useMe`, `useTenants`, `useBundle`, `useMembers`, `useScenarios`, `useInputs`, `useCalc`, `useHistory`) that return `{ data, error, status, isPending, isLoading, isSuccess, isError, isFetching, isStale, refetch }`, the fields of TanStack's result that the UI uses. `changeset` messages from the WS session invalidate scenarios, history, calc and inputs (`invalidate.ts`). The layer holds and moves tier 2 values only; it computes nothing (tier 1 rule). For the demo this is enough; no retry or background refetch on window focus is built.

## Consequences
- ADR-009's server-state line is amended: server state is this layer, not TanStack Query. Router (TanStack Router) and view state (Zustand) are unchanged.
- No new runtime dependency; the G13 allow-list is untouched.
- Hooks, keys, and `ServerState` are the only surface screens see. Swapping back to TanStack Query later means changing the internals of `server-state.ts`, `use-query.ts` and `invalidate.ts`, plus adding the library to the allow-list by its own decision; hook names and arguments stay.
- Less built-in than TanStack Query: no automatic retry, no garbage collection of unused entries (they live for the session), history refetch drops pages after the first. Revisit if a screen needs them.
- Docs that still say "TanStack Query" (`01_architecture_overview.md` row 009, `04_data_and_api.md` §4) read as this layer until they are next edited.

## Status
Accepted (coordinator decision during WEB-02, 2026-11-23). Reversible: change the layer's internals.
