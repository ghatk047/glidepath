// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import axe from 'axe-core';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { vpColour } from '../../charts/gauge';
import { Tooltip } from '../../overlays/drawer';
import {
  OwnershipBar,
  ownershipCss,
  segmentUnits,
  type OwnershipBarProps,
  type OwnershipShare,
} from './index';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** A row as tier 2 sends it (fixture values; 4 VPs, 30 / 40 / 20 / 10). */
const row = (...s: number[]): OwnershipShare[] =>
  ['vp_commercial', 'vp_operations', 'vp_corporate', 'vp_infra'].map((vp, i) => ({
    vp,
    label: ['Commercial', 'Operations', 'Corporate', 'Infra & Other'][i]!,
    share: s[i]!,
  }));
const base: OwnershipBarProps = { domainId: 'data_analytics', shares: row(0.3, 0.4, 0.2, 0.1) };

const WIDTH = 400;
const renderBar = (props: Partial<OwnershipBarProps> = {}) => {
  const onPreview = vi.fn();
  const onCommit = vi.fn();
  const utils = render(
    <OwnershipBar {...base} onPreview={onPreview} onCommit={onCommit} {...props} />,
  );
  const bar = utils.container.querySelector('.gp-own-bar') as HTMLElement;
  // jsdom has no layout: give the bar a 400 px box at x = 100 (1 step = 20 px).
  bar.getBoundingClientRect = () =>
    ({ left: 100, right: 100 + WIDTH, width: WIDTH, top: 0, bottom: 26, height: 26 }) as DOMRect;
  const handles = () => screen.getAllByRole('slider');
  const segs = () => [...bar.querySelectorAll<HTMLElement>('.gp-own-seg')];
  return { ...utils, bar, handles, segs, onPreview, onCommit };
};

/** Pointer events carry clientX; jsdom's PointerEvent may not, so build them as MouseEvents. */
const ptr = (el: Element, type: string, clientX = 0) =>
  fireEvent(el, new MouseEvent(type, { bubbles: true, cancelable: true, clientX, button: 0 }));
const xAt = (units: number) => 100 + units * (WIDTH / 20);
const drag = (el: Element, units: number) => ptr(el, 'pointermove', xAt(units));
const labels = (segs: HTMLElement[]) => segs.map((s) => s.textContent);
const shareOf = (call: unknown[]) => (call[1] as OwnershipShare[]).map((s) => s.share);
const now = (h: HTMLElement) => Number(h.getAttribute('aria-valuenow'));

