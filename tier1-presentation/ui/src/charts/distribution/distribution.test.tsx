// @vitest-environment jsdom
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, describe, expect, it } from 'vitest';
import { cssVar } from '../../tokens';
import {
  Histogram,
  Tornado,
  chartsDistCss,
  type HistogramBin,
  type TornadoItem,
} from '.';

afterEach(cleanup);

/** Bins as tier 2 would send them: width 5 from 20 to 170, counts peaking near the middle. */
const COUNTS = [1, 2, 3, 5, 8, 12, 18, 26, 36, 48, 60, 72, 84, 90, 88, 80, 70, 58, 46, 34, 24, 16, 10, 6, 4, 2, 1, 1, 0, 0];
const BINS: HistogramBin[] = COUNTS.map((count, i) => ({ from: 20 + i * 5, to: 25 + i * 5, count }));

const hist = (over: Partial<Parameters<typeof Histogram>[0]> = {}) => (
  <Histogram bins={BINS} p10={63} p50={102} p90={136} bar={143} {...over} />
);
const binEls = (c: ParentNode) => [...c.querySelectorAll<SVGRectElement>('rect.gp-hist-bin')];

const ITEMS: TornadoItem[] = [
  { variableId: 'g.ot_out_share', label: 'One-time funded outside IT', swing: 39.1, category: 'policy' },
  { variableId: 'g.ot_in_year', label: 'One-time incurred in CY27', swing: 19.55, category: 'timing' },
  { variableId: 'g.head_start', label: 'Head start (months)', swing: 16.61, category: 'timing' },
  { variableId: 'lev.L10.ren', label: 'Share renewing in 2027', swing: 15.61, category: 'lever' },
  { variableId: 'portfolio.app_cost', label: 'App run cost', swing: 14.36, category: 'lever' },
  { variableId: 'lev.L10.shelf', swing: 14.51, category: 'lever' },
];
const rowEls = (c: ParentNode) => [...c.querySelectorAll<SVGGElement>('g[data-part="row"]')];

describe('Histogram (#21)', () => {
  it('Histogram: bins past the bar in status green, P labels under the axis, uses the sample/bin array from props', () => {
    const { container } = render(hist());
    const bins = binEls(container);
    // one rect per bin from props, in order
    expect(bins).toHaveLength(BINS.length);
    // bin tone follows the bar: centre >= 143 is green, everything before is the base colour
    const tones = bins.map((b) => b.getAttribute('data-tone'));
    const firstGreen = BINS.findIndex((b) => (b.from + b.to) / 2 >= 143);
    expect(tones.slice(0, firstGreen).every((t) => t === 'base')).toBe(true);
    expect(tones.slice(firstGreen).every((t) => t === 'pos')).toBe(true);
    expect(tones.filter((t) => t === 'pos')).toHaveLength(BINS.length - firstGreen);
    // green resolves to the status token, base to the accent token
    expect(chartsDistCss).toContain(`.gp-hist-bin[data-tone="pos"] { fill: ${cssVar['themes.cruise.color.pos']}`);
    expect(chartsDistCss).toContain(`.gp-hist-bin { fill: ${cssVar['themes.cruise.color.accent']}`);
    // heights come from the counts handed in: the tallest count fills the plot, a zero bin is flat
    const heights = bins.map((b) => Number(b.getAttribute('height')));
    const tallest = COUNTS.indexOf(Math.max(...COUNTS));
    expect(heights[tallest]).toBe(Math.max(...heights));
    expect(heights.at(-1)).toBe(0);
    expect(heights[1]! / heights[tallest]!).toBeCloseTo(COUNTS[1]! / COUNTS[tallest]!, 6);
    // P labels sit under the axis (below the bar baseline), in P10 < P50 < P90 order
    const labels = [...container.querySelectorAll<SVGTextElement>('[data-part="p-label"]')];
    expect(labels.map((l) => l.textContent)).toEqual(['P10 63', 'P50 102', 'P90 136']);
    const baseline = Math.max(...bins.map((b) => Number(b.getAttribute('y')) + Number(b.getAttribute('height'))));
    for (const l of labels) expect(Number(l.getAttribute('y'))).toBeGreaterThan(baseline);
    const xs = labels.map((l) => Number(l.getAttribute('x')));
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    // the bar line is labelled
    expect(container.querySelector('[data-part="bar"]')?.textContent).toBe('Bar');
  });

  it('draws whatever bins it is handed (no resampling) and recolours when the bar moves', () => {
    const three: HistogramBin[] = [
      { from: 0, to: 10, count: 5 },
      { from: 10, to: 20, count: 10 },
      { from: 20, to: 30, count: 5 },
    ];
    const { container, rerender } = render(hist({ bins: three, bar: 15, p10: 5, p50: 15, p90: 25 }));
    expect(binEls(container).map((b) => b.getAttribute('data-tone'))).toEqual(['base', 'pos', 'pos']);
    rerender(hist({ bins: three, bar: 25, p10: 5, p50: 15, p90: 25 }));
    expect(binEls(container).map((b) => b.getAttribute('data-tone'))).toEqual(['base', 'base', 'pos']);
  });

  it('degrades: no bins gives an empty labelled chart; a missing bar or P value draws no line or label', () => {
    const empty = render(hist({ bins: [] }));
    const svg = empty.container.querySelector('svg')!;
    expect(svg.getAttribute('data-empty')).toBe('true');
    expect(svg.getAttribute('aria-label')).toMatch(/no data yet/);
    cleanup();
    const { container } = render(hist({ bar: null, p50: undefined }));
    expect(container.querySelector('[data-part="bar"]')).toBeNull();
    expect(binEls(container).every((b) => b.getAttribute('data-tone') === 'base')).toBe(true);
    expect([...container.querySelectorAll('[data-part="p-label"]')].map((l) => l.textContent)).toEqual(['P10 63', 'P90 136']);
  });

  it('names itself and describes the percentiles for screen readers; bins carry a title', () => {
    const { container } = render(hist());
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('role')).toBe('img');
    expect(svg.getAttribute('aria-label')).toBe('Distribution of net savings');
    expect(svg.querySelector('desc')!.textContent).toBe('P10 63, P50 102, P90 136, bar 143');
    expect(binEls(container).at(-1)!.querySelector('title')!.textContent).toMatch(/past the bar/);
  });

  it('has no axe violations', async () => {
    const { container } = render(hist());
    const res = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(res.violations).toEqual([]);
  });
});

