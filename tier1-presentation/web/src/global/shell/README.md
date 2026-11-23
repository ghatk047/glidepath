# global/shell

Global layer I (WEB-06; IA §2, §6; inventory Shell): everything that is on every module screen,
part 1. Sends intent, renders what tier 2 sent. Nothing is computed here.

```tsx
<DataProvider client serverState>        {/* app root, inside the router */}
  <GlobalLayout tenant scenarioId module session onTrace?>
    <ModuleScreen />
  </GlobalLayout>
</DataProvider>
```

- `GlobalLayout` mounts `GlassProvider` + `Aurora`, the toast, `CommitProvider`
  (`onFork = useForkNavigation()`) and `BindProvider commit={useCommit().commit}`, so every bound
  number below it commits through the WEB-05 queue.
- Rail (`@glidepath/ui/shell`): the 8 modules (ids from the contract, copy in `modules.tsx`), the
  tenant monogram (slug, upper case, never a logo) opens Airlines. Links are real paths; clicks
  route without reload and drop the module's selection.
- Scenario bar: `GET /scenarios` → `scenarioBarModel` (presets as letters, `user`/`blend` in
  Custom, `solver` in Paths). Selecting pushes `/:tenant/:scenario/:module` (selection kept) and
  sends `open` on the same session; every bound number rolls to the new snapshot.
- Edits counter + tray: count as tier 2 reports it (commit queue, else the scenario's
  `editsCount`); rows from `GET /scenarios/:id/changesets` (`applied` changesets, one row per
  change, labels and units from the bundle; the viewer's own read "You"). Undo / Redo through the
  queue (`/changesets/:id/revert`); Save as scenario = `POST /scenarios {mode: copy}` then the URL
  moves to the copy; Discard = `PATCH /scenarios/:id {archived: true}` then back to its parent.
- Flight strip: `useNode` on `res.net`, `res.bar`, `res.gap`, `res.risk`, `br.eps27`; hidden on
  Cockpit; skeletons until the first values; `data-stale` (dimmed) after a drop.
- Theme: Cruise ⇄ Daylight via the view store (remembered per viewer).
- Toast (`useToast()`): after each commit / undo / redo answer, "cause · net $X" with the net tier 2
  returned; after save and discard.
- States (IA §6): loading skeletons (title, scenario bar, strip); error chip with tier 2's
  `problem.detail` (commit, tray action, session `error`, scenario list); rule warnings of the last
  commit verbatim; reconnecting chip on a session drop; "Recalculate" chip when the stored calc is
  `stale`. Any `[data-stale]` value is dimmed.
- "Find any number" opens the `commandPalette` panel in the view store (the palette is WEB-07).
- Tests: `shell.test.tsx` (msw for REST, the contract's mock session for WS, a memory router with
  the app's route shape, axe for G12).