describe('UI-11 drag in 5% steps; segments partition the row (always 100%); labels from 12%', () => {
  it('draws one segment per VP, in VP colour order, partitioning the row at 100%', () => {
    const { segs } = renderBar();
    const widths = segs().map((s) => parseFloat(s.style.width));
    expect(widths).toEqual([30, 40, 20, 10]);
    expect(widths.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 9);
    expect(segs().map((s) => s.dataset.vp)).toEqual([
      'vp_commercial',
      'vp_operations',
      'vp_corporate',
      'vp_infra',
    ]);
    expect(segs().map((s) => s.style.background)).toEqual([0, 1, 2, 3].map(vpColour));
  });

  it('labels segments of 12% or more and leaves smaller ones blank', () => {
    const { segs } = renderBar({ shares: row(0.5, 0.35, 0.1, 0.05) });
    expect(labels(segs())).toEqual(['50%', '35%', '', '']);
    const edge = renderBar({ shares: row(0.12, 0.28, 0.3, 0.3), step: 0.01 });
    expect(labels(edge.segs())).toEqual(['12%', '28%', '30%', '30%']);
    const below = renderBar({ shares: row(0.11, 0.29, 0.3, 0.3), step: 0.01 });
    expect(labels(below.segs())).toEqual(['', '29%', '30%', '30%']);
  });

  it('dragging a divider snaps to 5% steps, moves one boundary, and the row stays at 100%', () => {
    const { handles, segs, onPreview } = renderBar();
    const h = handles()[0]!; // boundary between Commercial and Operations, at 30%
    ptr(h, 'pointerdown', xAt(6));
    drag(h, 7); // 35%
    expect(labels(segs())).toEqual(['35%', '35%', '20%', '']);
    drag(h, 8.4); // snaps to 40%
    expect(labels(segs())).toEqual(['40%', '30%', '20%', '']);
    for (const call of onPreview.mock.calls) {
      const s = shareOf(call);
      expect(s.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
      for (const x of s) expect(Math.round(x * 20)).toBeCloseTo(x * 20, 9); // multiple of 5%
    }
    // Only the dragged boundary moved: the divider after Operations is still at 70%.
    expect(handles().map(now)).toEqual([40, 70, 90]);
  });

  it('dividers cannot cross their neighbours or leave the row', () => {
    const { handles, segs } = renderBar();
    const h = handles()[1]!; // at 70%, between 30% and 90%
    ptr(h, 'pointerdown', xAt(14));
    drag(h, 2); // far left: stops at the divider before it (30%)
    expect(segs().map((s) => s.style.width)).toEqual(['30%', '0%', '60%', '10%']);
    expect(labels(segs())).toEqual(['30%', '', '60%', '']);
    drag(h, 20); // far right: stops at the next divider (90%)
    expect(labels(segs())).toEqual(['30%', '60%', '', '']);
    drag(h, -3); // pointer outside the bar
    expect(handles().map(now)).toEqual([30, 30, 90]);
  });

  it('partitions any input row: shares off the grid or not totalling 1 still draw a full row', () => {
    const { segs } = renderBar({ shares: row(0.33, 0.33, 0.33, 0.01) });
    const widths = segs().map((s) => parseFloat(s.style.width));
    expect(widths.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 9);
    expect(segmentUnits([7, 14, 19], 20)).toEqual([7, 7, 5, 1]);
    const over = renderBar({ shares: row(0.7, 0.7, 0.1, 0.1) });
    expect(over.segs().reduce((a, s) => a + parseFloat(s.style.width), 0)).toBeCloseTo(100, 9);
  });

  it('the step comes from the variable definition when given', () => {
    const { handles, segs } = renderBar({ step: 0.1, shares: row(0.2, 0.3, 0.3, 0.2) });
    ptr(handles()[0]!, 'pointerdown');
    fireEvent.keyDown(handles()[0]!, { key: 'ArrowRight' });
    expect(labels(segs())).toEqual(['30%', '20%', '30%', '20%']);
  });
});

describe('UI-11 keyboard: focus a divider, arrows move 5%; dividers expose role=slider', () => {
  it('every divider is a focusable role=slider with a name and a value', () => {
    const { handles } = renderBar();
    expect(handles()).toHaveLength(3);
    const h = handles()[0]!;
    expect(h.tabIndex).toBe(0);
    expect(h.getAttribute('aria-label')).toBe('Commercial and Operations divider, data_analytics');
    expect(h.getAttribute('aria-valuenow')).toBe('30');
    expect(h.getAttribute('aria-valuemin')).toBe('0');
    expect(h.getAttribute('aria-valuemax')).toBe('70');
    expect(h.getAttribute('aria-valuetext')).toBe('Commercial 30%, Operations 40%');
    expect(handles()[2]!.getAttribute('aria-valuemax')).toBe('100');
    expect(screen.getByRole('group', { name: 'data_analytics ownership' })).toBeTruthy();
  });

  it('ArrowRight / ArrowUp move the divider +5%, ArrowLeft / ArrowDown -5%', () => {
    const { handles, segs } = renderBar();
    const h = handles()[0]!;
    h.focus();
    expect(document.activeElement).toBe(h);
    fireEvent.keyDown(h, { key: 'ArrowRight' });
    expect(labels(segs())).toEqual(['35%', '35%', '20%', '']);
    expect(now(h)).toBe(35);
    expect(h.getAttribute('aria-valuetext')).toBe('Commercial 35%, Operations 35%');
    fireEvent.keyDown(h, { key: 'ArrowUp' });
    expect(now(h)).toBe(40);
    fireEvent.keyDown(h, { key: 'ArrowLeft' });
    fireEvent.keyDown(h, { key: 'ArrowDown' });
    expect(now(h)).toBe(30);
    expect(labels(segs())).toEqual(['30%', '40%', '20%', '']);
  });

  it('Home / End go to the neighbours; the divider never crosses them', () => {
    const { handles } = renderBar();
    const h = handles()[1]!;
    fireEvent.keyDown(h, { key: 'End' });
    expect(now(h)).toBe(90);
    fireEvent.keyDown(h, { key: 'ArrowRight' });
    expect(now(h)).toBe(90);
    fireEvent.keyDown(h, { key: 'Home' });
    expect(now(h)).toBe(30);
    fireEvent.keyDown(h, { key: 'ArrowLeft' });
    expect(now(h)).toBe(30);
  });

  it('other keys are left alone', () => {
    const { handles, onCommit } = renderBar();
    const h = handles()[0]!;
    expect(fireEvent.keyDown(h, { key: 'a' })).toBe(true);
    fireEvent.keyUp(h, { key: 'a' });
    expect(now(h)).toBe(30);
    expect(onCommit).not.toHaveBeenCalled();
  });
});

describe('UI-11 previews during drag, commit on release; validation messages come from tier 2', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('previews while dragging (at most one per 33 ms) and commits once on release', () => {
    const { handles, onPreview, onCommit } = renderBar();
    const h = handles()[0]!;
    ptr(h, 'pointerdown', xAt(6));
    drag(h, 7); // leading edge: previewed at once
    expect(onPreview).toHaveBeenCalledTimes(1);
    drag(h, 8);
    drag(h, 9);
    expect(onPreview).toHaveBeenCalledTimes(1);
    act(() => void vi.advanceTimersByTime(34));
    expect(onPreview).toHaveBeenCalledTimes(2); // latest value wins
    expect(onPreview).toHaveBeenLastCalledWith('data_analytics', expect.any(Array));
    expect(shareOf(onPreview.mock.lastCall!)).toEqual([0.45, 0.25, 0.2, 0.1]);
    expect(onCommit).not.toHaveBeenCalled();
    ptr(h, 'pointerup', xAt(9));
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit.mock.calls[0]![0]).toBe('data_analytics');
    expect(shareOf(onCommit.mock.calls[0]!)).toEqual([0.45, 0.25, 0.2, 0.1]);
    act(() => void vi.advanceTimersByTime(200));
    expect(onPreview).toHaveBeenCalledTimes(2); // a commit drops any pending preview
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('commit and preview carry the VP ids and labels untouched, with the new shares', () => {
    const { handles, onCommit } = renderBar();
    const h = handles()[2]!;
    ptr(h, 'pointerdown', xAt(18));
    drag(h, 19);
    ptr(h, 'pointerup');
    const committed = onCommit.mock.calls[0]![1] as OwnershipShare[];
    expect(committed.map((s) => s.vp)).toEqual([
      'vp_commercial',
      'vp_operations',
      'vp_corporate',
      'vp_infra',
    ]);
    expect(committed.map((s) => s.label)).toEqual([
      'Commercial',
      'Operations',
      'Corporate',
      'Infra & Other',
    ]);
    expect(committed.map((s) => s.share)).toEqual([0.3, 0.4, 0.25, 0.05]);
  });

  it('a press and release without movement commits nothing', () => {
    const { handles, onPreview, onCommit } = renderBar();
    const h = handles()[0]!;
    ptr(h, 'pointerdown', xAt(6));
    ptr(h, 'pointerup', xAt(6));
    expect(onPreview).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('a cancelled gesture still commits what is shown; later moves do nothing until a new press', () => {
    const { handles, onCommit } = renderBar();
    const h = handles()[0]!;
    ptr(h, 'pointerdown', xAt(6));
    drag(h, 7);
    ptr(h, 'pointercancel');
    expect(onCommit).toHaveBeenCalledTimes(1);
    drag(h, 10);
    expect(now(h)).toBe(35);
  });

  it('keyboard: previews on each press, one commit on key release; blur commits too', () => {
    const { handles, onPreview, onCommit } = renderBar();
    const h = handles()[0]!;
    fireEvent.keyDown(h, { key: 'ArrowRight' });
    fireEvent.keyDown(h, { key: 'ArrowRight', repeat: true });
    expect(onPreview).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.keyUp(h, { key: 'ArrowRight' });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(shareOf(onCommit.mock.calls[0]!)).toEqual([0.4, 0.3, 0.2, 0.1]);
    fireEvent.keyDown(h, { key: 'ArrowLeft' });
    fireEvent.keyUp(h, { key: 'Enter' }); // not a movement key: no commit on keyup
    fireEvent.keyDown(h, { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(h, { key: 'ArrowLeft' });
    fireEvent.blur(h);
    expect(onCommit).toHaveBeenCalledTimes(3);
    fireEvent.blur(h);
    expect(onCommit).toHaveBeenCalledTimes(3);
  });

  it('shows the validation messages tier 2 sends, verbatim, and ties them to the dividers', () => {
    const message = 'Data analytics: VP shares total 95%. Move 5% to a VP to reach 100%.';
    const { handles, container } = renderBar({
      violations: [
        { severity: 'error', message },
        { severity: 'warning', message: 'Memo domain carries no cost.' },
      ],
    });
    const alert = screen.getByRole('alert');
    expect([...alert.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
      message,
      'Memo domain carries no cost.',
    ]);
    expect(alert.querySelector('li')!.getAttribute('data-severity')).toBe('error');
    for (const h of handles()) expect(h.getAttribute('aria-describedby')).toBe(alert.id);
    expect(container.textContent).toContain(message);
  });

  it('warnings alone are a status, and no violations means no message area', () => {
    const w = renderBar({ violations: [{ severity: 'warning', message: 'Check this row.' }] });
    expect(screen.getByRole('status').textContent).toBe('Check this row.');
    w.unmount();
    const none = renderBar();
    expect(none.container.querySelector('.gp-own-msgs')).toBeNull();
    expect(none.handles()[0]!.hasAttribute('aria-describedby')).toBe(false);
  });

  it('follows new shares from tier 2 when no gesture is open, and keeps its own while one is', () => {
    const { rerender, handles, segs } = renderBar();
    rerender(<OwnershipBar {...base} shares={row(0.5, 0.2, 0.2, 0.1)} />);
    expect(labels(segs())).toEqual(['50%', '20%', '20%', '']);
    const h = handles()[0]!;
    fireEvent.keyDown(h, { key: 'ArrowRight' }); // uncommitted change
    rerender(<OwnershipBar {...base} shares={row(0.1, 0.6, 0.2, 0.1)} />);
    expect(labels(segs())).toEqual(['55%', '15%', '20%', '']);
  });
});

describe('UI-11 shared Tooltip (UI-18) and VP colours (UI-12)', () => {
  it('each segment carries a data-tip the shared Tooltip shows: VP name and share', () => {
    const { segs } = renderBar();
    expect(segs().map((s) => s.getAttribute('data-tip'))).toEqual([
      'Commercial · 30%',
      'Operations · 40%',
      'Corporate · 20%',
      'Infra & Other · 10%',
    ]);
    render(<Tooltip />);
    fireEvent.pointerMove(segs()[1]!, { clientX: 10, clientY: 10 });
    expect(screen.getByRole('tooltip').textContent).toBe('Operations · 40%');
  });
});

describe('UI-11 tokens only; no formulas or business rules: values arrive as props', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const sources = readdirSync(here).filter(
    (f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f),
  );

  it('no hex colours and no raw px in the ownership CSS', () => {
    expect(ownershipCss).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(ownershipCss).not.toMatch(/\d(\.\d+)?px/);
  });

  it('imports only React and ui presentation modules; no tier 2 or 3', () => {
    const allowed =
      /^(react|react\/jsx-runtime|\.\/[\w-]+|\.\.\/slider|\.\.\/\.\.\/(tokens|format|motion|charts\/gauge))$/;
    for (const f of sources) {
      const src = readFileSync(join(here, f), 'utf8');
      for (const m of src.matchAll(/from '([^']+)'/g))
        expect(m[1], `${f}: ${m[1]}`).toMatch(allowed);
      expect(src, f).not.toMatch(/tier2-logic|tier3-data|@glidepath\/(engine|domain|solvers|spec)/);
    }
  });

  it('never decides validity: rendering an invalid row shows it as sent, with no message of its own', () => {
    const { container } = renderBar({ shares: row(0.5, 0.5, 0.5, 0.5) });
    expect(container.querySelector('.gp-own-msgs')).toBeNull();
  });
});

describe('UI-11 G12 accessibility (axe-core)', () => {
  it('the bar with dividers and tier 2 messages has no serious or critical violations', async () => {
    const { container } = renderBar({
      violations: [{ severity: 'error', message: 'Row totals 95%.' }],
    });
    const result = await axe.run(container, {
      rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
    });
    const bad = result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.html).join(' | ')}`)).toEqual([]);
  });
});
