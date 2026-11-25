import { beforeEach, describe, expect, it } from 'vitest';
import { createViewStore, type ViewStore } from './index';

let store: ViewStore;
beforeEach(() => {
  store = createViewStore({ theme: 'cruise', applyTheme: () => {} });
});

describe('view store', () => {
  it('starts empty with the given theme and a zero edits counter', () => {
    const s = store.getState();
    expect(s.selection).toEqual({ lever: null, group: null, key: null, node: null });
    expect(s.openPanels).toEqual([]);
    expect(s.drag).toBeNull();
    expect(s.theme).toBe('cruise');
    expect(s.editsCount).toBe(0);
  });

  it('holds the selection (lever, group, key, node) and clears it', () => {
    store.getState().setSelection({ lever: 'L10', node: 'res.net' });
    expect(store.getState().selection).toEqual({
      lever: 'L10',
      group: null,
      key: null,
      node: 'res.net',
    });
    store.getState().setSelection({ group: 'pool', key: 'software' });
    expect(store.getState().selection.lever).toBe('L10');
    store.getState().clearSelection();
    expect(store.getState().selection.lever).toBeNull();
  });

  it('syncs selection from the URL without changing the identity when equal', () => {
    store.getState().syncSelection({ lever: 'L10' });
    const first = store.getState().selection;
    expect(first).toEqual({ lever: 'L10', group: null, key: null, node: null });
    store.getState().syncSelection({ lever: 'L10' });
    expect(store.getState().selection).toBe(first);
  });

  it('opens, closes and toggles panels without duplicates', () => {
    const s = store.getState();
    s.openPanel('traceDrawer');
    s.openPanel('traceDrawer');
    s.openPanel('editsTray');
    expect(store.getState().openPanels).toEqual(['traceDrawer', 'editsTray']);
    store.getState().closePanel('traceDrawer');
    expect(store.getState().openPanels).toEqual(['editsTray']);
    store.getState().togglePanel('editsTray');
    store.getState().togglePanel('commandPalette');
    expect(store.getState().openPanels).toEqual(['commandPalette']);
    store.getState().closeAllPanels();
    expect(store.getState().openPanels).toEqual([]);
  });

  it('tracks drag state and clears it on end', () => {
    store.getState().startDrag('lev.L10.shelf', 12);
    expect(store.getState().drag).toEqual({ id: 'lev.L10.shelf', value: 12 });
    store.getState().updateDrag(14);
    expect(store.getState().drag).toEqual({ id: 'lev.L10.shelf', value: 14 });
    store.getState().endDrag();
    expect(store.getState().drag).toBeNull();
  });

  it('ignores a drag update when nothing is being dragged', () => {
    store.getState().updateDrag(3);
    expect(store.getState().drag).toBeNull();
  });

  it('applies and stores the theme', () => {
    const applied: string[] = [];
    const s = createViewStore({ theme: 'cruise', applyTheme: (t) => applied.push(t) });
    s.getState().setTheme('daylight');
    expect(s.getState().theme).toBe('daylight');
    expect(applied).toEqual(['daylight']);
    s.getState().toggleTheme();
    expect(s.getState().theme).toBe('cruise');
  });

  it('stores the edits counter exactly as tier 2 reports it (never computes it)', () => {
    store.getState().reportEdits(1);
    expect(store.getState().editsCount).toBe(1);
    store.getState().reportEdits(7);
    expect(store.getState().editsCount).toBe(7);
    store.getState().reportEdits(0);
    expect(store.getState().editsCount).toBe(0);
  });

  it('rejects an invalid edits count from the wire', () => {
    store.getState().reportEdits(3);
    store.getState().reportEdits(-2);
    store.getState().reportEdits(Number.NaN);
    store.getState().reportEdits(1.5);
    expect(store.getState().editsCount).toBe(3);
  });
});
