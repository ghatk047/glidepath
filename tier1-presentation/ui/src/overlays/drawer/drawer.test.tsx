// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import axe from 'axe-core';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GlassProvider } from '../../glass';
import { cssVar, tokenValue } from '../../tokens';
import {
  DRAWER_WIDTH_PX,
  TIP_POINTER_OFFSET,
  Tooltip,
  TraceDrawer,
  hideTip,
  overlayCss,
  tipProps,
  type TraceContent,
} from './index';

afterEach(() => {
  cleanup();
  hideTip();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Body of the top-level rule for `selector` (the CSS is one rule per line). */
function rule(selector: string): string {
  for (const line of overlayCss.split('\n')) {
    const m = /^([^{}@]+)\{([^{}]*)\}$/.exec(line);
    if (m && m[1]!.trim() === selector) return m[2]!.trim();
  }
  return '';
}

const content: TraceContent = {
  title: 'IT net savings',
  value: '$119.3M',
  nodeId: 'res.net',
  formula: 'Σ lever in-year − one-time × (1 − share funded outside IT)',
  upstream: [
    { id: 'lev.L01', label: 'Rates', value: '$20.0M' },
    { id: 'pnl.o27', label: 'P&L opex saved', value: '$123.0M' },
    { id: 'res.net', label: 'IT net', value: '$119.3M' },
  ],
  drivers: [
    { id: 'L05', label: 'Vacancy harvest', value: '$31.0M' },
    { id: 'L02', label: 'Vendor COLA', value: '$22.4M' },
  ],
};

const wrap = (ui: React.ReactNode) => <GlassProvider frameSampling={false}>{ui}</GlassProvider>;

/** A trigger plus the drawer, as web wires them. */
function Harness({ initial = true }: { initial?: boolean }) {
  const [node, setNode] = useState<TraceContent | null>(initial ? content : null);
  return wrap(
    <>
      <button type="button" data-node="res.net" onClick={() => setNode(content)}>
        Open trace
      </button>
      <button type="button" id="elsewhere">
        Elsewhere
      </button>
      <TraceDrawer content={node} onClose={() => setNode(null)} />
    </>,
  );
}

describe('TraceDrawer', () => {
  it('renders a right-side 420 px glass drawer with value, node id, formula, upstream chain and top drivers', () => {
    render(wrap(<TraceDrawer content={content} onClose={() => {}} />));
    const dialog = screen.getByRole('dialog', { name: 'Trace · IT net savings' });
    // right side, 420 px (26.25 rem), glass level 3
    const body = rule('.gp-drawer');
    expect(body).toContain('position: fixed');
    expect(body).toMatch(/right: /);
    expect(body).toContain('width: min(26.25rem');
    expect(DRAWER_WIDTH_PX).toBe(420);
    expect(dialog.querySelector('.gp-panel')!.getAttribute('data-level')).toBe('3');
    // slots
    const slot = (n: string) => dialog.querySelector(`[data-slot="${n}"]`) as HTMLElement;
    expect(slot('value').textContent).toBe('$119.3M');
    expect(slot('node-id').textContent).toBe('res.net');
    expect(slot('formula').textContent).toContain('Σ lever in-year');
    const chain = within(slot('upstream')).getAllByRole('listitem');
    expect(chain.map((li) => li.getAttribute('data-node-id'))).toEqual([
      'lev.L01',
      'pnl.o27',
      'res.net',
    ]);
    expect(chain[2]!.getAttribute('aria-current')).toBe('step');
    expect(chain[0]!.getAttribute('aria-current')).toBeNull();
    expect(
      within(slot('drivers'))
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['Vacancy harvest$31.0M', 'Vendor COLA$22.4M']);
  });

  it('uses no raw hex and no raw px lengths', () => {
    expect(overlayCss).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    // the only px is the hairline width, which comes from the glass.border token
    const hairline = tokenValue['glass.border'].split(' ')[0]!;
    expect(overlayCss.split(hairline).join('')).not.toMatch(/\d(\.\d+)?px\b/);
  });

  it('closes on outside click', () => {
    render(<Harness />);
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.pointerDown(within(screen.getByRole('dialog')).getByText('Upstream'));
    expect(screen.getByRole('dialog')).toBeTruthy(); // inside: stays
    fireEvent.pointerDown(screen.getByText('Elsewhere'));
    expect(screen.getByRole('dialog', { hidden: true }).getAttribute('data-state')).toBe('closed');
  });

  it('a press on a [data-node] trigger is not an outside click', () => {
    render(<Harness />);
    fireEvent.pointerDown(screen.getByText('Open trace'));
    expect(screen.getByRole('dialog').getAttribute('data-state')).toBe('open');
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(wrap(<TraceDrawer content={content} onClose={onClose} />));
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes with the close button', () => {
    const onClose = vi.fn();
    render(wrap(<TraceDrawer content={content} onClose={onClose} />));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('traps focus: focus moves in, Tab and Shift+Tab wrap, and focus returns to the trigger', () => {
    function Trap() {
      const [node, setNode] = useState<TraceContent | null>(null);
      return wrap(
        <>
          <button type="button" id="trigger" onClick={() => setNode(content)}>
            Trigger
          </button>
          <TraceDrawer content={node} onClose={() => setNode(null)} ignoreOutside="" />
        </>,
      );
    }
    render(<Trap />);
    const trigger = screen.getByText('Trigger');
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog');
    const close = within(dialog).getByRole('button', { name: 'Close' });
    expect(document.activeElement).toBe(close); // focus moved in

    // the drawer has one tab stop (the close button): Tab and Shift+Tab stay on it
    const tab = (shiftKey = false) =>
      fireEvent.keyDown(document.activeElement!, { key: 'Tab', shiftKey });
    const ev = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    act(() => {
      document.activeElement!.dispatchEvent(ev);
    });
    expect(ev.defaultPrevented).toBe(true); // wrapped instead of leaving
    tab(true);
    expect(dialog.contains(document.activeElement)).toBe(true);

    // focus outside the drawer is pulled back in on Tab
    trigger.focus();
    expect(dialog.contains(document.activeElement)).toBe(false);
    const ev2 = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    act(() => {
      trigger.dispatchEvent(ev2);
    });
    expect(ev2.defaultPrevented).toBe(true);
    expect(dialog.contains(document.activeElement)).toBe(true);

    // with several tab stops the ends wrap
    // (the drawer content is not interactive, so add one inside to check the wrap)
    const extra = document.createElement('button');
    extra.textContent = 'Extra';
    dialog.querySelector('.gp-drawer-panel')!.appendChild(extra);
    extra.focus();
    const ev3 = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    act(() => {
      extra.dispatchEvent(ev3);
    });
    expect(document.activeElement).toBe(close);
    const ev4 = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      close.dispatchEvent(ev4);
    });
    expect(document.activeElement).toBe(extra);

    // closing returns focus to the trigger
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(document.activeElement).toBe(trigger);
  });

  it('slides out on close and then unmounts so a closed drawer holds no glass surface', () => {
    vi.useFakeTimers();
    const { rerender } = render(wrap(<TraceDrawer content={content} onClose={() => {}} />));
    expect(screen.getByRole('dialog').getAttribute('data-state')).toBe('open');
    rerender(wrap(<TraceDrawer content={null} onClose={() => {}} />));
    const leaving = screen.getByRole('dialog', { hidden: true });
    expect(leaving.getAttribute('data-state')).toBe('closed');
    expect(leaving.hasAttribute('inert')).toBe(true);
    expect(leaving.querySelector('[data-slot="value"]')!.textContent).toBe('$119.3M'); // last content stays during the slide
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.queryByRole('dialog', { hidden: true })).toBeNull();
  });

  it('has no axe violations', async () => {
    const { container } = render(wrap(<TraceDrawer content={content} onClose={() => {}} />));
    const res = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(res.violations.map((v) => v.id)).toEqual([]);
  });
});

const chart = (name: string, tip: string) => (
  <svg aria-label={name}>
    <rect data-testid={`${name}-mark`} {...tipProps<SVGRectElement>(tip)} />
  </svg>
);

describe('Tooltip', () => {
  it('is glass level 3 at 12 px and follows the pointer', () => {
    render(
      wrap(
        <>
          <Tooltip />
          {chart('waterfall', 'Savings')}
        </>,
      ),
    );
    const tip = screen.getByRole('tooltip');
    expect(tip.querySelector('.gp-panel')).toBeNull(); // nothing while idle
    const mark = screen.getByTestId('waterfall-mark');
    fireEvent.pointerEnter(mark, { clientX: 100, clientY: 200 });
    const panel = tip.querySelector('.gp-panel') as HTMLElement;
    expect(panel.getAttribute('data-level')).toBe('3');
    expect(panel.textContent).toBe('Savings');
    // 12 px: 12/13 of the 13 px small step
    expect(rule('.gp-panel.gp-tip-body')).toContain(
      `font-size: calc(${cssVar['type.scale.s.size']} * 12 / 13)`,
    );
    expect(parseFloat(tokenValue['type.scale.s.size']) * (12 / 13)).toBeCloseTo(12, 9);
    expect(tip.style.left).toBe(`${100 + TIP_POINTER_OFFSET}px`);
    expect(tip.style.top).toBe(`${200 + TIP_POINTER_OFFSET}px`);
    fireEvent.pointerMove(mark, { clientX: 140, clientY: 230 });
    expect(tip.style.left).toBe(`${140 + TIP_POINTER_OFFSET}px`);
    expect(tip.style.top).toBe(`${230 + TIP_POINTER_OFFSET}px`);
    expect(rule('.gp-tip')).toContain('pointer-events: none');
    fireEvent.pointerLeave(mark);
    expect(tip.querySelector('.gp-panel')).toBeNull();
  });

  it('is one shared instance used by every chart', () => {
    render(
      wrap(
        <>
          <Tooltip />
          <Tooltip />
          {chart('waterfall', 'Savings')}
          {chart('histogram', 'P50 75')}
        </>,
      ),
    );
    expect(screen.getAllByRole('tooltip')).toHaveLength(1);
    const shared = screen.getByRole('tooltip');
    fireEvent.pointerEnter(screen.getByTestId('waterfall-mark'), { clientX: 10, clientY: 10 });
    expect(shared.textContent).toBe('Savings');
    fireEvent.pointerLeave(screen.getByTestId('waterfall-mark'));
    fireEvent.pointerEnter(screen.getByTestId('histogram-mark'), { clientX: 20, clientY: 20 });
    expect(screen.getAllByRole('tooltip')).toHaveLength(1);
    expect(screen.getByRole('tooltip')).toBe(shared); // same element, new content
    expect(shared.textContent).toBe('P50 75');
  });

  it('shows plain-text data-tip elements and hides on leave', () => {
    render(
      wrap(
        <>
          <Tooltip />
          <span data-testid="plain" data-tip="Normalized CY26 IT outlay">
            x
          </span>
        </>,
      ),
    );
    fireEvent.pointerMove(screen.getByTestId('plain'), { clientX: 5, clientY: 6 });
    expect(screen.getByRole('tooltip').textContent).toBe('Normalized CY26 IT outlay');
    fireEvent.pointerOut(screen.getByTestId('plain'));
    expect(screen.getByRole('tooltip').textContent).toBe('');
  });

  it('shows on keyboard focus of a mark and hides on blur', () => {
    render(
      wrap(
        <>
          <Tooltip />
          <button type="button" {...tipProps<HTMLButtonElement>('Focused mark')}>
            mark
          </button>
        </>,
      ),
    );
    const b = screen.getByText('mark');
    act(() => b.focus());
    expect(screen.getByRole('tooltip').textContent).toBe('Focused mark');
    act(() => b.blur());
    expect(screen.getByRole('tooltip').textContent).toBe('');
  });
});