describe('Tornado (#22)', () => {
  it('Tornado: sorted as given, amber for policy/timing category, blue for levers (category from props)', () => {
    const { container } = render(<Tornado items={ITEMS} />);
    const rows = rowEls(container);
    // order is the order of props, even where swings are not descending (14.51 after 14.36)
    expect(rows.map((r) => r.getAttribute('data-variable-id'))).toEqual(ITEMS.map((i) => i.variableId));
    // category comes from props
    expect(rows.map((r) => r.querySelector('rect')!.getAttribute('data-category'))).toEqual([
      'policy',
      'timing',
      'timing',
      'lever',
      'lever',
      'lever',
    ]);
    // amber for policy and timing, blue (sequential ramp) for levers, both from tokens
    const amber = cssVar['themes.cruise.color.warn'];
    const blue = cssVar['themes.cruise.color.sequential.2'];
    expect(chartsDistCss).toContain(
      `.gp-tornado-bar[data-category="policy"], .gp-tornado-bar[data-category="timing"] { fill: ${amber}; }`,
    );
    expect(chartsDistCss).toContain(`.gp-tornado-bar { fill: ${blue}; opacity: 0.9; }`);
    // labels: name from props, id as the fallback; values are the swings printed as given
    expect(rows[0]!.querySelector('text')!.textContent).toBe('One-time funded outside IT');
    expect(rows[5]!.querySelector('text')!.textContent).toBe('lev.L10.shelf');
    expect(rows.map((r) => r.querySelector('[data-part="value"]')!.textContent)).toEqual([
      '39.1',
      '19.6',
      '16.6',
      '15.6',
      '14.4',
      '14.5',
    ]);
  });

  it('scales bar length to the swing and to max when given', () => {
    const { container, rerender } = render(<Tornado items={ITEMS} />);
    const w = () => [...container.querySelectorAll('rect.gp-tornado-bar')].map((r) => Number(r.getAttribute('width')));
    const widths = w();
    expect(widths[1]! / widths[0]!).toBeCloseTo(19.55 / 39.1, 6);
    rerender(<Tornado items={ITEMS} max={78.2} />);
    expect(w()[0]!).toBeCloseTo(widths[0]! / 2, 6);
  });

  it('takes the value format from props and shows an empty chart for no items', () => {
    const { container, rerender } = render(<Tornado items={ITEMS.slice(0, 1)} formatValue={(v) => `swing ${v}`} />);
    expect(container.querySelector('[data-part="value"]')!.textContent).toBe('swing 39.1');
    rerender(<Tornado items={[]} />);
    expect(rowEls(container)).toHaveLength(0);
    expect(container.querySelector('svg')!.getAttribute('aria-label')).toMatch(/no data yet/);
  });

  it('carries the category in each bar title so colour is not the only cue', () => {
    const { container } = render(<Tornado items={ITEMS} />);
    expect(rowEls(container)[0]!.querySelector('rect title')!.textContent).toBe('One-time funded outside IT: swing 39.1, policy');
  });

  it('has no axe violations', async () => {
    const { container } = render(<Tornado items={ITEMS} />);
    const res = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(res.violations).toEqual([]);
  });
});

describe('charts/distribution stays presentational (no formulas or business rules)', () => {
  const dir = __dirname;
  const sources = readdirSync(dir)
    .filter((f) => /\.(ts|tsx)$/.test(f))
    .map((f) => ({ f, text: readFileSync(join(dir, f), 'utf8') }));

  it('imports only react-free ui siblings: no tier 2, tier 3 or contract code', () => {
    for (const { f, text } of sources) {
      const imports = [...text.matchAll(/from '([^']+)'/g)].map((m) => m[1]!);
      for (const i of imports) expect(i, f).toMatch(/^(\.\.?\/|react)/);
    }
  });

  it('has no statistics, sorting, hex colours or raw px', () => {
    for (const { f, text } of sources) {
      expect(text, f).not.toMatch(/Math\.(exp|log|sqrt|pow|erf|random)\b/);
      expect(text, f).not.toMatch(/\.sort\(|\.toSorted\(|\.reduce\(/);
      expect(text, f).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(text, f).not.toMatch(/\d\s?px\b/);
    }
  });
});
