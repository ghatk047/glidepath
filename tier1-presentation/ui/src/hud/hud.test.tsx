// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GlassProvider } from '../glass';
import { springs } from '../motion';
import { tokenValue } from '../tokens';
import {
  BAR_TICK_PCT,
  FlightStrip,
  StatusChip,
  TRACK_SCALE,
  Toast,
  hudCss,
  toastHoldMs,
  trackFillPct,
} from './index';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** CSS rules of hudCss as [media, selector, body]. */
function rules(): { media: string | null; selector: string; body: string }[] {
  const out: { media: string | null; selector: string; body: string }[] = [];
  const re = /@media ([^{]+)\{([\s\S]*?)\n\}|([^{}@]+)\{([^{}]*)\}/g;
  for (const m of hudCss.matchAll(re)) {
    if (m[1]) {
      for (const r of m[2]!.matchAll(/([^{}]+)\{([^{}]*)\}/g))
        out.push({ media: m[1].trim(), selector: r[1]!.trim(), body: r[2]!.trim() });
    } else out.push({ media: null, selector: m[3]!.trim(), body: m[4]!.trim() });
  }
  return out;
}
const rule = (selector: string, media: string | null = null) =>
  rules().find((r) => r.selector === selector && r.media === media)?.body ?? '';

const reducedMotion = (on: boolean) =>
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: q.includes('prefers-reduced-motion') ? on : false,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));

const strip = (over: Partial<Parameters<typeof FlightStrip>[0]> = {}) => (
  <GlassProvider frameSampling={false}>
    <FlightStrip net={143.0} bar={100} gap={43.0} risk={97.5} eps27={0.091} {...over} />
  </GlassProvider>
);
const cell = (name: string) => document.querySelector(`[data-cell="${name}"]`);

describe('FlightStrip (#3)', () => {
  it('shows net, bar, gap chip, risk-adjusted and EPS 27 from props', () => {
    render(strip({ net: 1007.6, bar: 983.9, gap: 23.7, risk: 940.2, eps27: 0.091 }));
    const region = screen.getByRole('complementary', { name: 'Flight strip' });
    expect(cell('net')!.textContent).toContain('$1,007.6M');
    expect(cell('bar')!.textContent).toBe('Bar$983.9M');
    expect(cell('gap')!.textContent).toContain('▲ $23.7M clear');
    expect(cell('risk')!.textContent).toBe('Risk-adj.$940.2M');
    expect(cell('eps27')!.textContent).toBe('EPS 27$0.091');
    expect(region.querySelectorAll('dt')).toHaveLength(5);
  });

  it('draws a progress track to 120% of the bar with a tick at the bar', () => {
    expect(TRACK_SCALE).toBe(1.2);
    expect(trackFillPct(60, 100)).toBeCloseTo(50, 9);
    expect(trackFillPct(120, 100)).toBeCloseTo(100, 9);
    expect(trackFillPct(300, 100)).toBe(100);
    expect(trackFillPct(-5, 100)).toBe(0);
    expect(trackFillPct(50, 0)).toBe(0);
    expect(trackFillPct(null, 100)).toBe(0);
    render(strip({ net: 60, bar: 100 }));
    const track = screen.getByTestId('hud-track');
    expect(track.querySelector('i')!.style.width).toBe(`${trackFillPct(60, 100)}%`);
    expect(parseFloat(track.querySelector('b')!.style.left)).toBeCloseTo(BAR_TICK_PCT, 3);
    expect(BAR_TICK_PCT).toBeCloseTo(100 / 1.2, 9);
    expect(track.getAttribute('aria-hidden')).toBe('true');
  });

  it('is hidden by the hidden prop (Cockpit) and visible without it', () => {
    const { rerender } = render(strip({ hidden: true }));
    const el = document.querySelector('.gp-hud') as HTMLElement;
    expect(el.hidden).toBe(true);
    expect(screen.queryByRole('complementary', { name: 'Flight strip' })).toBeNull();
    expect(rule('.gp-panel.gp-hud[hidden]')).toContain('display: none');
    rerender(strip({ hidden: false }));
    expect(el.hidden).toBe(false);
    expect(screen.getByRole('complementary', { name: 'Flight strip' })).toBeTruthy();
  });

  it('phone variant shows net, bar and gap only', () => {
    render(strip({ variant: 'phone' }));
    expect(cell('net')).toBeTruthy();
    expect(cell('bar')).toBeTruthy();
    expect(cell('gap')).toBeTruthy();
    expect(cell('risk')).toBeNull();
    expect(cell('eps27')).toBeNull();
    expect(screen.queryByTestId('hud-track')).toBeNull();
  });

  it('below the phone breakpoint the full strip hides track, risk and EPS in CSS', () => {
    render(strip());
    expect(cell('risk')!.getAttribute('data-phone')).toBe('hide');
    expect(cell('eps27')!.getAttribute('data-phone')).toBe('hide');
    expect(cell('net')!.getAttribute('data-phone')).toBeNull();
    const phone = `(max-width: ${tokenValue['breakpoints.phone']})`;
    const body = rule('.gp-hud-prog, .gp-hud-cell[data-phone="hide"]', phone);
    expect(body).toContain('display: none');
  });

  it('shows an em dash for a missing value and rolls to a new one', () => {
    reducedMotion(true);
    const { rerender } = render(strip({ risk: null }));
    expect(cell('risk')!.textContent).toBe('Risk-adj.—');
    rerender(strip({ risk: 10 }));
    expect(cell('risk')!.textContent).toBe('Risk-adj.$10.0M');
    rerender(strip({ net: 99 }));
    expect(cell('net')!.textContent).toContain('$99.0M');
  });

  it('is fixed bottom centre in CSS', () => {
    const body = rule('.gp-panel.gp-hud');
    expect(body).toContain('position: fixed');
    expect(body).toContain('bottom:');
    expect(body).toContain('translateX(');
  });

  it('has no axe violations', async () => {
    const { container } = render(strip());
    const res = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(res.violations).toEqual([]);
  });
});

