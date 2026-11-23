// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Tooltip } from '../overlays/drawer';
import {
  DiffRow,
  DiffTable,
  MoveRow,
  TraceChain,
  TraceNode,
  rowsCss,
  type DiffRowProps,
} from './index';

afterEach(cleanup);

const rules = () =>
  [...rowsCss.matchAll(/([^{}@]+)\{([^{}]*)\}/g)].map((m) => ({
    selector: m[1]!.trim(),
    body: m[2]!.trim(),
  }));
const rule = (s: string) => rules().find((r) => r.selector === s)?.body ?? '';

const NODES = [
  { nodeId: 'res.net', label: 'Net savings', value: '$119.3M', note: 'CY27' },
  { nodeId: 'corp.ebit', label: 'EBIT lift', value: '$80.0M', note: 'after tax' },
  { nodeId: 'corp.eps', label: 'EPS', value: '+$0.091', note: '665m shares' },
];

describe('UI-16 TraceNode', () => {
  it('chain with arrows; selected = accent ring + glow; onOpen', () => {
    const onOpen = vi.fn();
    render(<TraceChain nodes={NODES} selectedId="corp.ebit" onOpen={onOpen} />);
    const list = screen.getByRole('list', { name: 'Trace chain' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    // one arrow between each pair, hidden from assistive tech
    const arrows = screen.getAllByTestId('trace-arrow');
    expect(arrows).toHaveLength(2);
    expect(arrows.every((a) => a.getAttribute('aria-hidden') === 'true')).toBe(true);

    const buttons = screen.getAllByRole('button');
    expect(buttons.map((b) => b.getAttribute('data-node'))).toEqual(['res.net', 'corp.ebit', 'corp.eps']);
    expect(buttons[1]!.hasAttribute('data-selected')).toBe(true);
    expect(buttons[1]!.getAttribute('aria-current')).toBe('true');
    expect(buttons[0]!.hasAttribute('data-selected')).toBe(false);
    // the selected style is the accent ring plus the glow, from tokens
    const sel = rule('.gp-tnode[data-selected]');
    expect(sel).toMatch(/0 0 0 [^,]+ var\(--accent\)/);
    expect(sel).toMatch(/var\(--accent-glow\)/);

    fireEvent.click(buttons[2]!);
    expect(onOpen).toHaveBeenCalledWith('corp.eps');
    // value and note are read with the label
    expect(buttons[2]!.textContent).toBe('EPS+$0.091665m shares');
  });

  it('keyboard: Enter on a focused node opens it (native button) and the node id shows in the shared tooltip', () => {
    const onOpen = vi.fn();
    render(
      <>
        <Tooltip />
        <TraceNode {...NODES[0]!} onOpen={onOpen} />
      </>,
    );
    const b = screen.getByRole('button');
    act(() => b.focus());
    expect(screen.getByRole('tooltip').textContent).toBe('res.net');
    fireEvent.click(b);
    expect(onOpen).toHaveBeenCalledWith('res.net');
  });
});

describe('UI-16 MoveRow', () => {
  const props = {
    variableId: 'lev.L17.pct',
    label: 'Vendor COLA refused',
    from: 0.7,
    to: 1,
    min: 0,
    max: 1,
    unit: '%',
    step: 0.01,
    rank: 1,
  };

  it('track with C tick, accent span, thumb at the new value, from -> to', () => {
    render(<MoveRow {...props} />);
    const row = screen.getByRole('group', { name: 'Vendor COLA refused: 70% to 100%' });
    expect(row.getAttribute('data-variable-id')).toBe('lev.L17.pct');
    expect(within(row).getByText('01')).toBeTruthy();
    expect(screen.getByTestId('move-tick').style.left).toBe('70%');
    const span = screen.getByTestId('move-span');
    expect(span.style.left).toBe('70%');
    expect(span.style.width).toBe('30%');
    expect(screen.getByTestId('move-thumb').style.left).toBe('100%');
    expect(row.querySelector('.gp-move-text')!.textContent).toBe('70% → 100%');
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe('C 70%, new value 100%');
  });

  it('a move down draws the span from the thumb to the tick; positions stay on the track', () => {
    render(<MoveRow {...props} from={0.5} to={0.25} min={0} max={0.5} rank={12} />);
    const span = screen.getByTestId('move-span');
    expect(span.style.left).toBe('50%');
    expect(span.style.width).toBe('50%');
    expect(screen.getByTestId('move-tick').style.left).toBe('100%');
    expect(screen.getByText('12')).toBeTruthy();
    // a value outside the track is pinned to its end, never drawn off it
    cleanup();
    render(<MoveRow {...props} to={2} />);
    expect(screen.getByTestId('move-thumb').style.left).toBe('100%');
  });
});

describe('UI-16 DiffRow', () => {
  const base: DiffRowProps = {
    sheet: 'Levers',
    item: 'L08 · Headline rate cut',
    exported: '5%',
    file: '7%',
    appNow: '5%',
    status: 'ok',
  };
  const table = (...rows: DiffRowProps[]) =>
    render(
      <DiffTable>
        {rows.map((r) => (
          <DiffRow key={r.item} {...r} />
        ))}
      </DiffTable>,
    );

  it('accept toggle for a changed row reports the take', () => {
    const onAccept = vi.fn();
    table({ ...base, onAccept });
    const sw = screen.getByRole('switch', { name: 'Accept L08 · Headline rate cut' }) as HTMLInputElement;
    expect(sw.checked).toBe(true);
    fireEvent.click(sw);
    expect(onAccept).toHaveBeenCalledWith(false);
    expect(screen.queryByText('new line')).toBeNull();
  });

  it('conflict shows a File / App choice instead of the toggle', () => {
    const onChoice = vi.fn();
    table({
      ...base,
      sheet: 'Targets',
      item: 'One-time funded outside IT',
      exported: '50%',
      file: '60%',
      appNow: '40%',
      status: 'conflict',
      onChoice,
    });
    expect(screen.queryByRole('switch')).toBeNull();
    const group = screen.getByRole('group', { name: 'Take for One-time funded outside IT' });
    const file = within(group).getByRole('button', { name: 'File' });
    const app = within(group).getByRole('button', { name: 'App' });
    expect(file.getAttribute('aria-pressed')).toBe('true');
    expect(app.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(app);
    expect(onChoice).toHaveBeenCalledWith('app');
    // not colour alone: the app value is named a conflict for assistive tech
    expect(screen.getByText('conflict:')).toBeTruthy();
    expect(rule('.gp-diff tr[data-status="conflict"] td[data-col="appNow"]')).toMatch(/var\(--warn\)/);
  });

  it("new line chip next to the toggle; removal style (struck item, 'removed' chip, own toggle name)", () => {
    table(
      { ...base, item: 'New · Observability tooling', exported: '—', file: '$1.20M', appNow: '—', status: 'new' },
      { ...base, item: 'Legacy mainframe', file: '—', status: 'removed' },
    );
    const rows = screen.getAllByRole('row').slice(1);
    expect(within(rows[0]!).getByText('new line')).toBeTruthy();
    expect(within(rows[0]!).getByRole('switch')).toBeTruthy();

    const removed = rows[1]!;
    expect(removed.getAttribute('data-status')).toBe('removed');
    expect(removed.querySelector('del')!.textContent).toBe('Legacy mainframe');
    expect(within(removed).getByText('removed')).toBeTruthy();
    expect(within(removed).getByRole('switch', { name: 'Accept removal of Legacy mainframe' })).toBeTruthy();
    expect(rule('.gp-diff tr[data-status="removed"] td[data-col="item"] del')).toMatch(/text-decoration-thickness/);
  });

  it('values arrive as props: the row renders exactly what it is given, no calculation', () => {
    table({ ...base, exported: 'A', file: 'B', appNow: 'C' });
    const cells = screen.getAllByRole('row')[1]!.querySelectorAll('td');
    expect([...cells].map((c) => c.textContent)).toEqual(['Levers', 'L08 · Headline rate cut', 'A', 'B', 'C', '']);
  });
});

describe('UI-16 rows CSS and accessibility', () => {
  it('has no hex colours or raw pixel sizes in the CSS (tokens only)', () => {
    expect(rowsCss).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(rowsCss.replace(/\b1px\b/g, '')).not.toMatch(/\d\s?px\b/);
  });

  it('chain, move row and diff table have no axe violations', async () => {
    const { container } = render(
      <main>
        <TraceChain nodes={NODES} selectedId="res.net" />
        <MoveRow variableId="lev.L17.pct" label="Vendor COLA refused" from={0.7} to={1} min={0} max={1} unit="%" step={0.01} rank={1} />
        <DiffTable>
          <DiffRow sheet="Levers" item="L08" exported="5%" file="7%" appNow="5%" status="ok" />
          <DiffRow sheet="Targets" item="One-time" exported="50%" file="60%" appNow="40%" status="conflict" />
          <DiffRow sheet="Line_Items" item="New line item" exported="—" file="$1.20M" appNow="—" status="new" />
          <DiffRow sheet="Pools" item="Old pool" exported="1" file="—" appNow="1" status="removed" />
        </DiffTable>
      </main>,
    );
    const result = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(result.violations.map((v) => v.id)).toEqual([]);
  });
});
