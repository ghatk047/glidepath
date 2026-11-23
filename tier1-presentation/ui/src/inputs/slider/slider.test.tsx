// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import axe from 'axe-core';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ESTIMATE_TOOLTIP,
  PREVIEW_INTERVAL_MS,
  Slider,
  sliderCss,
  snapToStep,
  type SliderProps,
} from './index';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** Display metadata as tier 2 sends it (fixture values, not business numbers). */
const base: SliderProps = {
  label: 'Shelfware harvested',
  value: 0.1,
  min: 0,
  max: 0.3,
  step: 0.01,
  unit: '%',
};

const renderSlider = (props: Partial<SliderProps> = {}) => {
  const onPreview = vi.fn();
  const onCommit = vi.fn();
  const utils = render(<Slider {...base} onPreview={onPreview} onCommit={onCommit} {...props} />);
  const input = screen.getByRole('slider') as HTMLInputElement;
  return { ...utils, input, onPreview, onCommit };
};

/** A drag frame: the browser sets the value and fires `input`. */
const drag = (input: HTMLInputElement, value: number) =>
  fireEvent.input(input, { target: { value: String(value) } });

const valueLabel = (container: HTMLElement) =>
  container.querySelector('.gp-slider-value')!.textContent;

describe('UI-08 look: native range, white thumb, accent fill, ghosts, estimate lock + tooltip', () => {
  it('decision: native input range with accent fill, white thumb and C / D ghost ticks from props', () => {
    const { container, input } = renderSlider({
      ghosts: [
        { label: 'C', value: 0.1 },
        { label: 'D', value: 0.15 },
      ],
    });
    expect(input.tagName).toBe('INPUT');
    expect(input.type).toBe('range');
    expect(input.min).toBe('0');
    expect(input.max).toBe('0.3');
    expect(input.step).toBe('0.01');
    expect(input.value).toBe('0.1');
    // accessible name from the label, value text from the format module
    expect(screen.getByLabelText('Shelfware harvested')).toBe(input);
    expect(input.getAttribute('aria-valuetext')).toBe('10%');
    expect(valueLabel(container)).toBe('10%');
    // fill position for the track gradient
    expect(input.style.getPropertyValue('--p')).toMatch(/^33\.33/);

    const root = container.querySelector('.gp-slider')!;
    expect(root.classList.contains('est')).toBe(false);
    expect(root.getAttribute('data-variant')).toBe('decision');
    expect(container.querySelector('.gp-slider-lock')).toBeNull();

    const ghosts = [...container.querySelectorAll<HTMLElement>('.gp-slider-ghost')];
    expect(ghosts.map((el) => el.textContent)).toEqual(['C', 'D']);
    expect(ghosts[0]!.style.left).toMatch(/^33\.33/);
    expect(ghosts[1]!.style.left).toMatch(/^50(\.0+\d*)?%$|^49\.99/);
    // ghosts are described to screen readers in words
    const described = (input.getAttribute('aria-describedby') ?? '')
      .split(' ')
      .map((id) => document.getElementById(id)?.textContent)
      .join(' ');
    expect(described).toContain('C 10%');
    expect(described).toContain('D 15%');

    // CSS: white thumb, accent fill, ghost ticks, estimate grey fill
    expect(sliderCss).toMatch(/::-webkit-slider-thumb \{[^}]*background: white;/);
    expect(sliderCss).toMatch(/::-moz-range-thumb \{[^}]*background: white;/);
    expect(sliderCss).toMatch(
      /\.gp-slider-range input::-webkit-slider-runnable-track \{[^}]*var\(--accent\) 0 var\(--p/,
    );
    expect(sliderCss).toMatch(/::-moz-range-progress \{[^}]*background: var\(--accent\)/);
    expect(sliderCss).toMatch(
      /\.gp-slider\.est \.gp-slider-range input::-webkit-slider-runnable-track \{[^}]*var\(--ink-3\) 0 var\(--p/,
    );
    // CSS is mounted (hoisted once into <head>)
    expect(document.head.querySelector('style[data-href="gp-slider"]')?.textContent).toBe(
      sliderCss,
    );
  });

  it('estimate: grey variant with lock icon in the label and the tooltip "solvers never move it"', () => {
    const { container, input } = renderSlider({
      variant: 'estimate',
      label: 'Share renewing in 2027',
      value: 0.6,
      min: 0,
      max: 1,
      step: 0.05,
    });
    const root = container.querySelector('.gp-slider')!;
    expect(root.classList.contains('est')).toBe(true);
    expect(root.getAttribute('data-variant')).toBe('estimate');
    const label = container.querySelector('label')!;
    const lock = label.querySelector('.gp-slider-lock svg');
    expect(lock).not.toBeNull();
    expect(lock!.getAttribute('aria-hidden')).toBe('true');

    const tip = screen.getByRole('tooltip', { hidden: true });
    expect(ESTIMATE_TOOLTIP).toMatch(/solvers never move it/);
    expect(tip.textContent).toBe(ESTIMATE_TOOLTIP);
    expect(input.getAttribute('aria-describedby')!.split(' ')).toContain(tip.id);
    // the tooltip is not part of the accessible name
    expect(screen.getByLabelText('Share renewing in 2027')).toBe(input);
    // the glass tooltip shows on lock hover and on keyboard focus
    expect(sliderCss).toMatch(/:has\(\.gp-slider-lock:hover\) \.gp-slider-tip/);
    expect(sliderCss).toMatch(/:has\(input:focus-visible\) \.gp-slider-tip/);
  });

  it('ghosts outside min/max are not drawn', () => {
    const { container } = renderSlider({
      ghosts: [
        { label: 'C', value: 0.1 },
        { label: 'D', value: 0.5 },
      ],
    });
    expect([...container.querySelectorAll('.gp-slider-ghost')].map((g) => g.textContent)).toEqual([
      'C',
    ]);
  });

  it('tokens only: no hex colours and no raw px in the slider CSS', () => {
    expect(sliderCss).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(sliderCss).not.toMatch(/\d(\.\d+)?px/);
  });
});

describe('UI-08 feel: local 60 fps, onPreview throttled to ≤ 1 per 33 ms (latest wins), onCommit on release / keyboard', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('thumb and value label follow every frame locally; previews are throttled, latest value wins', () => {
    expect(PREVIEW_INTERVAL_MS).toBe(33);
    const { container, input, onPreview, onCommit } = renderSlider();

    drag(input, 0.11);
    // leading edge: first frame previews at once
    expect(onPreview).toHaveBeenCalledTimes(1);
    expect(onPreview).toHaveBeenLastCalledWith(0.11);

    // more frames inside the same 33 ms window: label and thumb move, no extra preview
    for (const v of [0.12, 0.13, 0.14]) {
      act(() => {
        vi.advanceTimersByTime(8);
      });
      drag(input, v);
      expect(valueLabel(container)).toBe(`${Math.round(v * 100)}%`);
      expect(input.value).toBe(String(v));
      expect(input.getAttribute('aria-valuetext')).toBe(`${Math.round(v * 100)}%`);
    }
    expect(input.style.getPropertyValue('--p')).toMatch(/^46\.66/);
    expect(onPreview).toHaveBeenCalledTimes(1);

    // the window closes: the latest value (0.14) goes out, intermediate ones are dropped
    act(() => {
      vi.advanceTimersByTime(PREVIEW_INTERVAL_MS - 24);
    });
    expect(onPreview).toHaveBeenCalledTimes(2);
    expect(onPreview).toHaveBeenLastCalledWith(0.14);

    // nothing pending: an idle window sends nothing
    act(() => {
      vi.advanceTimersByTime(PREVIEW_INTERVAL_MS * 3);
    });
    expect(onPreview).toHaveBeenCalledTimes(2);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('never more than one preview per 33 ms over a long drag', () => {
    const { input, onPreview } = renderSlider({ max: 1, step: 0.001 });
    const calls: number[] = [];
    onPreview.mockImplementation(() => calls.push(Date.now()));
    // 60 fps for one second
    for (let i = 1; i <= 60; i++) {
      drag(input, i / 1000);
      act(() => {
        vi.advanceTimersByTime(1000 / 60);
      });
    }
    act(() => {
      vi.advanceTimersByTime(PREVIEW_INTERVAL_MS);
    });
    for (let i = 1; i < calls.length; i++)
      expect(calls[i]! - calls[i - 1]!).toBeGreaterThanOrEqual(PREVIEW_INTERVAL_MS);
    expect(calls.length).toBeLessThanOrEqual(Math.ceil(1000 / PREVIEW_INTERVAL_MS) + 1);
    expect(onPreview).toHaveBeenLastCalledWith(0.06);
  });

  it('commits once on pointer release with the final value and drops the pending preview', () => {
    const { input, onPreview, onCommit } = renderSlider();
    fireEvent.pointerDown(input);
    drag(input, 0.12);
    drag(input, 0.15);
    expect(onPreview).toHaveBeenCalledTimes(1);
    fireEvent.pointerUp(input);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(0.15);
    // the browser's own `change` on release does not commit twice
    fireEvent.change(input);
    expect(onCommit).toHaveBeenCalledTimes(1);
    // the pending 0.15 preview is superseded by the commit
    act(() => {
      vi.advanceTimersByTime(PREVIEW_INTERVAL_MS * 2);
    });
    expect(onPreview).toHaveBeenCalledTimes(1);
  });

  it('commits on the native change event (release without pointer events, assistive tech)', () => {
    const { input, onCommit } = renderSlider();
    drag(input, 0.2);
    fireEvent.change(input);
    expect(onCommit).toHaveBeenCalledWith(0.2);
  });

  it('a release without movement commits nothing', () => {
    const { input, onCommit } = renderSlider();
    fireEvent.pointerDown(input);
    fireEvent.pointerUp(input);
    fireEvent.change(input);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('keyboard: arrows preview, key release commits once; Enter commits', () => {
    const { container, input, onPreview, onCommit } = renderSlider();
    fireEvent.keyDown(input, { key: 'ArrowRight' });
    fireEvent.keyDown(input, { key: 'ArrowRight', repeat: true });
    fireEvent.keyDown(input, { key: 'ArrowRight', repeat: true });
    expect(valueLabel(container)).toBe('13%');
    expect(onPreview).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.keyUp(input, { key: 'ArrowRight' });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(0.13);

    fireEvent.keyDown(input, { key: 'ArrowLeft' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledTimes(2);
    expect(onCommit).toHaveBeenLastCalledWith(0.12);
    fireEvent.keyUp(input, { key: 'ArrowLeft' });
    expect(onCommit).toHaveBeenCalledTimes(2);
  });

  it('blur commits an uncommitted change', () => {
    const { input, onCommit } = renderSlider();
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledWith(0.11);
  });

  it('the local value holds until tier 2 sends a new value, then follows the prop', () => {
    const onCommit = vi.fn();
    const { container, rerender } = render(<Slider {...base} onCommit={onCommit} />);
    const input = screen.getByRole('slider') as HTMLInputElement;
    drag(input, 0.2);
    fireEvent.pointerUp(input);
    expect(valueLabel(container)).toBe('20%');
    // tier 2 echoes the committed value
    rerender(<Slider {...base} value={0.2} onCommit={onCommit} />);
    expect(valueLabel(container)).toBe('20%');
    // a later change from elsewhere (preset, solver, undo) moves the thumb
    rerender(<Slider {...base} value={0.05} onCommit={onCommit} />);
    expect(valueLabel(container)).toBe('5%');
    expect(input.value).toBe('0.05');
  });

  it('a prop update mid-drag does not yank the thumb', () => {
    const { container, rerender } = render(<Slider {...base} />);
    const input = screen.getByRole('slider') as HTMLInputElement;
    fireEvent.pointerDown(input);
    drag(input, 0.2);
    rerender(<Slider {...base} value={0.05} />);
    expect(valueLabel(container)).toBe('20%');
  });

  it('unmount clears the pending preview timer', () => {
    const { input, onPreview, unmount } = renderSlider();
    drag(input, 0.11);
    drag(input, 0.12);
    unmount();
    act(() => {
      vi.advanceTimersByTime(PREVIEW_INTERVAL_MS * 2);
    });
    expect(onPreview).toHaveBeenCalledTimes(1);
  });
});

describe('UI-08 clamp: min / max / step from props; arrow keys step', () => {
  it('arrow keys, Page keys, Home and End step by the props and clamp at min / max', () => {
    const { container, input, onPreview } = renderSlider({ value: 0.28 });
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(valueLabel(container)).toBe('29%');
    fireEvent.keyDown(input, { key: 'ArrowRight' });
    fireEvent.keyDown(input, { key: 'ArrowRight' });
    expect(valueLabel(container)).toBe('30%');
    expect(input.value).toBe('0.3');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowLeft' });
    expect(input.value).toBe('0.28');
    fireEvent.keyDown(input, { key: 'PageDown' });
    expect(input.value).toBe('0.18');
    fireEvent.keyDown(input, { key: 'PageUp' });
    expect(input.value).toBe('0.28');
    fireEvent.keyDown(input, { key: 'Home' });
    expect(input.value).toBe('0');
    fireEvent.keyDown(input, { key: 'ArrowLeft' });
    expect(input.value).toBe('0');
    fireEvent.keyDown(input, { key: 'End' });
    expect(input.value).toBe('0.3');
    expect(onPreview).toHaveBeenCalled();
  });

  it('arrow keys preventDefault (the component owns stepping) and other keys pass through', () => {
    const { input } = renderSlider();
    expect(fireEvent.keyDown(input, { key: 'ArrowRight' })).toBe(false);
    expect(fireEvent.keyDown(input, { key: 'Tab' })).toBe(true);
  });

  it('values from drag and props clamp to min / max and snap to step', () => {
    const { container, input, onPreview, rerender } = renderSlider();
    drag(input, 0.123);
    expect(onPreview).toHaveBeenLastCalledWith(0.12);
    expect(valueLabel(container)).toBe('12%');
    fireEvent.pointerUp(input);
    rerender(<Slider {...base} value={7} />);
    // a prop outside the range shows at the edge (display only; tier 2 owns the value)
    expect(input.value).toBe('0.3');
    expect(valueLabel(container)).toBe('30%');
  });

  it('snapToStep clamps, snaps to the grid from min, and has no float noise', () => {
    expect(snapToStep(0.30000000000000004, 0, 0.3, 0.01)).toBe(0.3);
    expect(snapToStep(0.1 + 0.2, 0, 1, 0.1)).toBe(0.3);
    expect(snapToStep(-1, 0, 1, 0.05)).toBe(0);
    expect(snapToStep(2, 0, 1, 0.05)).toBe(1);
    expect(snapToStep(0.074, 0, 1, 0.05)).toBe(0.05);
    expect(snapToStep(57, 50, 150, 5)).toBe(55);
    // max off the step grid: the highest on-grid value at or below max
    expect(snapToStep(10, 0, 10, 3)).toBe(9);
    // step 0 or missing: clamp only
    expect(snapToStep(0.123, 0, 1, 0)).toBe(0.123);
    expect(snapToStep(Number.NaN, 0, 1, 0.1)).toBe(0);
  });

  it('formats the value label by registry unit, digits from step; a format prop overrides', () => {
    const label = (p: Partial<SliderProps>) => {
      const { container, unmount } = render(<Slider {...base} {...p} />);
      const text = valueLabel(container);
      unmount();
      return text;
    };
    expect(label({ unit: '$M', value: 100, min: 50, max: 150, step: 1 })).toBe('$100M');
    expect(label({ unit: '$M', value: 12.5, min: 0, max: 50, step: 0.5 })).toBe('$12.5M');
    expect(label({ unit: '%', value: 0.125, min: 0, max: 1, step: 0.005 })).toBe('12.5%');
    expect(label({ unit: 'FTE', value: 1200, min: 0, max: 3000, step: 50 })).toBe('1,200');
    expect(label({ unit: 'x', value: 1.5, min: 1, max: 3, step: 0.1 })).toBe('1.5×');
    expect(label({ unit: 'months', value: 6, min: 0, max: 12, step: 1 })).toBe('6 months');
    expect(
      label({ unit: 'months', value: 6, min: 0, max: 12, step: 1, format: (v) => `ramp ${v} mo` }),
    ).toBe('ramp 6 mo');
  });
});

describe('UI-08 no formulas or business rules: values arrive as props', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const sources = readdirSync(here).filter(
    (f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f),
  );

  it('imports only React and ui-internal presentation modules (tokens, format, motion)', () => {
    const allowed = /^(react|react\/jsx-runtime|\.\/[\w-]+|\.\.\/\.\.\/(tokens|format|motion))$/;
    for (const f of sources) {
      const src = readFileSync(join(here, f), 'utf8');
      for (const m of src.matchAll(/from '([^']+)'/g))
        expect(m[1], `${f}: ${m[1]}`).toMatch(allowed);
      expect(src, f).not.toMatch(/tier2-logic|tier3-data|@glidepath\/(engine|domain|solvers|spec)/);
    }
  });

  it('renders the value, range and ghosts it is given; it never invents them', () => {
    const { container, input } = renderSlider({
      value: 0.07,
      min: 0.02,
      max: 0.4,
      step: 0.01,
      ghosts: [{ label: 'C', value: 0.09 }],
    });
    expect([input.min, input.max, input.step, input.value]).toEqual([
      '0.02',
      '0.4',
      '0.01',
      '0.07',
    ]);
    expect(valueLabel(container)).toBe('7%');
    expect(container.querySelectorAll('.gp-slider-ghost')).toHaveLength(1);
  });
});

describe('UI-08 G12 accessibility (axe-core)', () => {
  it('decision and estimate sliders have no serious or critical violations', async () => {
    render(
      <main>
        <Slider
          {...base}
          ghosts={[
            { label: 'C', value: 0.1 },
            { label: 'D', value: 0.15 },
          ]}
        />
        <Slider {...base} label="Share renewing in 2027" variant="estimate" value={0.2} />
      </main>,
    );
    const result = await axe.run(document.body, {
      rules: { 'color-contrast': { enabled: false } },
    });
    const bad = result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(bad.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });

  it('each slider gets a unique input id (label pairing) unless one is given', () => {
    render(
      <>
        <Slider {...base} />
        <Slider {...base} label="Other" id="in-other" />
      </>,
    );
    const [a, b] = screen.getAllByRole('slider');
    expect(a!.id).not.toBe('');
    expect(b!.id).toBe('in-other');
    expect(screen.getByLabelText('Other')).toBe(b);
  });
});
