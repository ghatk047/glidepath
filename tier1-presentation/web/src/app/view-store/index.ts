import { createStore, useStore } from 'zustand';
import { initTheme, setTheme as applyThemeToDocument } from '@glidepath/ui/tokens';
import { themeNames, type ThemeName } from '@glidepath/ui/tokens';
import { SEARCH_KEYS, type ViewSearch } from '../search';

/**
 * View state (ADR-009, IA §5): what is selected, which panels are open, what is being dragged,
 * the theme, and the edits count tier 2 reported. It holds no business values and computes none.
 * Tenant, scenario and module stay in the URL; the selection mirrors the URL's search params.
 */

export type Selection = { [K in (typeof SEARCH_KEYS)[number]]: string | null };

/** Global-layer panels (IA §2) that can be open at once. */
export const PANEL_IDS = ['editsTray', 'commandPalette', 'editPopover', 'traceDrawer'] as const;
export type PanelId = (typeof PANEL_IDS)[number];

/** A control being dragged: the thumb and its label move locally; tier 2 gets the previews. */
export interface DragState {
  id: string;
  value: number;
}

export interface ViewState {
  selection: Selection;
  openPanels: readonly PanelId[];
  drag: DragState | null;
  theme: ThemeName;
  /** Count of changes in the current Custom scenario, exactly as tier 2 last reported it. */
  editsCount: number;

  setSelection(patch: ViewSearch | Partial<Selection>): void;
  /** Replaces the whole selection from the URL's search params. */
  syncSelection(search: ViewSearch): void;
  clearSelection(): void;
  openPanel(id: PanelId): void;
  closePanel(id: PanelId): void;
  togglePanel(id: PanelId): void;
  closeAllPanels(): void;
  startDrag(id: string, value: number): void;
  updateDrag(value: number): void;
  endDrag(): void;
  setTheme(theme: ThemeName): void;
  toggleTheme(): void;
  /** Stores `editsCount` from a changeset result or a session message. Invalid counts are ignored. */
  reportEdits(count: number): void;
}

export interface ViewStoreOptions {
  theme?: ThemeName;
  /** Writes the theme to `<html data-theme>` and the viewer's storage. */
  applyTheme?: (theme: ThemeName) => void;
}

const emptySelection = (): Selection => ({ lever: null, group: null, key: null, node: null });

const selectionFrom = (search: ViewSearch): Selection => {
  const s = emptySelection();
  for (const k of SEARCH_KEYS) s[k] = search[k] ?? null;
  return s;
};

const sameSelection = (a: Selection, b: Selection) => SEARCH_KEYS.every((k) => a[k] === b[k]);

export function createViewStore(options: ViewStoreOptions = {}) {
  const applyTheme = options.applyTheme ?? ((t: ThemeName) => applyThemeToDocument(t));
  const initialTheme = options.theme ?? initTheme();

  return createStore<ViewState>()((set, get) => ({
    selection: emptySelection(),
    openPanels: [],
    drag: null,
    theme: initialTheme,
    editsCount: 0,

    setSelection: (patch) =>
      set((s) => {
        const next = { ...s.selection };
        for (const k of SEARCH_KEYS) {
          if (k in patch) next[k] = patch[k] ?? null;
        }
        return sameSelection(next, s.selection) ? s : { selection: next };
      }),
    syncSelection: (search) =>
      set((s) => {
        const next = selectionFrom(search);
        return sameSelection(next, s.selection) ? s : { selection: next };
      }),
    clearSelection: () => set({ selection: emptySelection() }),

    openPanel: (id) =>
      set((s) => (s.openPanels.includes(id) ? s : { openPanels: [...s.openPanels, id] })),
    closePanel: (id) =>
      set((s) =>
        s.openPanels.includes(id) ? { openPanels: s.openPanels.filter((p) => p !== id) } : s,
      ),
    togglePanel: (id) =>
      get().openPanels.includes(id) ? get().closePanel(id) : get().openPanel(id),
    closeAllPanels: () => set((s) => (s.openPanels.length ? { openPanels: [] } : s)),

    startDrag: (id, value) => set({ drag: { id, value } }),
    updateDrag: (value) => set((s) => (s.drag ? { drag: { ...s.drag, value } } : s)),
    endDrag: () => set((s) => (s.drag ? { drag: null } : s)),

    setTheme: (theme) => {
      if (!themeNames.includes(theme)) return;
      applyTheme(theme);
      set({ theme });
    },
    toggleTheme: () => {
      const i = themeNames.indexOf(get().theme);
      get().setTheme(themeNames[(i + 1) % themeNames.length]!);
    },

    reportEdits: (count) => {
      if (Number.isInteger(count) && count >= 0) set({ editsCount: count });
    },
  }));
}

export type ViewStore = ReturnType<typeof createViewStore>;

/** The app's one view store. */
export const viewStore: ViewStore = createViewStore();

export function useViewStore<T>(selector: (s: ViewState) => T): T {
  return useStore(viewStore, selector);
}
