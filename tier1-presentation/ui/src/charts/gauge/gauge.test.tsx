// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import axe from 'axe-core';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { motionMs } from '../../motion';
import { cssVar } from '../../tokens';
import {
  GAUGE,
  Gauge,
  RingTile,
  TICK_STEP,
  angleAt,
  gaugeCss,
  ringFraction,
  tickValues,
  vpColour,
  VP_SLOTS,
} from './index';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const reducedMotion = (on: boolean) =>
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: q.includes('prefers-reduced-motion') ? on : false,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));

/** Values as tier 2 would push them (Cockpit, scenario C). */
const C = { net: 119.3, bar: 143.0, target: 100, max: 180 };

const q = <T extends Element = SVGElement>(sel: string) => document.querySelector<T>(sel)!;
const all = (sel: string) => [...document.querySelectorAll(sel)];
/** End point of an SVG arc path "M.. A r r 0 large 1 x y". */
const arcEnd = (d: string) =>
  d
    .trim()
    .split(/[\s A]+/)
    .slice(-2)
    .map(Number) as [number, number];
const polar = (a: number, r: number = GAUGE.r) =>
  [GAUGE.cx + r * Math.cos(a), GAUGE.cy + r * Math.sin(a)] as const;

describe('Gauge (#16)', () => {
  it('draws a 270° arc with gradient fill, solid bar notch, dotted target notch, ticks every 20, labels 0 and max', () => {
    reducedMotion(false);
    const { container } = render(<Gauge {...C} />);
    const svg = q('svg.gp-gauge-svg');
    expect(svg.getAttribute('viewBox')).toBe(GAUGE.viewBox);

    // 270° sweep: the track runs from 135° to 405° with the large-arc flag.
    expect(GAUGE.sweep).toBeCloseTo((Math.PI * 3) / 2, 12);
    expect(GAUGE.start).toBeCloseTo((Math.PI * 3) / 4, 12);
    const track = q('[data-mark="track"] path').getAttribute('d')!;
    expect(track).toMatch(/A128 128 0 1 1/);
    const [ex, ey] = arcEnd(track);
    const [px, py] = polar(GAUGE.start + GAUGE.sweep);
    expect(ex).toBeCloseTo(px, 1);
    expect(ey).toBeCloseTo(py, 1);

    // Gradient fill from accent-2 to accent, ending at the net's angle on the max scale.
    const fill = q('[data-mark="net"] path');
    const gradId = /^url\(#(.+)\)$/.exec(fill.getAttribute('stroke')!)![1]!;
    const grad = container.querySelector(`linearGradient[id="${gradId}"]`)!;
    expect([...grad.querySelectorAll('stop')].map((s) => s.getAttribute('stop-color'))).toEqual([
      cssVar['themes.cruise.color.accent2'],
      cssVar['themes.cruise.color.accent'],
    ]);
    const [fx, fy] = arcEnd(fill.getAttribute('d')!);
    const [nx, ny] = polar(angleAt(C.net, C.max));
    expect(fx).toBeCloseTo(nx, 1);
    expect(fy).toBeCloseTo(ny, 1);
    expect(fill.getAttribute('class')).toContain('gp-gauge-fill');

    // Bar notch solid and strong, target notch dotted.
    const barLine = q('[data-mark="bar"] line.gp-gauge-notch');
    const targetLine = q('[data-mark="target"] line.gp-gauge-notch');
    expect(barLine.getAttribute('stroke-dasharray')).toBeNull();
    expect(Number(barLine.getAttribute('stroke-width'))).toBeGreaterThan(
      Number(targetLine.getAttribute('stroke-width')),
    );
    expect(targetLine.getAttribute('stroke-dasharray')).toBe('2 3');
    expect(q('[data-mark="bar"] text').textContent).toBe('Bar 143');
    expect(q('[data-mark="bar"] text').getAttribute('class')).toBe('gp-t-ink');
    expect(q('[data-mark="target"] text').textContent).toBe('Target 100');

    // Ticks every 20 from 0 to max; every third one is major.
    expect(TICK_STEP).toBe(20);
    expect(tickValues(180)).toEqual([0, 20, 40, 60, 80, 100, 120, 140, 160, 180]);
    const ticks = all('.gp-gauge-ticks line');
    expect(ticks).toHaveLength(10);
    expect(ticks.filter((t) => t.getAttribute('data-major') === 'true')).toHaveLength(4);

    // Labels 0 and max, both read from props.
    expect(q('[data-label="min"]').textContent).toBe('0');
    expect(q('[data-label="max"]').textContent).toBe('180');

    // Screen readers get the whole picture in words.
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe(
      'Net savings $119.3M against a bar of $143.0M; target $100.0M; scale 0 to 180',
    );
    expect(svg.outerHTML).toMatchInlineSnapshot(
      `"<svg class="gp-gauge-svg" viewBox="-10 -6 340 300" role="img" aria-label="Net savings $119.3M against a bar of $143.0M; target $100.0M; scale 0 to 180"><defs><linearGradient id="gp-gauge-fill-_r_0_" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="var(--accent-2)"></stop><stop offset="1" stop-color="var(--accent)"></stop></linearGradient></defs><g class="gp-gauge-ticks" aria-hidden="true"><line x1="58.2" y1="261.8" x2="53.2" y2="266.8" stroke="var(--ink-3)" stroke-width="1.4" opacity="0.6" data-major="true"></line><line x1="20.9" y1="197.3" x2="18" y2="198" stroke="var(--ink-3)" stroke-width="1" opacity="0.6" data-major="false"></line><line x1="20.9" y1="122.7" x2="18" y2="122" stroke="var(--ink-3)" stroke-width="1" opacity="0.6" data-major="false"></line><line x1="58.2" y1="58.2" x2="53.2" y2="53.2" stroke="var(--ink-3)" stroke-width="1.4" opacity="0.6" data-major="true"></line><line x1="122.7" y1="20.9" x2="122" y2="18" stroke="var(--ink-3)" stroke-width="1" opacity="0.6" data-major="false"></line><line x1="197.3" y1="20.9" x2="198" y2="18" stroke="var(--ink-3)" stroke-width="1" opacity="0.6" data-major="false"></line><line x1="261.8" y1="58.2" x2="266.8" y2="53.2" stroke="var(--ink-3)" stroke-width="1.4" opacity="0.6" data-major="true"></line><line x1="299.1" y1="122.7" x2="302" y2="122" stroke="var(--ink-3)" stroke-width="1" opacity="0.6" data-major="false"></line><line x1="299.1" y1="197.3" x2="302" y2="198" stroke="var(--ink-3)" stroke-width="1" opacity="0.6" data-major="false"></line><line x1="261.8" y1="261.8" x2="266.8" y2="266.8" stroke="var(--ink-3)" stroke-width="1.4" opacity="0.6" data-major="true"></line></g><g data-mark="track" data-tip="Scale 0 to 180"><path d="M69.49 250.51A128 128 0 1 1 250.51 250.51" stroke="var(--track)" stroke-width="14" stroke-linecap="round" fill="none"></path></g><g data-mark="net" data-tip="Net savings $119.3M" data-shown="119.3"><path class="gp-gauge-fill" d="M69.49 250.51A128 128 0 0 1 248.84 67.85" stroke="url(#gp-gauge-fill-_r_0_)" stroke-width="14" stroke-linecap="round" fill="none"></path></g><g data-mark="target" data-tip="Target $100.0M"><line class="gp-gauge-hit" x1="189.8" y1="48.9" x2="196.5" y2="23.8" stroke-width="12"></line><line class="gp-gauge-notch" x1="189.8" y1="48.9" x2="196.5" y2="23.8" stroke="var(--ink)" stroke-width="1.4" stroke-linecap="round" stroke-dasharray="2 3"></line><text x="203" y="3.7" text-anchor="middle" aria-hidden="true">Target 100</text></g><g data-mark="bar" data-tip="Bar $143.0M"><line class="gp-gauge-hit" x1="273.1" y1="139" x2="298.6" y2="134.3" stroke-width="12"></line><line class="gp-gauge-notch" x1="273.1" y1="139" x2="298.6" y2="134.3" stroke="var(--ink)" stroke-width="2.4" stroke-linecap="round"></line><text x="323.2" y="133.7" text-anchor="middle" class="gp-t-ink" aria-hidden="true">Bar 143</text></g><text data-label="min" x="65.5" y="276.5" text-anchor="middle" aria-hidden="true">0</text><text data-label="max" x="254.5" y="276.5" text-anchor="middle" aria-hidden="true">180</text></svg>"`,
    );
  });

  it('fill tweens from the old net to the new net', () => {
    reducedMotion(false);
    vi.useFakeTimers({
      toFake: [
        'Date',
        'setTimeout',
        'clearTimeout',
        'requestAnimationFrame',
        'cancelAnimationFrame',
      ],
    });
    const { rerender } = render(<Gauge {...C} net={40} />);
    const end = () => arcEnd(q('[data-mark="net"] path').getAttribute('d')!);
    const at = (v: number) => polar(angleAt(v, C.max));
    expect(end()[0]).toBeCloseTo(at(40)[0], 1);

    rerender(<Gauge {...C} net={160} />);
    act(() => void vi.advanceTimersByTime(motionMs('roll') / 2));
    const mid = q('[data-mark="net"]').getAttribute('data-shown');
    expect(Number(mid)).toBeGreaterThan(40);
    expect(Number(mid)).toBeLessThan(160);

    act(() => void vi.advanceTimersByTime(motionMs('roll')));
    expect(q('[data-mark="net"]').getAttribute('data-shown')).toBe('160');
    expect(end()[0]).toBeCloseTo(at(160)[0], 1);
    expect(end()[1]).toBeCloseTo(at(160)[1], 1);
  });

  it('respects reduced motion: the fill jumps to the new net', () => {
    reducedMotion(true);
    const { rerender } = render(<Gauge {...C} net={40} />);
    rerender(<Gauge {...C} net={160} />);
    expect(q('[data-mark="net"]').getAttribute('data-shown')).toBe('160');
    expect(arcEnd(q('[data-mark="net"] path').getAttribute('d')!)[0]).toBeCloseTo(
      polar(angleAt(160, C.max))[0],
      1,
    );
  });

  it('puts a tooltip on every mark', () => {
    reducedMotion(false);
    render(<Gauge {...C} />);
    const tips = Object.fromEntries(
      all('[data-mark]').map((m) => [m.getAttribute('data-mark'), m.getAttribute('data-tip')]),
    );
    expect(tips).toEqual({
      track: 'Scale 0 to 180',
      net: 'Net savings $119.3M',
      target: 'Target $100.0M',
      bar: 'Bar $143.0M',
    });
    // Thin notches carry a wider invisible hit line so the tooltip is reachable.
    expect(q('[data-mark="bar"] .gp-gauge-hit')).toBeTruthy();
    expect(q('[data-mark="target"] .gp-gauge-hit')).toBeTruthy();
  });

  it('takes max from props and invents nothing when a value is missing', () => {
    reducedMotion(true); // no tween: read each end state at once
    const { rerender } = render(<Gauge net={50} bar={90} target={60} max={200} />);
    expect(q('[data-label="max"]').textContent).toBe('200');
    expect(all('.gp-gauge-ticks line')).toHaveLength(11);
    // Net beyond the scale pins to the end of the arc; it is not rescaled.
    rerender(<Gauge net={260} bar={90} target={60} max={200} />);
    expect(arcEnd(q('[data-mark="net"] path').getAttribute('d')!)[0]).toBeCloseTo(
      polar(GAUGE.start + GAUGE.sweep)[0],
      1,
    );
    // Before tier 2 pushes values: track only, no fill, no notches, no max label.
    rerender(<Gauge net={null} bar={undefined} target={null} max={null} />);
    expect(document.querySelector('[data-mark="net"]')).toBeNull();
    expect(document.querySelector('[data-mark="bar"]')).toBeNull();
    expect(document.querySelector('[data-mark="target"]')).toBeNull();
    expect(document.querySelector('[data-label="max"]')).toBeNull();
    expect(q('[data-mark="track"]')).toBeTruthy();
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe(
      'Net savings — against a bar of —; target —; scale —',
    );
    // A zero or negative net draws no fill.
    rerender(<Gauge net={-4} bar={90} target={60} max={200} />);
    expect(document.querySelector('[data-mark="net"]')).toBeNull();
  });

  it('renders centre content over the arc', () => {
    reducedMotion(false);
    render(
      <Gauge {...C}>
        <span className="gp-gauge-hero">$119.3M</span>
      </Gauge>,
    );
    const centre = q<HTMLElement>('.gp-gauge-center');
    expect(centre.textContent).toBe('$119.3M');
    expect(centre.parentElement!.className).toBe('gp-gauge');
  });

  it('has no axe violations', async () => {
    reducedMotion(false);
    const { container } = render(
      <Gauge {...C}>
        <span className="gp-gauge-hero">$119.3M</span>
      </Gauge>,
    );
    const res = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(res.violations).toEqual([]);
  });
});

describe('RingTile (#17)', () => {
  it('shows the percentage in the centre', () => {
    render(<RingTile value={31.7} max={36.6} colour={0} />);
    expect(q('.gp-ring-pct').textContent).toBe('87%');
    expect(q('.gp-ring-pct').getAttribute('text-anchor')).toBe('middle');
    expect(q('.gp-ring-pct').getAttribute('x')).toBe('50%');
    // The arc length is the clamped share of the circumference.
    const arc = q('.gp-ring-arc');
    const r = Number(arc.getAttribute('r'));
    const [dash, gap] = arc.getAttribute('stroke-dasharray')!.split(' ').map(Number);
    expect(gap).toBeCloseTo(2 * Math.PI * r, 1);
    expect(dash).toBeCloseTo(2 * Math.PI * r * (31.7 / 36.6), 1);
    expect(ringFraction(50, 40)).toBe(1);
    expect(ringFraction(-3, 40)).toBe(0);
    expect(ringFraction(3, 0)).toBe(0);
    expect(ringFraction(null, 40)).toBe(0);
  });

  it('takes the VP colour by slot order', () => {
    expect(VP_SLOTS).toBe(5);
    expect([0, 1, 2, 3, 4].map(vpColour)).toEqual([
      'var(--series-1)',
      'var(--series-2)',
      'var(--series-3)',
      'var(--series-4)',
      'var(--series-5)',
    ]);
    // A sixth slot wraps round the reference palette.
    expect(vpColour(5)).toBe('var(--series-1)');
    const { rerender } = render(<RingTile value={27.3} max={34.1} colour={1} />);
    expect(q('.gp-ring-arc').getAttribute('stroke')).toBe('var(--series-2)');
    // Text stays ink, never the series colour.
    expect(q('.gp-ring-pct').getAttribute('stroke')).toBeNull();
    rerender(<RingTile value={27.3} max={34.1} colour={cssVar['themes.cruise.color.accent']} />);
    expect(q('.gp-ring-arc').getAttribute('stroke')).toBe('var(--accent)');
  });

  it('puts a tooltip on the ring and names it for screen readers', () => {
    render(<RingTile value={19.4} max={22.4} colour={2} label="Corporate" />);
    const ring = q('.gp-ring-arc');
    expect(ring.getAttribute('data-tip')).toBe('Corporate: $19.4M of $22.4M bar · 87%');
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe(
      'Corporate: $19.4M of $22.4M bar · 87%',
    );
  });

  it('respects reduced motion: the ring transition is switched off', () => {
    expect(gaugeCss).toMatch(/\.gp-ring-arc \{ transition: stroke-dasharray var\(--motion-roll\)/);
    const reduced = gaugeCss.slice(gaugeCss.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduced).toContain('.gp-ring-arc { transition: none; }');
  });

  it('lays out side content in a ring row', () => {
    render(
      <RingTile value={40.9} max={49.9} colour={3}>
        <span>$40.9M</span>
      </RingTile>,
    );
    const row = q<HTMLElement>('.gp-ring-row');
    expect(row.querySelector('svg.gp-ring')).toBeTruthy();
    expect(row.textContent).toContain('$40.9M');
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <div>
        {[0, 1, 2, 3].map((i) => (
          <RingTile key={i} value={20 + i} max={30} colour={i} label={`VP ${i + 1}`} />
        ))}
      </div>,
    );
    const res = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(res.violations).toEqual([]);
  });
});

describe('no formulas or business rules', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const sources = readdirSync(here)
    .filter((f) => /\.tsx?$/.test(f) && !f.includes('.test.'))
    .map((f) => [f, readFileSync(join(here, f), 'utf8')] as const);

  it('imports nothing from tier 2 or tier 3, and computes no bar, gap or scale max', () => {
    for (const [file, src] of sources) {
      expect(src, file).not.toMatch(/tier2-logic|tier3-data|@glidepath\/(engine|domain|server)/);
      // The prototype derived the scale max from net and bar (`* 1.18`); here max is a prop.
      expect(src, file).not.toMatch(/1\.18|Math\.max\(\s*180/);
      expect(src, file).not.toMatch(/net\s*-\s*bar|bar\s*-\s*net/);
    }
  });
});
