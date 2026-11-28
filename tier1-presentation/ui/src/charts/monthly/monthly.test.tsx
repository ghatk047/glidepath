// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { LeversMonthlyView } from '@glidepath/api-contract';
import axe from 'axe-core';
import { scaleLinear } from 'd3-scale';
import { afterEach, describe, expect, it } from 'vitest';
import { Tooltip } from '../../overlays/drawer';
import {
  MONTHLY_PLOT,
  MONTHLY_TICK_COUNT,
  MONTHLY_VIEWBOX,
  MonthlyCurve,
  monthlyCss,
  monthlyDomain,
  stackFamilies,
} from './index';

afterEach(cleanup);

const key = (k: string) => k as LeversMonthlyView['levers'][number]['key'];
/** Shaped like the CON-02 `levers.monthly` payload: three families, a few levers. */
const series = (): LeversMonthlyView => ({
  families: [
    { key: 'labour', values: [0, 1, 2, 4, 6, 8, 9, 10, 11, 12, 12, 12] },
    { key: 'technology', values: [0, 0, 1, 1, 2, 3, 4, 5, 6, 6, 7, 7] },
    { key: 'platforms', values: [0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3] },
  ],
  levers: [
    { key: key('L01'), family: 'labour', values: [0, 1, 1, 2, 3, 4, 5, 5, 6, 6, 6, 6] },
    { key: key('L09'), family: 'technology', values: [0, 0, 1, 1, 1, 2, 2, 3, 3, 3, 4, 4] },
  ],
});
const LABELS = { labour: 'Labour', technology: 'Technology', platforms: 'Platforms & avoidance' };

const num = (el: Element | null | undefined, attr: string) => Number(el?.getAttribute(attr));
const q = (sel: string) => document.querySelector(sel);
const qa = (sel: string) => Array.from(document.querySelectorAll(sel));
const rule = (selector: string) => {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return monthlyCss.match(new RegExp(`(?:^|\\n)${esc} \\{([^}]*)\\}`))?.[1] ?? '';
};
const yOf = (domain: readonly [number, number]) =>
  scaleLinear().domain(domain).range([MONTHLY_PLOT.bottom, MONTHLY_PLOT.top]).clamp(true);
const xOf = (n: number) =>
  scaleLinear()
    .domain([0, n - 1])
    .range([MONTHLY_PLOT.left, MONTHLY_PLOT.right]);
/** Parse an outline `M x y L x y ...` into points. */
const points = (d: string) =>
  Array.from(d.matchAll(/[ML]([\d.]+) ([\d.]+)/g)).map((m) => [Number(m[1]), Number(m[2])] as const);

