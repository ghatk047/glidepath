// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fireEvent, render, screen, cleanup } from '@testing-library/react';
import type { CellKey } from '@glidepath/api-contract';
import axe from 'axe-core';
import { scaleLinear } from 'd3-scale';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fmt } from '../../format';
import {
  BRIDGE_PLOT,
  BRIDGE_TICK_COUNT,
  BRIDGE_VIEWBOX,
  Bridge,
  bridgeCss,
  bridgeDomain,
  type BridgeProps,
  type BridgeStep,
} from './index';

afterEach(cleanup);

const cell = (k: string) => k as CellKey;

/** Cockpit C "CY26 → CY27 outlay" (03_screens), shaped like the CON-02 `bridge` view payload. */
const view = (): BridgeProps => ({
  steps: [
    { key: 'base', cell: cell('base.total[]'), value: 1007.6, from: 0, to: 1007.6 },
    { key: 'growth', cell: cell('base.headwinds[]'), value: 43.0, from: 1007.6, to: 1050.6 },
    { key: 'savings', cell: cell('res.tot_iy[]'), value: -138.8, from: 1050.6, to: 911.8 },
    { key: 'oneTime', cell: cell('res.tot_ot_it[]'), value: 19.6, from: 911.8, to: 931.3 },
    { key: 'outlay', cell: cell('res.cy27_outlay[]'), value: 931.3, from: 0, to: 931.3 },
  ],
  targetOutlay: 907.6,
  gap: 23.7,
});

const KEYS = ['base', 'growth', 'savings', 'oneTime', 'outlay'] as const;
const num = (el: Element | null | undefined, attr: string) => Number(el?.getAttribute(attr));
const q = (sel: string) => document.querySelector(sel);
const qa = (sel: string) => Array.from(document.querySelectorAll(sel));
const bar = (key: string) => q(`rect[data-step="${key}"]`);
/** The y scale the test expects: d3 linear, plot bottom → top, clamped to the axis domain. */
const yOf = (domain: readonly [number, number]) =>
  scaleLinear().domain(domain).range([BRIDGE_PLOT.bottom, BRIDGE_PLOT.top]).clamp(true);
/** CSS body of a rule in bridgeCss. */
const rule = (selector: string) => {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return bridgeCss.match(new RegExp(`(?:^|\\n)${esc} \\{([^}]*)\\}`))?.[1] ?? '';
};

