# rows

Trace node (#23), Move row (#24), Diff row (#25). Import as `@glidepath/ui/rows`. Presentational only: every value, status and label arrives as a prop (formatted by tier 2 or with `fmt`); nothing here computes, nets or decides. Matches `docs/ux/prototype/src/styles.css` (`.tnode`, `.move`, `.tbl`) and `docs/ux/screens/data-dark-1440.jpg`.

- `TraceNode { nodeId, label, value, note?, selected?, onOpen(nodeId) }`: a button; `data-node={nodeId}` is the trigger the trace drawer ignores for outside clicks. `selected` = accent ring + glow (`aria-current`). Hover or focus shows the node id in the shared `Tooltip`.
- `TraceChain { nodes, selectedId, onOpen }`: an `<ol>` of nodes with an arrow between each pair; scrolls sideways when narrow.
- `MoveRow { variableId, label, from, to, min, max, unit, step?, rank, fromLabel? }`: track (`min`..`max`), tick at `from` (the C value), accent span between, thumb at `to`, "from → to" text through `formatByUnit` (or `format`). Positions are clamped to the track. `rank` shows as `01`.
- `DiffRow { sheet, item, exported, file, appNow, status, accepted?, onAccept?, choice?, onChoice? }`: one `<tr>` for `DiffTable`. `status`: `ok` / `new` / `conflict` / `removed`, set by tier 2. ok, new and removed get an accept `Toggle`; `new` adds a "new line" chip; `removed` strikes the item and adds a "✕ removed" chip; `conflict` shows a File / App `Segmented` and a visually hidden "conflict:" before the app value (not colour alone).
- CSS is generated from tokens (`styles.ts`) and injected with a hoisted `<style href precedence>`. Reuses `inputs/controls`, `inputs/slider` (`formatByUnit`, `percentOf`) and `overlays/drawer` (`tipProps`).