describe('UI-17 MonthlyCurve (#26): structure', () => {
  it('stacked area by family with direct labels; selected lever as an ink line with an end dot (test)', () => {
    const props = series();
    const domain = monthlyDomain(props, props.levers[0]);
    const y = yOf(domain);
    const x = xOf(12);
    render(<MonthlyCurve series={props} selected="L01" labels={LABELS} />);

    const svg = q('svg.gp-monthly')!;
    expect(svg.getAttribute('viewBox')).toBe(
      `0 0 ${MONTHLY_VIEWBOX.width} ${MONTHLY_VIEWBOX.height}`,
    );

    // one closed area per family, in contract order, each a token colour slot
    const areas = qa('path.gp-monthly-area');
    expect(areas.map((a) => a.getAttribute('data-family'))).toEqual([
      'labour',
      'technology',
      'platforms',
    ]);
    expect(areas.map((a) => a.getAttribute('data-slot'))).toEqual(['0', '1', '2']);
    expect(rule('.gp-monthly-area[data-slot="0"]')).toContain('var(--sequential-3)');
    expect(rule('.gp-monthly-area[data-slot="1"]')).toContain('var(--sequential-2)');
    expect(rule('.gp-monthly-area[data-slot="2"]')).toContain('var(--accent)');
    areas.forEach((a) => expect(a.getAttribute('d')).toMatch(/^M[\d. L]+Z$/));

    // stacked: each band's top edge sits on the cumulative family values (d3 y of the stack)
    const bands = stackFamilies(props.families);
    areas.forEach((a, i) => {
      const pts = points(a.getAttribute('d')!);
      const top = pts.slice(0, 12);
      const base = pts.slice(12).reverse();
      top.forEach(([px, py], m) => {
        expect(px).toBeCloseTo(x(m), 0);
        expect(py).toBeCloseTo(y(bands[i]!.upper[m]!), 0);
      });
      base.forEach(([, py], m) => expect(py).toBeCloseTo(y(bands[i]!.lower[m]!), 0));
    });
    // the second band stands on the first band's top
    expect(bands[1]!.lower).toEqual(bands[0]!.upper);

    // direct labels: family names at the right edge, mid-band, no legend
    const labels = qa('text[data-part="family-label"]');
    expect(labels.map((t) => t.textContent)).toEqual(['Labour', 'Technology', 'Platforms & avoidance']);
    labels.forEach((t, i) => {
      const mid = (y(bands[i]!.lower[11]!) + y(bands[i]!.upper[11]!)) / 2;
      expect(num(t, 'y')).toBeCloseTo(mid + 4, 6);
      expect(t.getAttribute('text-anchor')).toBe('end');
    });

    // selected lever: ink line over the areas, with an end dot at the last month
    const line = q('path[data-part="line"]')!;
    expect(rule('.gp-monthly-line')).toContain('stroke: var(--ink)');
    expect(rule('.gp-monthly-line')).toContain('fill: none');
    const lp = points(line.getAttribute('d')!);
    expect(lp).toHaveLength(12);
    lp.forEach(([px, py], m) => {
      expect(px).toBeCloseTo(x(m), 0);
      expect(py).toBeCloseTo(y(props.levers[0]!.values[m]!), 0);
    });
    const dot = q('circle[data-part="end-dot"]')!;
    expect(rule('.gp-monthly-end')).toContain('fill: var(--ink)');
    expect(num(dot, 'cx')).toBeCloseTo(x(11), 6);
    expect(num(dot, 'cy')).toBeCloseTo(y(props.levers[0]!.values[11]!), 6);
    // drawn after (above) the areas
    const all = qa('path.gp-monthly-area, path[data-part="line"]');
    expect(all[all.length - 1]).toBe(line);

    // axis: month letters and gridlines from d3 ticks
    expect(qa('text[data-part="month"]').map((t) => t.textContent).join('')).toBe('JFMAMJJASOND');
    expect(qa('text[data-part="tick"]').map((t) => t.textContent)).toEqual(
      y.ticks(MONTHLY_TICK_COUNT).map(String),
    );
  });

  it('leaves out the label of a band too thin to hold it; the area keeps its name', () => {
    const thin: LeversMonthlyView = {
      families: [
        { key: 'labour', values: [0, 2, 4, 6, 8, 10, 12, 12, 12, 12, 12, 12] },
        { key: 'sliver', values: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.2] },
        { key: 'technology', values: [0, 1, 2, 3, 4, 5, 6, 7, 8, 8, 8, 8] },
      ],
      levers: [],
    };
    render(<MonthlyCurve series={thin} labels={{ ...LABELS, sliver: 'Sliver' }} />);
    expect(qa('text[data-part="family-label"]').map((t) => t.textContent)).toEqual(['Labour', 'Technology']);
    expect(q('path[data-family="sliver"]')!.getAttribute('aria-label')).toMatch(/^Sliver /);
  });

  it('draws no line or dot when nothing (or an unknown lever) is selected', () => {
    render(<MonthlyCurve series={series()} />);
    expect(q('path[data-part="line"]')).toBeNull();
    expect(q('circle[data-part="end-dot"]')).toBeNull();
    cleanup();
    render(<MonthlyCurve series={series()} selected="L99" />);
    expect(q('path[data-part="line"]')).toBeNull();
  });

  it('switching the selected lever moves the line to that lever series', () => {
    const props = series();
    const { rerender } = render(<MonthlyCurve series={props} selected="L01" domain={[0, 30]} />);
    const dotY = () => num(q('circle[data-part="end-dot"]'), 'cy');
    const first = dotY();
    rerender(<MonthlyCurve series={props} selected="L09" domain={[0, 30]} />);
    expect(dotY()).toBeCloseTo(yOf([0, 30])(props.levers[1]!.values[11]!), 6);
    expect(dotY()).not.toBeCloseTo(first, 3);
  });
});

