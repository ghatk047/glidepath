# global/overlays

Global layer II (WEB-07; IA §2, 07 §2, inventory #4, #10, Overlays): ⌘K palette, edit popover and
trace drawer, wired to tier 2. Sends intent, renders what tier 2 sent. Nothing is computed here.

```tsx
<GlobalLayout tenant scenarioId module session onTrace={overlayController.openTrace}>
  <GlobalOverlays tenant={tenant} scenarioId={scenarioId} />
  <ModuleScreen />
</GlobalLayout>
```

- Controllers (`controller.ts`): `overlayController` (or `createOverlayController(viewStore)`) holds
  the targets; open / closed is the view store's `openPanels` (`commandPalette`, `editPopover`,
  `traceDrawer`). `openPalette()`, `openPopover({kind: 'input', variable, member?, anchor?})` /
  `({kind: 'output', node, member?, anchor?})`, `openTrace(cell)` and the `close*` twins. Pass
  `openTrace` as `GlobalLayout onTrace`, so every bound output opens the drawer.
- ⌘K (`palette.ts`, `jump.ts`): the ui `CommandPalette` (⌘K / Ctrl+K and the shell's "Find any
  number" button) with `filter={false}`: each typed query is `GET /search?q&limit=9&scenario`
  (the previous request aborted), results listed as tier 2 ranked them; an empty query lists the
  eight screens. Enter / click: the URL moves to the result's `module` (same tenant and scenario;
  `?lever=` for levers, `?node=` for outputs), then the control bound to the id
  (`data-id`, `data-variable-id`, `data-node`, `data-lever`) is focused once it renders
  (`FOCUS_WAIT_MS`). An input then opens its edit popover anchored there (a dimensioned variable on
  the first cell tier 2 resolved for it); an output opens its trace.
- Edit popover (`BoundEditPopover`): input = `useVariable` definition (label, unit, min, max, step,
  source, confidence, default) and value; changes preview and commit through the WEB-05 queue,
  Reset commits `null`. A variable without a registry range gets a slider fixed on its value (the
  field still takes any number). Output (overridable nodes only): "Pin with reason" posts
  `{target: 'override', key, member, value, note: reason}`; Reset removes an existing pin. Rule
  warnings of the commit queue are shown verbatim (those naming the cell; all of them after a
  commit from the popover).
- Trace drawer (`BoundTraceDrawer`): `useTrace(cell)` (`GET /nodes/:cell/explain`): value, node
  id, formula in words, upstream chain (tier 2's `depth`, farthest first, the cell last and
  highlighted), top drivers in tier 2's order. Skeletons while loading; tier 2's `detail` on error.
  Presses on outputs re-point it instead of closing it.
- Tests: `overlays.test.tsx` (msw for REST incl. a `/search` double over the bundle fixture, the
  contract's mock session for WS, a memory router with the app's route shape, axe for G12).
