import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cssVar, tokenValue } from '../tokens';
import {
  NumberRoll,
  bindNumberRoll,
  cubicBezier,
  motionMs,
  parseCubicBezier,
  prefersReducedMotion,
  reducedMotionCss,
  springs,
  transition,
} from './index';

// Test-only one-decimal formatter (real UI text comes from the format module).
const fmt1 = (n: number) => {
  const r = Math.round(Math.abs(n) * 10);
  return `${n < 0 ? '-' : ''}${Math.floor(r / 10)}.${r % 10}`;
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const run = (opts: Partial<ConstructorParameters<typeof NumberRoll>[0]> = {}) => {
  const frames: string[] = [];
  const widths: number[] = [];
  const roll = new NumberRoll({
    format: fmt1,
    initial: 100,
    onFrame: (text, { minWidthCh }) => {
      frames.push(text);
      widths.push(minWidthCh);
    },
    reducedMotion: () => false,
    ...opts,
  });
  frames.length = 0; // only frames produced after construction
  widths.length = 0;
  return { roll, frames, widths };
};

describe('NumberRoll tweens old to new with token durations, no layout shift', () => {
  it('reads its durations from the motion tokens', () => {
    expect(motionMs('roll')).toBe(parseInt(tokenValue['motion.roll'], 10));
    expect(motionMs('value')).toBe(parseInt(tokenValue['motion.value'], 10));
    expect(motionMs('roll')).toBe(520);
  });

  it('rolls through intermediate values and lands exactly on the target at the roll duration', () => {
    const { roll, frames } = run();
    roll.set(119.3);
    expect(roll.rolling).toBe(true);
    vi.advanceTimersByTime(motionMs('roll') / 2);
    expect(roll.rolling).toBe(true);
    const mid = parseFloat(frames.at(-1)!);
    expect(mid).toBeGreaterThan(100);
    expect(mid).toBeLessThan(119.3);
    vi.advanceTimersByTime(motionMs('roll') / 2 - 1);
    expect(roll.rolling).toBe(true);
    vi.advanceTimersByTime(16); // settles on the first frame at or after the token duration
    expect(roll.rolling).toBe(false);
    expect(frames.at(-1)).toBe('119.3');
    expect(roll.value).toBe(119.3);
  });

  it('is monotonic from old to new (ease-out) and can use the value duration', () => {
    const { roll, frames } = run({ durationToken: 'value' });
    roll.set(0);
    vi.advanceTimersByTime(motionMs('value'));
    const nums = frames.map(parseFloat);
    for (let i = 1; i < nums.length; i++) expect(nums[i]!).toBeLessThanOrEqual(nums[i - 1]!);
    expect(frames.at(-1)).toBe('0.0');
    // ease-out: more than half the distance is covered by half the time
    const { roll: r2, frames: f2 } = run({ durationToken: 'value' });
    r2.set(0);
    vi.advanceTimersByTime(motionMs('value') / 2);
    expect(parseFloat(f2.at(-1)!)).toBeLessThan(50);
  });

  it('never changes width: every frame fits the reserved min-width (max of old and new text)', () => {
    const { roll, frames, widths } = run({ initial: 99.9 });
    roll.set(1007.6);
    vi.advanceTimersByTime(motionMs('roll'));
    const reserved = Math.max('99.9'.length, '1007.6'.length);
    expect(frames.length).toBeGreaterThan(3);
    for (const f of frames) expect(f.length).toBeLessThanOrEqual(reserved);
    expect(new Set(widths.slice(0, -1))).toEqual(new Set([reserved]));
  });

  it('keeps the high-water width when retargeting mid-roll', () => {
    const { roll, widths } = run({ initial: 5 });
    roll.set(1000);
    vi.advanceTimersByTime(100);
    roll.set(2);
    vi.advanceTimersByTime(motionMs('roll'));
    expect(Math.min(...widths.slice(0, -1))).toBe('1000.0'.length);
  });

  it('retargeting continues from the displayed value, not the old target', () => {
    const { roll, frames } = run({ initial: 0 });
    roll.set(100);
    vi.advanceTimersByTime(200);
    const shown = parseFloat(frames.at(-1)!);
    roll.set(0);
    vi.advanceTimersByTime(16);
    expect(Math.abs(parseFloat(frames.at(-1)!) - shown)).toBeLessThan(shown);
    vi.advanceTimersByTime(motionMs('roll'));
    expect(frames.at(-1)).toBe('0.0');
  });

  it('jumps when there is no old or new value (null) and when the value is unchanged', () => {
    const { roll, frames } = run({ initial: null, format: fmt1 });
    roll.set(5);
    expect(frames.at(-1)).toBe('5.0');
    expect(roll.rolling).toBe(false);
    roll.set(5);
    expect(roll.rolling).toBe(false);
  });

  it('destroy stops the roll and further frames', () => {
    const { roll, frames } = run();
    roll.set(200);
    vi.advanceTimersByTime(50);
    const n = frames.length;
    roll.destroy();
    vi.advanceTimersByTime(motionMs('roll'));
    expect(frames.length).toBe(n);
  });

  it('binds to an element: tabular numerals token and reserved width, final text in place', () => {
    const style: Record<string, string> = {};
    const el = {
      textContent: '',
      style: { setProperty: (k: string, v: string) => void (style[k] = v) },
    };
    const roll = bindNumberRoll(el, { format: fmt1, initial: 1, reducedMotion: () => false });
    expect(el.textContent).toBe('1.0');
    roll.set(12.5);
    vi.advanceTimersByTime(motionMs('roll'));
    expect(el.textContent).toBe('12.5');
    expect(style['font-variant-numeric']).toBe(cssVar['type.numerals']);
    expect(style['min-width']).toBe('4ch');
  });
});

describe('prefers-reduced-motion disables every transition and the roll', () => {
  const reduce = () => true;

  it('detects the media query via an injected matcher', () => {
    const seen: string[] = [];
    const mm = (q: string) => (seen.push(q), { matches: true });
    expect(prefersReducedMotion(mm)).toBe(true);
    expect(seen).toEqual(['(prefers-reduced-motion: reduce)']);
    expect(prefersReducedMotion(() => ({ matches: false }))).toBe(false);
    expect(prefersReducedMotion(() => { throw new Error('x'); })).toBe(false);
  });

  it('NumberRoll jumps straight to the value, with no timers scheduled', () => {
    const { roll, frames } = run({ reducedMotion: reduce });
    roll.set(119.3);
    expect(frames).toEqual(['119.3']);
    expect(roll.rolling).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a roll in flight is cut to the target when reduced motion turns on', () => {
    let reduced = false;
    const { roll, frames } = run({ reducedMotion: () => reduced });
    roll.set(200);
    vi.advanceTimersByTime(50);
    reduced = true;
    roll.set(300);
    expect(frames.at(-1)).toBe('300.0');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('every spring preset has zero duration and no transition when reduced', () => {
    for (const name of ['toggle', 'toast', 'drawer'] as const) {
      expect(transition(name, ['transform', 'opacity'], true)).toBe('none');
      expect(springs[name].durationMs).toBeGreaterThan(0);
      expect(springs[name].reduced.durationMs).toBe(0);
    }
    expect(springs.toast.reduced.holdMs).toBe(motionMs('toast'));
  });

  it('ships a stylesheet that switches off all transitions and animations under the media query', () => {
    expect(reducedMotionCss).toContain('@media (prefers-reduced-motion: reduce)');
    expect(reducedMotionCss).toMatch(/transition:\s*none\s*!important/);
    expect(reducedMotionCss).toMatch(/animation:\s*none\s*!important/);
    expect(reducedMotionCss).toContain('scroll-behavior: auto');
  });
});

describe('spring presets come from tokens for toggles, toasts and drawers', () => {
  it('uses the spring token curve for all three', () => {
    for (const name of ['toggle', 'toast', 'drawer'] as const) {
      expect(springs[name].easing).toBe(tokenValue['motion.spring']);
      expect(springs[name].cssEasing).toBe(cssVar['motion.spring']);
      expect(parseCubicBezier(springs[name].easing)).toEqual([0.34, 1.56, 0.64, 1]);
    }
  });

  it('toast hold time is the toast token; durations sit in the 250-300 ms spring band', () => {
    expect(springs.toast.holdMs).toBe(2400);
    expect(springs.toast.holdMs).toBe(motionMs('toast'));
    for (const name of ['toggle', 'toast', 'drawer'] as const) {
      expect(springs[name].durationMs).toBeGreaterThanOrEqual(250);
      expect(springs[name].durationMs).toBeLessThanOrEqual(300);
    }
  });

  it('builds a CSS transition string using the token variable', () => {
    expect(transition('toggle', ['transform'])).toBe(
      `transform ${springs.toggle.durationMs}ms ${cssVar['motion.spring']}`,
    );
    expect(transition('drawer', ['transform', 'opacity'], false)).toBe(
      `transform ${springs.drawer.durationMs}ms ${cssVar['motion.spring']}, opacity ${springs.drawer.durationMs}ms ${cssVar['motion.spring']}`,
    );
  });

  it('the spring curve overshoots (y > 1) and ease-out does not', () => {
    const spring = cubicBezier(...parseCubicBezier(tokenValue['motion.spring']));
    const ease = cubicBezier(...parseCubicBezier(tokenValue['motion.ease']));
    expect(spring(0)).toBe(0);
    expect(spring(1)).toBe(1);
    expect(Math.max(...Array.from({ length: 100 }, (_, i) => spring(i / 99)))).toBeGreaterThan(1);
    expect(Math.max(...Array.from({ length: 100 }, (_, i) => ease(i / 99)))).toBeLessThanOrEqual(1);
  });
});
