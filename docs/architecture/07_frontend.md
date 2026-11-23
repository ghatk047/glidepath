# 07 · Tier 1 · Presentation

Tier 1 implements `ux/` exactly and unchanged: Cruise (dark) and Daylight themes from `tokens.json`, the global layer (rail, scenario bar, edits counter, ⌘K, flight strip, edit popover, trace drawer, toast) and the eight modules. It contains **no business logic**: no formulas, engine, solvers, validation rules, Excel handling or scenario rules. It renders what tier 2 sends and sends user intent back. The prototype in `ux/prototype/src/` is the visual reference only; its estimated in-browser math is not carried over.

## 1. Structure

```
tier1-presentation/web/src/
├── main.tsx, router.tsx           # TanStack Router: /:tenant/:scenario/:module + ?lever ?group ?key ?node
├── view-store/                    # Zustand: selection, open panels, drag state, theme, edits counter (as reported by tier 2)
├── session/                       # WS client for /ws/session: subscribe, preview, deltas → cell value map
├── data/                          # TanStack Query hooks over contract/api-contract
├── global/                        # Rail, ScenarioBar, EditsTray, CommandPalette, FlightStrip, EditPopover, TraceDrawer, Toasts
└── modules/  cockpit/ baseline/ levers/ vps/ path/ market/ excel/ airlines/
tier1-presentation/ui/src/
├── tokens/   glass/   inputs/   outputs/   format/   motion/
```
(Components as in `ux/04_component_inventory.md`: 6 shell, 9 inputs, 12 outputs, overlays.)

## 2. Binding model

Components bind to ids; values come from tier 2.

```tsx
<EditableNumber variable="g.target_net" />            // input: definition + value from tier 2
<Value node="res.net" format="money" />               // output: pushed by the session
<SliderDecision variable="lev.L10.shelf" ghosts={['C','D']} />
```

- `useNode(id, member?)` registers a subscription with the session (tier 2 pushes only subscribed cells) and re-renders when that cell's value changes.
- `useVariable(id, member?)` returns the definition tier 2 sent (label, unit, min, max, step, kind, source, confidence, default), the current value, and `preview(v)` / `commit(v)` which send intent to tier 2.
- `useTrace(cell)` calls `/nodes/:cell/explain` for the trace drawer; ⌘K calls `/search`.
- Panel → node bindings per module are in `ux/03_screens.md`; module backlog items copy that table as acceptance criteria.

## 3. Editing feel without local math

- While dragging, the thumb and its value label move locally at 60 fps (presentation state). Previews go to tier 2 at most every 33 ms, latest value wins; bound numbers update when deltas arrive (p95 < 25 ms on local Docker, so it reads as instant).
- Numbers animate from old to new value (number roll from tokens), which also smooths any network jitter later in the cloud.
- Release or typed entry → `POST /changesets`. Tier 2 answers with the new version, edits count and any rule warnings; the edit popover shows warnings in tier 2's words.
- Presets are read-only: tier 2 performs the fork to `Custom (from X)` and tells tier 1, which updates the scenario bar.
- Decision vs estimate thumbs use `kind` from the definition.
- If the session drops, values dim and a "reconnecting" chip shows; no stale math is ever invented.

## 4. Charts

Hand-written SVG; D3 used only for scales, shapes and treemap layout of values tier 2 provides (layout is presentation; the values and groupings come from tier 2). Tooltips on every mark, token colours, VP colours by slot, direct labels.

## 5. Performance rules

- Subscriptions follow visibility: a module subscribes to its panels' cells on mount and unsubscribes on unmount, keeping deltas small.
- Batch delta application per animation frame.
- Glass budget: at most three `backdrop-filter` layers on screen; pre-blurred aurora background; low-blur fallback by `prefers-reduced-transparency` or frame-time sampling.
- Code-split per module; preload Cockpit, Levers and Path.

## 6. Accessibility and responsiveness

As in `ux/04_component_inventory.md` and `ux/03_screens.md`: keyboard for every control, visible focus, `role="status"` toasts, contrast in both themes, reduced motion, breakpoints 1180 px and 760 px, phone layout with bottom bar and a slimmer flight strip.

## 7. Demo resilience (replaces v1.0's in-browser offline kit)

Because all three tiers run in Docker on the Mac, the demo needs no internet: the browser talks to `http://localhost` (or the Mac's hostname on a projector laptop). The only internet-dependent feature, AI reconfiguration, shows the rehearsed UA result cached in tier 3. A pre-demo script (`ops/demo-check.sh`) verifies all containers healthy, seed loaded, golden numbers on Cockpit C, cached solver and UA results present.