describe('UI-13 Bridge / waterfall (#19): SVG structure', () => {
  it('axis-break glyph, connectors, dashed target outlay line, red gap bracket, direct labels (test: SVG structure)', () => {
    const props = view();
    const domain = bridgeDomain(props);
    const y = yOf(domain);
    render(<Bridge {...props} />);

    const svg = q('svg.gp-bridge')!;
    expect(svg.getAttribute('viewBox')).toBe(
      `0 0 ${BRIDGE_VIEWBOX.width} ${BRIDGE_VIEWBOX.height}`,
    );

    // axis-break glyph: a zigzag on the value axis at the floor
    const brk = q('path[data-part="axis-break"]')!;
    expect(brk).not.toBeNull();
    expect(brk.getAttribute('d')).toMatch(/^M[\d.]+ [\d.]+l/);
    expect(brk.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(rule('.gp-bridge-break')).toContain('fill: none');

    // five bars in contract order
    expect(qa('rect[data-step]').map((r) => r.getAttribute('data-step'))).toEqual([...KEYS]);

    // connectors: dotted, from the end of each bar to the start of the next, at that step's `to`
    const connectors = qa('line[data-part="connector"]');
    expect(connectors).toHaveLength(KEYS.length - 1);
    connectors.forEach((ln, i) => {
      const a = bar(KEYS[i]!)!;
      const b = bar(KEYS[i + 1]!)!;
      expect(num(ln, 'x1')).toBeCloseTo(num(a, 'x') + num(a, 'width'), 6);
      expect(num(ln, 'x2')).toBeCloseTo(num(b, 'x'), 6);
      expect(num(ln, 'y1')).toBeCloseTo(y(props.steps[i]!.to), 6);
      expect(num(ln, 'y2')).toBeCloseTo(y(props.steps[i]!.to), 6);
    });
    expect(rule('.gp-bridge-connector')).toContain('stroke-dasharray');

    // dashed target outlay line across the plot
    const target = q('line[data-part="target"]')!;
    expect(target.getAttribute('class')).toBe('gp-bridge-target');
    expect(num(target, 'x1')).toBe(BRIDGE_PLOT.left);
    expect(num(target, 'x2')).toBe(BRIDGE_PLOT.right);
    expect(num(target, 'y1')).toBeCloseTo(y(props.targetOutlay), 6);
    expect(num(target, 'y2')).toBeCloseTo(y(props.targetOutlay), 6);
    expect(rule('.gp-bridge-target')).toMatch(/stroke-dasharray: \d/);

    // red gap bracket right of the CY27 bar, from the outlay level down to the target line
    const gap = q('path[data-part="gap"]')!;
    expect(gap.getAttribute('class')).toBe('gp-bridge-gap');
    expect(rule('.gp-bridge-gap')).toContain('stroke: var(--neg)');
    const out = bar('outlay')!;
    const d = gap.getAttribute('d')!;
    const [, mx, my, vlen] = d.match(/^M([\d.]+) ([\d.]+)h[\d.]+v(-?[\d.]+)h-[\d.]+$/)!;
    expect(Number(mx)).toBeGreaterThan(num(out, 'x') + num(out, 'width'));
    expect(Number(my)).toBeCloseTo(y(props.steps[4].to), 6);
    expect(Number(my) + Number(vlen)).toBeCloseTo(y(props.targetOutlay), 6);
    expect(gap.closest('[role="img"]')?.getAttribute('aria-label')).toBe(
      'Gap to target outlay $23.7M',
    );

    // direct labels: value above each bar, category under the axis, target label under the line
    expect(qa('text[data-part="value"]').map((t) => t.textContent)).toEqual([
      '$1,007.6M',
      '+$43.0M',
      '−$138.8M',
      '+$19.6M',
      '$931.3M',
    ]);
    expect(qa('text[data-part="category"]').map((t) => t.textContent)).toEqual([
      'CY26 base',
      'Cost growth',
      'Savings',
      'One-time in IT',
      'CY27 outlay',
    ]);
    qa('text[data-part="value"]').forEach((t, i) => {
      const r = bar(KEYS[i]!)!;
      expect(num(t, 'x')).toBeCloseTo(num(r, 'x') + num(r, 'width') / 2, 6);
      expect(num(t, 'y')).toBeLessThan(num(r, 'y'));
    });
    expect(q('text[data-part="target-label"]')!.textContent).toBe('Target outlay $907.6M');

    // value axis: gridlines with grouped labels inside the domain
    const ticks = qa('text[data-part="tick"]').map((t) => t.textContent);
    expect(ticks).toEqual(y.ticks(BRIDGE_TICK_COUNT).map((v) => fmt.fte(v)));
    expect(ticks.length).toBeGreaterThan(2);
  });

  it('draws no gap bracket when the outlay is at or under the target', () => {
    render(<Bridge {...view()} gap={0} />);
    expect(q('path[data-part="gap"]')).toBeNull();
    cleanup();
    render(<Bridge {...view()} gap={-4.2} />);
    expect(q('path[data-part="gap"]')).toBeNull();
    expect(q('line[data-part="target"]')).not.toBeNull();
  });

  it('every mark carries a tooltip and an accessible name; labels can be overridden', () => {
    render(
      <Bridge
        {...view()}
        labels={{ base: { label: 'FY26 base' }, outlay: { label: 'FY27 outlay', hint: 'Plan' } }}
      />,
    );
    const group = screen.getByRole('group', { name: 'Bridge from FY26 base to FY27 outlay' });
    expect(group.tagName.toLowerCase()).toBe('svg');
    expect(screen.getByRole('img', { name: 'FY26 base $1,007.6M' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Cost growth +$43.0M' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Savings −$138.8M' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'One-time in IT +$19.6M' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'FY27 outlay $931.3M' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Target outlay $907.6M' })).toBeTruthy();
    const titles = qa('g[data-step] > title').map((t) => t.textContent);
    expect(titles[4]).toBe('FY27 outlay $931.3M · Plan');
    expect(titles[1]).toBe('Cost growth +$43.0M · Status-quo CY27 growth to absorb');
    // no interactive marks without onStep
    expect(qa('[role="button"]')).toHaveLength(0);
  });

  it('with onStep, bars are keyboard buttons that hand back the step and its cell (trace drawer)', () => {
    const onStep = vi.fn<(s: BridgeStep) => void>();
    render(<Bridge {...view()} onStep={onStep} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(5);
    buttons.forEach((b) => expect(b.getAttribute('tabindex')).toBe('0'));
    fireEvent.keyDown(screen.getByRole('button', { name: 'Savings −$138.8M' }), { key: 'Enter' });
    fireEvent.keyDown(screen.getByRole('button', { name: 'Cost growth +$43.0M' }), { key: ' ' });
    fireEvent.click(screen.getByRole('button', { name: 'CY27 outlay $931.3M' }));
    fireEvent.keyDown(screen.getByRole('button', { name: 'CY26 base $1,007.6M' }), { key: 'a' });
    expect(onStep.mock.calls.map(([s]) => s.cell)).toEqual([
      'res.tot_iy[]',
      'base.headwinds[]',
      'res.cy27_outlay[]',
    ]);
  });

  it('has no axe violations (static and interactive)', async () => {
    const { container, rerender } = render(<Bridge {...view()} />);
    let res = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(res.violations).toEqual([]);
    rerender(<Bridge {...view()} onStep={() => {}} />);
    res = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(res.violations).toEqual([]);
  });

  it('styles come from tokens: theme colour vars, no hex, no raw px', () => {
    expect(bridgeCss).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(bridgeCss).not.toMatch(/\dpx\b/);
    expect(rule('.gp-bridge-bar[data-step="growth"]')).toContain('var(--neg)');
    expect(rule('.gp-bridge-bar[data-step="savings"]')).toContain('var(--accent)');
    expect(rule('.gp-bridge-bar[data-step="oneTime"]')).toContain('var(--warn)');
    expect(rule('.gp-bridge-bar[data-step="base"], .gp-bridge-bar[data-step="outlay"]')).toContain(
      'var(--total)',
    );
    expect(rule('.gp-bridge-grid')).toContain('var(--chart-grid)');
    expect(bridgeCss).toContain('prefers-reduced-motion');
  });
});

describe('UI-13 Bridge: extents are d3 scale mappings of props only', () => {
  it('bar extents are d3 scale mappings of props only (test)', () => {
    const props = view();
    const domain = [840, 1080] as const;
    const y = yOf(domain);
    render(<Bridge {...props} domain={domain} />);
    props.steps.forEach((s) => {
      const r = bar(s.key)!;
      const top = Math.min(y(s.from), y(s.to));
      const bottom = Math.max(y(s.from), y(s.to));
      expect(num(r, 'y')).toBeCloseTo(top, 6);
      expect(num(r, 'y') + num(r, 'height')).toBeCloseTo(bottom, 6);
    });
    // totals stand on the axis floor: from = 0 clamps to the plot bottom (the axis break)
    expect(num(bar('base'), 'y') + num(bar('base'), 'height')).toBeCloseTo(BRIDGE_PLOT.bottom, 6);
    // bars share one band: equal widths, increasing x
    const xs = KEYS.map((k) => num(bar(k), 'x'));
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
    expect(new Set(KEYS.map((k) => num(bar(k), 'width'))).size).toBe(1);
  });

  it('bars follow from/to only: step values are labels, never summed into geometry', () => {
    const props = view();
    const domain = [840, 1080] as const;
    render(<Bridge {...props} domain={domain} />);
    const geom = () => KEYS.map((k) => [num(bar(k), 'y'), num(bar(k), 'height')]);
    const before = geom();
    cleanup();
    const odd = view();
    odd.steps = odd.steps.map((s) => ({ ...s, value: 1 })) as unknown as BridgeProps['steps'];
    render(<Bridge {...odd} domain={domain} gap={999} />);
    expect(geom()).toEqual(before);
    // gap is not drawn from props.gap: the bracket still runs outlay.to → targetOutlay
    const y = yOf(domain);
    const d = q('path[data-part="gap"]')!.getAttribute('d')!;
    const [, , my, vlen] = d.match(/^M([\d.]+) ([\d.]+)h[\d.]+v(-?[\d.]+)/)!;
    expect(Number(my) + Number(vlen)).toBeCloseTo(y(props.targetOutlay), 6);
  });

  it('default domain is a d3 nice() of the plotted extents with one tick of floor below; domain prop wins', () => {
    const props = view();
    const [lo, hi] = bridgeDomain(props);
    // every plotted extent sits inside the axis, strictly above the floor (room for the break)
    const extents = [
      ...props.steps.slice(1, 4).flatMap((s) => [s.from, s.to]),
      props.steps[0].to,
      props.steps[4].to,
      props.targetOutlay,
    ];
    extents.forEach((v) => {
      expect(v).toBeGreaterThan(lo);
      expect(v).toBeLessThanOrEqual(hi);
    });
    expect(scaleLinear().domain([lo, hi]).nice(BRIDGE_TICK_COUNT).domain()).toEqual([lo, hi]);
    // one gridline step of room under the lowest plotted value
    expect(scaleLinear().domain([lo, hi]).ticks(BRIDGE_TICK_COUNT)[0]).toBe(lo);
    render(<Bridge {...props} domain={[840, 1080]} />);
    expect(num(bar('growth'), 'y')).toBeCloseTo(yOf([840, 1080])(props.steps[1].to), 6);
  });

  it('source has no formulas over prop values (lint guard: no arithmetic on value/from/to/targetOutlay/gap, no sums)', () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    for (const f of ['Bridge.tsx', 'layout.ts']) {
      const src = readFileSync(join(dir, f), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      const fields = '(?:value|from|to|targetOutlay|gap)';
      expect(src, f).not.toMatch(new RegExp(`\\.${fields}\\s*[-+*/%]`));
      expect(src, f).not.toMatch(new RegExp(`[-+*/%]\\s*[\\w.]*\\.${fields}\\b(?!\\s*\\()`));
      expect(src, f).not.toMatch(/\.reduce\(|\bsum\(|\bfsum\(/);
    }
  });
});
