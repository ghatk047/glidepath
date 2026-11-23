// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import axe from 'axe-core';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GlassProvider } from '../../glass';
import {
  CommandPalette,
  EditsTray,
  paletteCss,
  searchItems,
  type EditChange,
  type PaletteItem,
} from './index';

beforeEach(() => {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: q.includes('prefers-reduced-motion'),
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const wrap = (ui: React.ReactNode) => <GlassProvider frameSampling={false}>{ui}</GlassProvider>;

const kinds = ['input', 'lever', 'node', 'line', 'screen'];
const many: PaletteItem[] = Array.from({ length: 14 }, (_, i) => ({
  id: `item.${i}`,
  label: `Thing ${i}`,
  kind: kinds[i % kinds.length]!,
  unit: i % 2 ? '$M' : '',
}));
const index: PaletteItem[] = [
  { id: 'g.cola', label: 'COLA · wage escalator', kind: 'input', unit: '%/yr' },
  { id: 'L10', label: 'Cloud migration', kind: 'lever' },
  { id: 'res.net', label: 'Net savings · CY27', kind: 'node', unit: '$M' },
  { id: '#levers', label: 'Levers', kind: 'screen' },
];

/** Harness that owns `open`, like web does. */
function Harness({
  items = index,
  onSelect = () => {},
}: {
  items?: PaletteItem[];
  onSelect?: (i: PaletteItem) => void;
}) {
  const [open, setOpen] = useState(false);
  return wrap(
    <>
      <button type="button">before</button>
      <CommandPalette open={open} onOpenChange={setOpen} items={items} onSelect={onSelect} />
    </>,
  );
}

const key = (k: string, mods: Partial<KeyboardEventInit> = {}) =>
  fireEvent.keyDown(document.activeElement ?? document.body, { key: k, ...mods });

describe('UI-07 command palette: open, results, keys', () => {
  it('⌘K / Ctrl+K opens; up to 9 results with kind and unit on the right; arrow keys + Enter select', () => {
    const onSelect = vi.fn();
    render(<Harness items={many} onSelect={onSelect} />);
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    const dlg = screen.getByRole('dialog', { name: 'Find any number' });
    expect(document.activeElement).toBe(within(dlg).getByRole('combobox'));

    // 14 items, 9 shown; kind and unit on the right
    const opts = within(dlg).getAllByRole('option');
    expect(opts).toHaveLength(9);
    expect(opts[0]!.textContent).toBe('Thing 0input');
    expect(opts[1]!.textContent).toBe('Thing 1lever · $M');
    expect(opts[1]!.querySelector('.gp-pal-kind')!.textContent).toBe('lever · $M');
    expect(opts[0]!.getAttribute('aria-selected')).toBe('true');

    // arrow keys move the selection (and wrap); Enter selects
    key('ArrowDown');
    key('ArrowDown');
    expect(screen.getAllByRole('option')[2]!.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement!.getAttribute('aria-activedescendant')).toBe(opts[2]!.id);
    key('ArrowUp');
    key('ArrowUp');
    key('ArrowUp');
    expect(screen.getAllByRole('option')[8]!.getAttribute('aria-selected')).toBe('true');
    key('ArrowDown');
    key('ArrowDown');
    key('Enter');
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(many[1]);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('⌘K (meta) also opens, and typing narrows by label, id or kind', () => {
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);
    fireEvent.keyDown(document, { key: 'K', metaKey: true });
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'res.net' } });
    expect(screen.getAllByRole('option')).toHaveLength(1);
    fireEvent.change(input, { target: { value: 'cloud' } });
    fireEvent.click(screen.getByRole('option', { name: /Cloud migration/ }));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(index[1]);
  });

  it('onQueryChange reports each typed query; filter={false} shows the items as given (tier 2 search)', () => {
    const queries: string[] = [];
    const onSelect = vi.fn();
    function Server() {
      const [open, setOpen] = useState(true);
      const [items, setItems] = useState<PaletteItem[]>([]);
      return wrap(
        <CommandPalette
          open={open}
          onOpenChange={setOpen}
          filter={false}
          items={items}
          onSelect={onSelect}
          onQueryChange={(q) => {
            queries.push(q);
            // the owner answers with items that need not contain the typed text
            setItems(q ? many.slice(0, 12) : []);
          }}
        />,
      );
    }
    render(<Server />);
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'wages' } });
    expect(queries).toEqual(['wages']);
    expect(screen.getAllByRole('option')).toHaveLength(9);
    fireEvent.change(input, { target: { value: '' } });
    expect(queries).toEqual(['wages', '']);
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'cloud' }));
    expect(queries.at(-1)).toBe('cloud');
    key('Enter');
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(many[0]);
  });

  it('searchItems keeps arrival order, caps at 9, requires every word', () => {
    expect(searchItems(many, '')).toHaveLength(9);
    expect(searchItems(many, '', 3).map((i) => i.id)).toEqual(['item.0', 'item.1', 'item.2']);
    expect(searchItems(index, 'net cy27').map((i) => i.id)).toEqual(['res.net']);
    expect(searchItems(index, 'net lever')).toEqual([]);
  });

  it('empty state suggests "COLA", "cloud" and "headcount"', () => {
    render(<Harness />);
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'zzzz' } });
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    const empty = document.querySelector('.gp-pal-empty')!;
    expect(empty.textContent).toBe('No match. Try COLA, cloud or headcount.');
    // a suggestion fills the query and brings results back
    fireEvent.click(within(empty as HTMLElement).getByRole('button', { name: 'cloud' }));
    expect((screen.getByRole('combobox') as HTMLInputElement).value).toBe('cloud');
    expect(screen.getAllByRole('option')).toHaveLength(1);
  });
});