describe('StatusChip (#18)', () => {
  it('shows icon + word + number for a positive gap, never colour alone', () => {
    const { container } = render(<StatusChip gap={23.9} />);
    const chip = container.querySelector('.gp-chip')!;
    expect(chip.textContent).toBe('▲ $23.9M clear');
    expect(chip.querySelector('.gp-chip-icon')!.textContent).toBe('▲');
    expect(chip.querySelector('.gp-chip-icon')!.getAttribute('aria-hidden')).toBe('true');
    expect(chip.getAttribute('data-tone')).toBe('pos');
  });

  it('shows icon + word + number for a negative gap', () => {
    const { container } = render(<StatusChip gap={-23.7} />);
    const chip = container.querySelector('.gp-chip')!;
    expect(chip.textContent).toBe('▼ $23.7M short');
    expect(chip.getAttribute('data-tone')).toBe('neg');
  });

  it('takes a status and label such as "1 conflict"', () => {
    const { container } = render(<StatusChip status="conflict" label="1 conflict" />);
    const chip = container.querySelector('.gp-chip')!;
    expect(chip.textContent).toBe('⚠ 1 conflict');
    expect(chip.getAttribute('data-tone')).toBe('warn');
  });

  it('every status has an icon and a word, and the icon differs per status', () => {
    const icons = new Set<string>();
    for (const status of ['clear', 'short', 'conflict', 'info'] as const) {
      const { container, unmount } = render(<StatusChip status={status} label={`3 ${status}`} />);
      const icon = container.querySelector('.gp-chip-icon')!.textContent!;
      expect(icon).not.toBe('');
      expect(container.querySelector('.gp-chip-text')!.textContent).toMatch(/\d+ \w+/);
      icons.add(icon);
      unmount();
    }
    expect(icons.size).toBe(4);
  });

  it('shows a dash and a word for a missing gap', () => {
    const { container } = render(<StatusChip gap={undefined} />);
    expect(container.querySelector('.gp-chip')!.textContent).toBe('● — gap');
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <div>
        <StatusChip gap={5} />
        <StatusChip gap={-5} />
        <StatusChip status="conflict" label="1 conflict" />
      </div>,
    );
    const res = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(res.violations).toEqual([]);
  });
});