describe('UI-17 MonthlyCurve: series come from props', () => {
  it('series come from props (tier-2 view levers.monthly) (test)', () => {
    const props = series();
    const domain = [0, 40] as const;
    const y = yOf(domain);
    const x = xOf(12);
    render(<MonthlyCurve series={props} selected="L09" domain={domain} />);
    const before = qa('path.gp-monthly-area').map((a) => a.getAttribute('d'));
    const dBefore = q('path[data-part="line"]')!.getAttribute('d');
    cleanup();

    // a different payload gives different geometry, mapped by the d3 scales and nothing else
    const other: LeversMonthlyView = {
      families: [{ key: 'only', values: Array.from({ length: 12 }, (_, i) => i * 2) }],
      levers: [{ key: key('L01'), family: 'only', values: Array.from({ length: 12 }, () => 5) }],
    };
    render(<MonthlyCurve series={other} selected="L01" domain={domain} />);
    expect(qa('path.gp-monthly-area')).toHaveLength(1);
    expect(qa('path.gp-monthly-area')[0]!.getAttribute('d')).not.toBe(before[0]);
    expect(q('path[data-part="line"]')!.getAttribute('d')).not.toBe(dBefore);
    const pts = points(q('path[data-part="line"]')!.getAttribute('d')!);
    pts.forEach(([px, py], m) => {
      expect(px).toBeCloseTo(x(m), 0);
      expect(py).toBeCloseTo(y(5), 0);
    });
    // no label copy for the key: the key itself is shown, nothing is invented
    expect(q('text[data-part="family-label"]')!.textContent).toBe('only');
  });

  it('family areas follow the family series; lever series never change the stack', () => {
    const domain = [0, 40] as const;
    render(<MonthlyCurve series={series()} selected="L01" domain={domain} />);
    const stack = qa('path.gp-monthly-area').map((a) => a.getAttribute('d'));
    cleanup();
    const odd = series();
    odd.levers = odd.levers.map((l) => ({ ...l, values: l.values.map(() => 1) }));
    render(<MonthlyCurve series={odd} selected="L01" domain={domain} />);
    expect(qa('path.gp-monthly-area').map((a) => a.getAttribute('d'))).toEqual(stack);
  });

  it('default axis is a d3 nice() from zero to the highest stack top or selected value', () => {
    const props = series();
    const [lo, hi] = monthlyDomain(props);
    expect(lo).toBe(0);
    expect(hi).toBeGreaterThanOrEqual(22);
    expect(scaleLinear().domain([lo, hi]).nice(MONTHLY_TICK_COUNT).domain()).toEqual([lo, hi]);
    // a selected line above the stack widens the axis
    const high = { values: Array.from({ length: 12 }, () => 100) };
    expect(monthlyDomain(props, high)[1]).toBeGreaterThanOrEqual(100);
    expect(monthlyDomain({ families: [] })).toEqual([0, 1]);
  });

  it('renders an empty axis for an empty series', () => {
    render(<MonthlyCurve series={{ families: [], levers: [] }} />);
    expect(qa('path.gp-monthly-area')).toHaveLength(0);
    expect(q('svg.gp-monthly')).not.toBeNull();
  });
});

describe('UI-17 MonthlyCurve: accessibility and tooltip', () => {
  it('names the chart, each family area and the selected line; areas show the shared tooltip', () => {
    render(
      <>
        <MonthlyCurve series={series()} selected="L01" labels={{ ...LABELS, L01: 'Crew scheduling' }} />
        <Tooltip />
      </>,
    );
    expect(
      screen.getByRole('group', { name: 'Monthly savings by lever family' }).tagName.toLowerCase(),
    ).toBe('svg');
    expect(screen.getByRole('img', { name: 'Labour Dec $12.0M/mo' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Technology Dec $7.0M/mo' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Crew scheduling Dec $6.0M/mo' })).toBeTruthy();
    const area = qa('path.gp-monthly-area')[1]!;
    expect(area.getAttribute('tabindex')).toBe('0');
    fireEvent.pointerEnter(area, { clientX: 10, clientY: 10 });
    const tip = screen.getByRole('tooltip');
    expect(tip.textContent).toBe('TechnologyDec $7.0M/mo');
    fireEvent.pointerLeave(area);
    expect(screen.getByRole('tooltip').textContent).toBe('');
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <MonthlyCurve series={series()} selected="L09" labels={LABELS} title="Monthly savings in 2027" />,
    );
    const res = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(res.violations).toEqual([]);
  });

  it('styles come from tokens: theme colour vars, no hex, no raw px', () => {
    expect(monthlyCss).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(monthlyCss).not.toMatch(/\dpx\b/);
    expect(rule('.gp-monthly-grid')).toContain('var(--chart-grid)');
    expect(rule('.gp-monthly-end')).toContain('stroke: var(--ground)');
    expect(monthlyCss).toContain('prefers-reduced-motion');
  });
});

describe('UI-17 MonthlyCurve: no formulas', () => {
  it('source has no formulas over prop values (lint guard: no arithmetic on values, no sums)', () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    for (const f of ['MonthlyCurve.tsx', 'layout.ts']) {
      const src = readFileSync(join(dir, f), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      expect(src, f).not.toMatch(/\.reduce\(|\bsum\(|\bfsum\(|\bmean\(|\bmedian\(|\bMath\.(max|min)\(/);
      expect(src, f).not.toMatch(/\.values\s*[-+*/%]/);
      expect(src, f).not.toMatch(/[-+*/%]\s*[\w.]*\.values\b(?!\s*\()/);
    }
    // the only accumulation is the stacking baseline in layout.ts (one `+` over a family value)
    const layout = readFileSync(join(dir, 'layout.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(layout.match(/lower\[m\]! \+ v/g)).toHaveLength(1);
    expect(layout).not.toMatch(/\+=/);
  });
});