describe('UI-07 command palette: focus trap and Escape', () => {
  it('traps Tab inside, Escape closes and focus returns to the opener', () => {
    render(<Harness />);
    const before = screen.getByRole('button', { name: 'before' });
    before.focus();
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    const dlg = screen.getByRole('dialog');

    // empty state has a second tab stop (suggestion buttons): Tab cycles within the dialog
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'zzzz' } });
    const stops = [...dlg.querySelectorAll<HTMLElement>('input, button')];
    expect(stops.length).toBeGreaterThan(1);
    stops[stops.length - 1]!.focus();
    key('Tab');
    expect(document.activeElement).toBe(stops[0]);
    key('Tab', { shiftKey: true });
    expect(document.activeElement).toBe(stops[stops.length - 1]);

    // focus pushed outside is pulled back in
    act(() => before.focus());
    expect(dlg.contains(document.activeElement)).toBe(true);

    key('Escape');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(before);
  });

  it('a press on the scrim closes it', () => {
    render(<Harness />);
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    fireEvent.mouseDown(screen.getByTestId('palette-scrim'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('does not steal focus back when a selection moved it to the target', () => {
    const target = document.createElement('button');
    target.textContent = 'target';
    document.body.appendChild(target);
    render(<Harness onSelect={() => target.focus()} />);
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    key('Enter');
    expect(document.activeElement).toBe(target);
    target.remove();
  });

  it('has no accessibility violations (axe) with the palette open, with results and when empty', async () => {
    render(<Harness />);
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    const run = () => axe.run(document.body, { rules: { 'color-contrast': { enabled: false } } });
    expect((await run()).violations).toEqual([]);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'zzzz' } });
    expect((await run()).violations).toEqual([]);
  });
});

const changes: EditChange[] = [
  { id: 'c1', who: 'You', what: 'Net target · CY27', from: '$100.0M', to: '$120.0M' },
  { id: 'c2', who: 'Solver', what: 'Cloud migration · wave 2', from: 'Off', to: 'On' },
];

const trayProps = () => ({
  count: 2,
  changes,
  canUndo: true,
  canRedo: false,
  onUndo: vi.fn(),
  onRedo: vi.fn(),
  onSaveAsScenario: vi.fn(),
  onDiscard: vi.fn(),
});

