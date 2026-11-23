# commit

Commit path, fork, undo/redo (WEB-05; 04 §4, 07 §3, IA §3). Sends intent; stores what tier 2
answers. Nothing is computed here.

```tsx
<DataProvider client serverState>
  <CommitProvider tenant scenarioId session onFork={useForkNavigation()}>
    <BindProvider tenant scenarioId session commit={useCommit().commit}>
      …
    </BindProvider>
  </CommitProvider>
</DataProvider>
```

- `createCommitQueue({ tenant, scenarioId, client, session?, baseVersion?, debounceMs?, onFork?, onResult? })`:
  `commit(change)` queues one change per cell (latest wins) and posts the batch as one
  `POST /changesets` `COMMIT_DEBOUNCE_MS` (400 ms) after the last edit. POSTs are serialised, so each
  goes on the version the previous answer gave. `baseVersion` = newest version reported for the
  scenario (commit answer, session `changeset`), else the resolved inputs' version.
- 409 (`isChangesetConflict`): the same changes are re-sent on `serverVersion` with a new
  `clientRequestId` (up to `MAX_CONFLICT_RESENDS`, then the conflict is the commit error). No answer
  at all: one retry with the same `clientRequestId`. The whole exchange sits in one
  `session.settleCommit`, so `cancelPreview` follows it.
- Fork: an answer with `forkedFrom` moves the queue to the new scenario (edits still queued on the
  preset follow it), refetches the scenario list and the fork's data, and calls `onFork`.
  `useForkNavigation()` swaps `:scenario` in the URL (replace), keeping module and search; the
  scenario bar then shows tier 2's label (`Custom (from Plan C)`).
- `store` (zustand): `scenarioId`, `version`, `editsCount`, `warnings` (verbatim), `forkedFrom`,
  `pending`, `inFlight`, `error` (`{detail, status, problem}`, tier 2's one line), `canUndo`, `canRedo`.
  `CommitProvider` reports `editsCount` to the view store. Session `changeset` messages on the same
  scenario update `version` and `editsCount`.
- `undo()` / `redo()`: flush, then `POST /changesets/:id/revert` on the latest commit (undo) or the
  latest undo (redo); a new commit clears redo. The stack holds the changeset ids of this session
  only (the contract does not expose tier 2's undo/redo targets).
- `useCommit()`, `useCommitState(selector)`. Keep `CommitProvider` props stable (a new `client`,
  `session` or `newRequestId` makes a new queue).
- Tests: `commit.test.tsx` (msw for REST, fake timers for the debounce, a memory router for the fork).
