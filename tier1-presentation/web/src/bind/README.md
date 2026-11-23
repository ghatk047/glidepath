# bind

Binding hooks and bound components (WEB-04, 07 §2, ADR-018). `ui` stays presentational; this
folder feeds it the values tier 2 pushed and sends intent back. Nothing is computed here.

```tsx
<BindProvider tenant scenarioId session={sessionClient} commit? onTrace?>
  <Value node="res.net" format="money" />
  <BoundEditable variable="g.target_net" />
  <BoundSlider variable="lev.L10.shelf" ghosts={['C', 'D']} />
</BindProvider>
```

- `BindProvider` (inside `DataProvider`): tenant, scenario on screen, the session client
  (`createSessionClient`), an optional `commit` (WEB-05's queue; default: direct
  `POST /changesets` on the session's version, wrapped in `session.settleCommit`), and an optional
  `onTrace(cell)` for the trace drawer.
- `useNode(id, member?)`: subscribes `id[member]` on mount, releases on unmount (ref-counted by the
  session client), re-renders on each pushed value. Returns `value` (`undefined` not received,
  `null` none), `stale`, `cell` and the bundle's `NodeDef`. `useCell` is the same without the bundle.
- `useVariable(id, member?)`: `definition` (label, unit, min, max, step, kind, source, confidence,
  default) from the bundle and the scenario's resolved inputs, `value` (session cell, else the
  resolved input), `from`, `stale`, `preview(v)` (session preview) and `commit(v | null, note?)`
  (`null` clears the scenario's own value). `default` is the tenant default when tier 2 resolves the
  cell from the tenant layer, else `null`: the bundle carries no default (contract gap, see WEB-04 notes).
- `useView(view, params)`: ADR-021 view-models (`bridge`, `baseline.groups {by}`, ...); params are
  compared by value. `useTrace(cell)`: `GET /nodes/:cell/explain`, refetched on a new version.
- `useGhosts(id, member, keys)`: values of the cell in the scenarios with those keys, from tier 2's
  resolved inputs (`GET /scenarios/:id/inputs`, shared cache with `useInputs`).
- `<Value>`: output cell; with a trace handler it is the output Editable number (#9), else a rolled
  number. `<BoundEditable variable | node>`: Editable number (#9) with the Edit popover (#10) fed by
  the definition; popover changes preview and commit, Reset commits `null`. `<BoundSlider>`:
  Slider decision / estimate (#7, #8) by `kind`, ghost ticks from `ghosts` scenario keys. A pushed
  value outside [min, max] is clamped by the slider for display only and never written back.
- Stale values carry `data-stale` (dimming is the global states layer, WEB-06).
- Tests: `bind.test.tsx` (msw for REST, the contract's mock session for WS, generated spec fixtures).