describe('UI-07 edits tray', () => {
  it('count dot when > 0, none at 0', () => {
    const { rerender } = render(wrap(<EditsTray {...trayProps()} count={0} changes={[]} />));
    expect(document.querySelector('.gp-edits-dot')).toBeNull();
    expect(screen.getByRole('button', { name: /0 edits/ }).textContent).toBe('0 edits');
    rerender(wrap(<EditsTray {...trayProps()} count={1} changes={changes.slice(0, 1)} />));
    expect(document.querySelector('.gp-edits-dot')).not.toBeNull();
    expect(screen.getByRole('button', { name: /1 edit:/ }).textContent).toBe('1 edit');
    rerender(wrap(<EditsTray {...trayProps()} />));
    expect(screen.getByRole('button', { name: /2 edits/ }).textContent).toBe('2 edits');
  });

  it('lists who / what / from → to and wires undo, redo, save as scenario and discard', () => {
    const p = trayProps();
    const onOpenChange = vi.fn();
    render(wrap(<EditsTray {...p} canRedo onOpenChange={onOpenChange} />));
    fireEvent.click(screen.getByRole('button', { name: /2 edits/ }));
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
    const dlg = screen.getByRole('dialog', { name: 'Changeset' });

    const items = within(dlg).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]!.textContent).toBe('YouNet target · CY27$100.0M → $120.0M');
    expect(items[1]!.textContent).toBe('SolverCloud migration · wave 2Off → On');

    fireEvent.click(within(dlg).getByRole('button', { name: 'Undo' }));
    fireEvent.click(within(dlg).getByRole('button', { name: 'Redo' }));
    expect(p.onUndo).toHaveBeenCalledTimes(1);
    expect(p.onRedo).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('dialog')).toBeTruthy(); // undo / redo keep the tray open

    fireEvent.click(within(dlg).getByRole('button', { name: 'Save as scenario' }));
    expect(p.onSaveAsScenario).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /2 edits/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(p.onDiscard).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('undo and redo are disabled by canUndo / canRedo; empty tray says so', () => {
    const p = trayProps();
    render(
      wrap(<EditsTray {...p} canUndo={false} canRedo={false} count={0} changes={[]} defaultOpen />),
    );
    const dlg = screen.getByRole('dialog');
    expect((within(dlg).getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect((within(dlg).getByRole('button', { name: 'Redo' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(
      (within(dlg).getByRole('button', { name: 'Discard' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (within(dlg).getByRole('button', { name: 'Save as scenario' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(within(dlg).getByText(/No edits yet/)).toBeTruthy();
  });
});

describe('UI-07 edits tray: focus trap, Escape, axe', () => {
  it('traps Tab, Escape closes, focus returns to the counter', () => {
    render(wrap(<EditsTray {...trayProps()} canRedo />));
    const counter = screen.getByRole('button', { name: /2 edits/ });
    counter.focus();
    fireEvent.click(counter);
    const dlg = screen.getByRole('dialog');
    // the scrollable change list is a tab stop too (axe scrollable-region-focusable)
    const stops = [...dlg.querySelectorAll<HTMLElement>('button:not([disabled]), [tabindex="0"]')];
    expect(stops[0]).toHaveProperty('className', 'gp-tray-list');
    expect(document.activeElement).toBe(stops[0]);
    stops[stops.length - 1]!.focus();
    key('Tab');
    expect(document.activeElement).toBe(stops[0]);
    key('Tab', { shiftKey: true });
    expect(document.activeElement).toBe(stops[stops.length - 1]);

    key('Escape');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(counter);
  });

  it('a press outside closes the tray', () => {
    render(wrap(<EditsTray {...trayProps()} defaultOpen />));
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('has no accessibility violations (axe) closed, with the tray open, and empty', async () => {
    const { rerender } = render(wrap(<EditsTray {...trayProps()} />));
    const run = () => axe.run(document.body, { rules: { 'color-contrast': { enabled: false } } });
    expect((await run()).violations).toEqual([]);
    rerender(wrap(<EditsTray {...trayProps()} defaultOpen open />));
    expect((await run()).violations).toEqual([]);
    rerender(wrap(<EditsTray {...trayProps()} count={0} changes={[]} open />));
    expect((await run()).violations).toEqual([]);
  });
});

describe('UI-07 no formulas, no hard-coded values', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const sources = readdirSync(here).filter((f) => /\.tsx?$/.test(f) && !f.endsWith('.test.tsx'));

  it('sources use tokens only: no hex colours, no raw px', () => {
    expect(sources.length).toBeGreaterThan(0);
    for (const f of sources) {
      const src = readFileSync(join(here, f), 'utf8');
      expect(src, f).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\d(px)\b/);
    }
    expect(paletteCss).not.toMatch(/#[0-9a-fA-F]{3,8}\b/); // the 1px hairline is the glass.border token
  });

  it('sources do no arithmetic on values and format nothing (values arrive as props)', () => {
    for (const f of sources) {
      const src = readFileSync(join(here, f), 'utf8');
      expect(src, f).not.toMatch(/toFixed|toLocaleString|Intl\.|Math\.(round|floor|ceil|pow)/);
      expect(src, f).not.toMatch(/tier2-logic|tier3-data|api-contract/);
    }
  });

  it('every result and change text is rendered as given', () => {
    render(
      wrap(
        <EditsTray
          {...trayProps()}
          changes={[{ id: 'x', who: 'You', what: 'a', from: '  1,007.6 ', to: '<b>2</b>' }]}
          count={1}
          defaultOpen
        />,
      ),
    );
    const item = screen.getByRole('listitem');
    expect(item.querySelector('b')!.textContent).toBe('<b>2</b>');
    expect(item.textContent).toContain('  1,007.6 ');
  });
});
