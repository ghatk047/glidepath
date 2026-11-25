import { createStore, useStore, type StoreApi } from 'zustand';
import { viewStore as appViewStore, type ViewStore } from '../../app/view-store';

/**
 * What the edit popover is open on. `input`: a registry variable cell (definition and value from
 * `useVariable`). `output`: a formula node cell ("Pin with reason" writes an Override).
 * `anchor` is the number the popover hangs from; `null` when the control is not on screen.
 */
export type PopoverTarget =
  | {
      readonly kind: 'input';
      readonly variable: string;
      readonly member?: string | undefined;
      readonly anchor?: HTMLElement | null | undefined;
    }
  | {
      readonly kind: 'output';
      readonly node: string;
      readonly member?: string | undefined;
      readonly anchor?: HTMLElement | null | undefined;
    };

export interface OverlayState {
  /** Edit popover target; shown while the view store has the `editPopover` panel open. */
  readonly popover: PopoverTarget | null;
  /** Cell of the trace drawer (`res.net[]`); shown while `traceDrawer` is open. */
  readonly trace: string | null;
}

/**
 * Palette, popover and drawer controllers (WEB-07). Open / closed lives in the view store's
 * `openPanels` (`commandPalette`, `editPopover`, `traceDrawer`); the targets live here. View
 * state only: nothing here is a business value.
 */
export interface OverlayController {
  readonly store: StoreApi<OverlayState>;
  readonly view: ViewStore;
  openPalette(): void;
  closePalette(): void;
  openPopover(target: PopoverTarget): void;
  closePopover(): void;
  /** Opens the trace drawer on a cell; pass it as `GlobalLayout onTrace`. */
  openTrace(cell: string): void;
  closeTrace(): void;
}

export function createOverlayController(view: ViewStore = appViewStore): OverlayController {
  const store = createStore<OverlayState>()(() => ({ popover: null, trace: null }));
  const panels = () => view.getState();
  return {
    store,
    view,
    openPalette: () => panels().openPanel('commandPalette'),
    closePalette: () => panels().closePanel('commandPalette'),
    openPopover: (target) => {
      store.setState({ popover: target });
      panels().openPanel('editPopover');
    },
    closePopover: () => {
      panels().closePanel('editPopover');
      store.setState({ popover: null });
    },
    openTrace: (cell) => {
      store.setState({ trace: cell });
      panels().openPanel('traceDrawer');
    },
    closeTrace: () => {
      panels().closePanel('traceDrawer');
      store.setState({ trace: null });
    },
  };
}

/** The app's one overlay controller (on the app's view store). */
export const overlayController: OverlayController = createOverlayController();

const usePanelOpen = (view: ViewStore, id: 'commandPalette' | 'editPopover' | 'traceDrawer') =>
  useStore(view, (s) => s.openPanels.includes(id));

/** Palette open state (the shell's "Find any number" button and ⌘K open it). */
export function usePaletteOpen(c: OverlayController): boolean {
  return usePanelOpen(c.view, 'commandPalette');
}

/** Popover target while the `editPopover` panel is open, else `null`. */
export function usePopoverTarget(c: OverlayController): PopoverTarget | null {
  const open = usePanelOpen(c.view, 'editPopover');
  const target = useStore(c.store, (s) => s.popover);
  return open ? target : null;
}

/** Trace cell while the `traceDrawer` panel is open, else `null`. */
export function useTraceCell(c: OverlayController): string | null {
  const open = usePanelOpen(c.view, 'traceDrawer');
  const cell = useStore(c.store, (s) => s.trace);
  return open ? cell : null;
}
