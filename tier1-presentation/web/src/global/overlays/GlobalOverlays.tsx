import { useCallback, useEffect, useRef } from 'react';
import {
  toCellKey,
  type ScenarioId,
  type SearchResult,
  type TenantSlug,
} from '@glidepath/api-contract';
import { CommandPalette, type PaletteItem } from '@glidepath/ui/overlays/palette';
import { useBundle, useInputs } from '../../data';
import { BoundEditPopover } from './BoundEditPopover';
import { BoundTraceDrawer } from './BoundTraceDrawer';
import {
  overlayController,
  usePaletteOpen,
  usePopoverTarget,
  useTraceCell,
  type OverlayController,
} from './controller';
import { useJump } from './jump';
import { usePaletteSearch } from './palette';

export interface GlobalOverlaysProps {
  tenant: TenantSlug;
  scenarioId: ScenarioId;
  /** Default: the app's `overlayController`. */
  controller?: OverlayController | undefined;
  /** How long a jump waits for the control on the new screen (default `FOCUS_WAIT_MS`). */
  focusWaitMs?: number | undefined;
}

/**
 * Global layer II (IA §2): ⌘K palette, edit popover and trace drawer, wired to tier 2.
 * Mount it inside `GlobalLayout` (it needs the router, `DataProvider`, `CommitProvider` and
 * `BindProvider` that the layout mounts) and pass `controller.openTrace` as `GlobalLayout onTrace`.
 */
export function GlobalOverlays({
  tenant,
  scenarioId,
  controller = overlayController,
  focusWaitMs,
}: GlobalOverlaysProps) {
  const paletteOpen = usePaletteOpen(controller);
  const popover = usePopoverTarget(controller);
  const traceCell = useTraceCell(controller);
  const search = usePaletteSearch(tenant, scenarioId);
  const jump = useJump(focusWaitMs);
  const bundle = useBundle(tenant);
  const inputs = useInputs(tenant, scenarioId);

  // read at pick time: a jump lands after navigation, on whatever tier 2 sent by then
  const latest = useRef({ bundle: bundle.data, inputs: inputs.data });
  latest.current = { bundle: bundle.data, inputs: inputs.data };

  /** Member a variable opens on: scalar `''`; else the first cell tier 2 resolved for it. */
  const memberOf = useCallback((id: string) => {
    const def = latest.current.bundle?.variables.find((v) => v.id === id);
    if (!def || def.dims.length === 0) return '';
    return latest.current.inputs?.inputs.find((i) => i.var === id)?.member ?? '';
  }, []);

  const onPick = useCallback(
    (result: SearchResult) => {
      void jump(result).then((el) => {
        if (result.kind === 'input') {
          controller.openPopover({
            kind: 'input',
            variable: result.id,
            member: memberOf(result.id),
            anchor: el,
          });
        } else if (result.kind === 'node') {
          controller.openTrace(toCellKey(result.id, ''));
        }
      });
    },
    [jump, controller, memberOf],
  );

  // each opening starts from an empty query (the screens), however it was opened
  const { setQuery } = search;
  useEffect(() => {
    if (paletteOpen) setQuery('');
  }, [paletteOpen, setQuery]);
  const onOpenChange = (open: boolean) =>
    open ? controller.openPalette() : controller.closePalette();

  return (
    <>
      <CommandPalette
        open={paletteOpen}
        onOpenChange={onOpenChange}
        items={search.items}
        filter={false}
        onQueryChange={search.setQuery}
        onSelect={(item: PaletteItem) => {
          const r = search.resultOf(item);
          if (r) onPick(r);
        }}
      />
      {popover && <BoundEditPopover target={popover} onClose={controller.closePopover} />}
      <BoundTraceDrawer cell={traceCell} onClose={controller.closeTrace} />
    </>
  );
}