describe('Toast (#27)', () => {
  const live = () => screen.getByRole('status');

  it('has role=status mounted before any message and shows the message', () => {
    const { rerender } = render(<Toast message={null} />);
    expect(live()).toBeTruthy();
    expect(live().textContent).toBe('');
    rerender(<Toast message="Scenario D · net $143.0M" icon="✓" />);
    expect(within(live()).getByText('Scenario D · net $143.0M')).toBeTruthy();
    expect(live().querySelector('.gp-toast-icon')!.getAttribute('aria-hidden')).toBe('true');
  });

  it('is top centre and springs in (CSS)', () => {
    const region = rule('.gp-toast-region');
    expect(region).toContain('left: 50%');
    expect(region).toContain('top:');
    const open = rule('.gp-toast[data-state="open"]');
    expect(open).toContain('gp-toast-in');
    expect(open).toContain('var(--motion-spring)');
    expect(open).toContain(`${springs.toast.durationMs}ms`);
    expect(rules().some((r) => r.media?.includes('prefers-reduced-motion'))).toBe(true);
  });

  it('stays 2.4 s from the motion.toast token, then leaves and calls onClose', () => {
    vi.useFakeTimers();
    reducedMotion(false);
    expect(toastHoldMs).toBe(2400);
    expect(tokenValue['motion.toast']).toBe('2400ms');
    const onClose = vi.fn();
    render(<Toast message="Saved" onClose={onClose} />);
    const bubble = () => live().querySelector('.gp-toast');
    expect(bubble()!.getAttribute('data-state')).toBe('open');
    act(() => void vi.advanceTimersByTime(2399));
    expect(bubble()!.getAttribute('data-state')).toBe('open');
    expect(onClose).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(1));
    expect(bubble()!.getAttribute('data-state')).toBe('closing');
    expect(onClose).toHaveBeenCalledTimes(1);
    act(() => void vi.advanceTimersByTime(springs.toast.durationMs));
    expect(bubble()).toBeNull();
    expect(live().textContent).toBe('');
  });

  it('a new message restarts the 2.4 s hold, and a toastId re-shows the same message', () => {
    vi.useFakeTimers();
    reducedMotion(false);
    const { rerender } = render(<Toast message="One" />);
    act(() => void vi.advanceTimersByTime(2000));
    rerender(<Toast message="Two" />);
    act(() => void vi.advanceTimersByTime(2000));
    expect(live().textContent).toBe('Two');
    expect(live().querySelector('.gp-toast')!.getAttribute('data-state')).toBe('open');
    act(() => void vi.advanceTimersByTime(2000));
    expect(live().querySelector('.gp-toast')).toBeNull();
    rerender(<Toast message="Two" toastId={2} />);
    expect(live().textContent).toBe('Two');
  });

  it('under reduced motion it leaves at once after the hold', () => {
    vi.useFakeTimers();
    reducedMotion(true);
    render(<Toast message="Saved" />);
    act(() => void vi.advanceTimersByTime(2400));
    act(() => void vi.advanceTimersByTime(1));
    expect(live().querySelector('.gp-toast')).toBeNull();
  });

  it('has no axe violations while shown', async () => {
    const { container } = render(<Toast message="Saved" icon="✓" />);
    const res = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(res.violations).toEqual([]);
  });
});

describe('no business logic in the hud module', () => {
  it('uses no hex colours or raw px in its CSS', () => {
    expect(hudCss).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    // the hairline and the phone breakpoint arrive through tokens, not as literals
    const hairline = tokenValue['glass.border'].split(' ')[0]!;
    const tokenPx = hudCss.replaceAll(hairline, '').replaceAll(tokenValue['breakpoints.phone'], '');
    expect(tokenPx).not.toMatch(/\d(px)\b/);
  });
});
