// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Profiler } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { BaselineGroupsView } from '@glidepath/api-contract';
import axe from 'axe-core';
import { descending } from 'd3-array';
import { hierarchy, treemap, treemapSquarify } from 'd3-hierarchy';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fmt } from '../../format';
import { Tooltip } from '../../overlays/drawer';
import {
  TREEMAP_CHIP,
  TREEMAP_GAPS,
  TREEMAP_VIEWBOX,
  Treemap,
  treemapCss,
  treemapLayout,
  type TreemapColourBy,
} from './index';

afterEach(cleanup);

type Group = BaselineGroupsView['groups'][number];
type Key = Group['key'];
const key = (k: string) => k as Key;

/** Deterministic pseudo-random amounts (LCG), so the fixture is stable across runs. */
const amounts = (n: number, seed: number) => {
  let s = seed;
  return Array.from({ length: n }, () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return 0.05 + (s / 4294967296) * 40;
  });
};
const CATS = ['locked', 'partly', 'addressable'] as const;

/**
 * Shaped like the CON view `baseline.groups` (by pool): `count` lines over `nGroups` groups. The
 * test builds group values and the total the way tier 2 would; the component never sums.
 */
const view = (count = 30, nGroups = 4): BaselineGroupsView => {
  const values = amounts(count, 7);
  const groups: Group[] = Array.from({ length: nGroups }, (_, gi) => ({
    key: key(`pool_${gi}`),
    label: `Pool ${gi}`,
    value: 0,
    lines: [],
  }));
  values.forEach((v, i) => groups[i % nGroups]!.lines.push({ key: key(`it_${i}`), value: v }));
  groups.forEach((g) => (g.value = g.lines.reduce((a, l) => a + l.value, 0)));
  return { total: groups.reduce((a, g) => a + g.value, 0), groups };
};
const colourFor = (v: BaselineGroupsView): TreemapColourBy => ({
  categories: [
    { key: 'locked', label: 'Locked' },
    { key: 'partly', label: 'Partly addressable' },
    { key: 'addressable', label: 'Addressable' },
  ],
  of: Object.fromEntries(
    v.groups.flatMap((g) => g.lines.map((l, i) => [l.key, CATS[i % 3]!] as const)),
  ),
});

const num = (el: Element | null | undefined, attr: string) => Number(el?.getAttribute(attr));
const q = (sel: string) => document.querySelector(sel);
const qa = (sel: string) => Array.from(document.querySelectorAll(sel));
const rule = (selector: string) => {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return treemapCss.match(new RegExp(`(?:^|\\n)${esc} \\{([^}]*)\\}`))?.[1] ?? '';
};
interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
const box = (el: Element): Box => ({
  x: num(el, 'x'),
  y: num(el, 'y'),
  w: num(el, 'width'),
  h: num(el, 'height'),
});
const EPS = 1e-6;
/** Smallest distance between two boxes that face each other across a vertical or horizontal gap. */
const gaps = (boxes: Box[]) => {
  const out: number[] = [];
  boxes.forEach((a, i) =>
    boxes.forEach((b, j) => {
      if (i === j) return;
      const yOverlap = a.y < b.y + b.h - EPS && b.y < a.y + a.h - EPS;
      const xOverlap = a.x < b.x + b.w - EPS && b.x < a.x + a.w - EPS;
      if (yOverlap && b.x >= a.x + a.w - EPS) out.push(b.x - (a.x + a.w));
      if (xOverlap && b.y >= a.y + a.h - EPS) out.push(b.y - (a.y + a.h));
      // never overlapping
      expect(xOverlap && yOverlap).toBe(false);
    }),
  );
  return out;
};

describe('UI-14 Treemap (#20): structure', () => {
  it('two levels via d3-hierarchy squarify; 2 px gaps between groups, 1 px between cells; label chips on a ground scrim; selected group outlined in ink; click selects (test)', () => {
    const v = view(40, 4);
    const onSelect = vi.fn();
    render(<Treemap groups={v} colourBy={colourFor(v)} selected="pool_1" onSelect={onSelect} />);
    const svg = q('svg.gp-treemap')!;
    expect(svg.getAttribute('viewBox')).toBe(
      `0 0 ${TREEMAP_VIEWBOX.width} ${TREEMAP_VIEWBOX.height}`,
    );

    // two levels: one group per view group, one cell per line, nested
    const groups = qa('g.gp-treemap-group');
    expect(groups).toHaveLength(4);
    expect(qa('rect.gp-treemap-cell')).toHaveLength(40);
    groups.forEach((g) => {
      const k = g.getAttribute('data-group')!;
      const lines = v.groups.find((x) => x.key === k)!.lines.map((l) => l.key);
      expect(
        Array.from(g.querySelectorAll('rect.gp-treemap-cell')).map((c) =>
          c.getAttribute('data-line'),
        ),
      ).toEqual(expect.arrayContaining(lines));
    });

    // the rectangles are d3-hierarchy squarify, tier 2 values as node values, 2 / 1 inner padding
    type D = BaselineGroupsView | Group | Group['lines'][number];
    const tree = hierarchy<D>(v, (d) =>
      'groups' in d ? d.groups : 'lines' in d ? d.lines : undefined,
    )
      .sum((d) => ('lines' in d || 'groups' in d ? 0 : d.value))
      .sort((a, b) => descending(a.value, b.value));
    const ref = treemap<D>()
      .tile(treemapSquarify)
      .size([TREEMAP_VIEWBOX.width, TREEMAP_VIEWBOX.height])
      .paddingInner((n) => (n.depth === 0 ? 2 : 1))(tree);
    for (const leaf of ref.leaves()) {
      const cell = q(`rect.gp-treemap-cell[data-line="${(leaf.data as { key: string }).key}"]`)!;
      expect(num(cell, 'x')).toBeCloseTo(leaf.x0, 6);
      expect(num(cell, 'y')).toBeCloseTo(leaf.y0, 6);
      expect(num(cell, 'width')).toBeCloseTo(leaf.x1 - leaf.x0, 6);
      expect(num(cell, 'height')).toBeCloseTo(leaf.y1 - leaf.y0, 6);
    }
    // groups fill the whole viewBox
    const outlines = qa('rect.gp-treemap-outline').map(box);
    expect(Math.min(...outlines.map((b) => b.x))).toBeCloseTo(0, 6);
    expect(Math.max(...outlines.map((b) => b.x + b.w))).toBeCloseTo(TREEMAP_VIEWBOX.width, 6);
    expect(Math.max(...outlines.map((b) => b.y + b.h))).toBeCloseTo(TREEMAP_VIEWBOX.height, 6);

    // gaps: exactly 2 between neighbouring groups, exactly 1 between neighbouring cells
    expect(TREEMAP_GAPS).toEqual({ group: 2, cell: 1 });
    const gGaps = gaps(outlines);
    expect(gGaps.length).toBeGreaterThan(0);
    expect(Math.min(...gGaps)).toBeCloseTo(2, 6);
    groups.forEach((g) => {
      const cells = Array.from(g.querySelectorAll('rect.gp-treemap-cell')).map(box);
      const o = box(g.querySelector('rect.gp-treemap-outline')!);
      const cGaps = gaps(cells);
      if (cells.length > 1) expect(Math.min(...cGaps)).toBeCloseTo(1, 6);
      // cells sit inside their group
      cells.forEach((c) => {
        expect(c.x).toBeGreaterThanOrEqual(o.x - EPS);
        expect(c.y).toBeGreaterThanOrEqual(o.y - EPS);
        expect(c.x + c.w).toBeLessThanOrEqual(o.x + o.w + EPS);
        expect(c.y + c.h).toBeLessThanOrEqual(o.y + o.h + EPS);
      });
    });

    // label chips: group label (and value when tall) on a ground scrim, inset from the corner
    const chips = qa('g[data-part="chip"]');
    expect(chips.length).toBeGreaterThan(0);
    expect(rule('.gp-treemap-scrim')).toContain('fill: var(--ground)');
    chips.forEach((chip) => {
      const g = chip.closest('g.gp-treemap-group')!;
      const group = v.groups.find((x) => x.key === g.getAttribute('data-group'))!;
      const o = box(g.querySelector('rect.gp-treemap-outline')!);
      const scrim = chip.querySelector('rect.gp-treemap-scrim')!;
      expect(chip.getAttribute('aria-hidden')).toBe('true');
      expect(num(scrim, 'x')).toBeCloseTo(o.x + TREEMAP_CHIP.inset, 6);
      expect(num(scrim, 'y')).toBeCloseTo(o.y + TREEMAP_CHIP.inset, 6);
      expect(num(scrim, 'width')).toBeLessThanOrEqual(o.w - 2 * TREEMAP_CHIP.inset + EPS);
      expect(chip.querySelector('text.gp-treemap-chip-label')!.textContent).toBe(group.label);
      const value = chip.querySelector('text.gp-treemap-chip-value');
      if (o.h > TREEMAP_CHIP.valueMinHeight)
        expect(value!.textContent).toBe(fmt.money(group.value));
      else expect(value).toBeNull();
    });

    // selected group outlined in ink; the others in ground and dimmed
    const sel = q('g.gp-treemap-group[data-group="pool_1"]')!;
    expect(sel.hasAttribute('data-selected')).toBe(true);
    expect(sel.getAttribute('aria-pressed')).toBe('true');
    expect(qa('g.gp-treemap-group[data-selected]')).toHaveLength(1);
    expect(rule('.gp-treemap-group[data-selected] .gp-treemap-outline')).toContain(
      'stroke: var(--ink)',
    );
    expect(rule('.gp-treemap-outline')).toContain('stroke: var(--ground)');
    expect(qa('g.gp-treemap-group[data-dim]')).toHaveLength(3);
    expect(sel.hasAttribute('data-dim')).toBe(false);

    // click selects: the group key goes back through onSelect
    fireEvent.click(q('g.gp-treemap-group[data-group="pool_3"] rect.gp-treemap-cell')!);
    expect(onSelect).toHaveBeenLastCalledWith('pool_3');
    fireEvent.click(q('g.gp-treemap-group[data-group="pool_0"]')!);
    expect(onSelect).toHaveBeenLastCalledWith('pool_0');
  });

  it('keyboard: groups are buttons, Enter and Space select', () => {
    const v = view(12, 3);
    const onSelect = vi.fn();
    render(<Treemap groups={v} colourBy={colourFor(v)} onSelect={onSelect} />);
    const g = q('g.gp-treemap-group[data-group="pool_2"]')!;
    expect(g.getAttribute('role')).toBe('button');
    expect(g.getAttribute('tabindex')).toBe('0');
    expect(g.getAttribute('aria-pressed')).toBe('false');
    fireEvent.keyDown(g, { key: 'Enter' });
    expect(onSelect).toHaveBeenLastCalledWith('pool_2');
    fireEvent.keyDown(q('g.gp-treemap-group[data-group="pool_0"]')!, { key: ' ' });
    expect(onSelect).toHaveBeenLastCalledWith('pool_0');
    expect(onSelect).toHaveBeenCalledTimes(2);
    // nothing selected: nothing outlined in ink, nothing dimmed
    expect(qa('g.gp-treemap-group[data-selected], g.gp-treemap-group[data-dim]')).toHaveLength(0);
  });

  it('without onSelect the groups are static, named groups (no tab stops)', () => {
    const v = view(8, 2);
    render(<Treemap groups={v} colourBy={colourFor(v)} selected="pool_0" />);
    const g = q('g.gp-treemap-group')!;
    expect(g.getAttribute('role')).toBe('group');
    expect(g.hasAttribute('tabindex')).toBe(false);
    expect(g.hasAttribute('aria-pressed')).toBe(false);
  });

  it('cells are coloured by the colourBy category of each line (token slots, in category order)', () => {
    const v = view(9, 3);
    const colour = colourFor(v);
    render(<Treemap groups={v} colourBy={colour} />);
    for (const c of qa('rect.gp-treemap-cell')) {
      const cat = colour.of[c.getAttribute('data-line')!]!;
      expect(c.getAttribute('data-slot')).toBe(String(CATS.indexOf(cat as (typeof CATS)[number])));
    }
    expect(rule('.gp-treemap-cell[data-slot="0"]')).toContain('var(--sequential-1)');
    expect(rule('.gp-treemap-cell[data-slot="1"]')).toContain('var(--sequential-2)');
    expect(rule('.gp-treemap-cell[data-slot="2"]')).toContain('var(--sequential-3)');
    cleanup();
    // a line with no category gets the neutral slot
    render(<Treemap groups={v} colourBy={{ categories: colour.categories, of: {} }} />);
    expect(qa('rect.gp-treemap-cell[data-slot="none"]')).toHaveLength(9);
    expect(rule('.gp-treemap-cell[data-slot="none"]')).toContain('var(--track)');
  });

  it('long labels are cut to fit the chip; small groups get no chip', () => {
    const v = view(20, 2);
    v.groups[0]!.label =
      'A very long cost pool name that cannot possibly fit in a small chip at all';
    render(<Treemap groups={v} colourBy={colourFor(v)} />);
    const label = q('g[data-group="pool_0"] text.gp-treemap-chip-label')!.textContent!;
    expect(label.endsWith('…')).toBe(true);
    expect(label.length).toBeLessThan(v.groups[0]!.label.length);
    cleanup();
    // one huge group, one tiny group: the tiny one has no room for a chip
    const lop: BaselineGroupsView = {
      total: 1001,
      groups: [
        { key: key('big'), label: 'Big', value: 1000, lines: [{ key: key('a'), value: 1000 }] },
        { key: key('tiny'), label: 'Tiny', value: 1, lines: [{ key: key('b'), value: 1 }] },
      ],
    };
    render(<Treemap groups={lop} colourBy={{ categories: [], of: {} }} />);
    expect(q('g[data-group="big"] g[data-part="chip"]')).not.toBeNull();
    expect(q('g[data-group="tiny"] g[data-part="chip"]')).toBeNull();
  });

  it('renders an empty treemap for an empty view and skips non-positive values', () => {
    render(<Treemap groups={{ total: 0, groups: [] }} colourBy={{ categories: [], of: {} }} />);
    expect(qa('g.gp-treemap-group')).toHaveLength(0);
    expect(q('svg.gp-treemap')).not.toBeNull();
    cleanup();
    const v: BaselineGroupsView = {
      total: 5,
      groups: [
        {
          key: key('g'),
          label: 'G',
          value: 5,
          lines: [
            { key: key('a'), value: 5 },
            { key: key('z'), value: 0 },
          ],
        },
        { key: key('h'), label: 'H', value: 0, lines: [] },
      ],
    };
    render(<Treemap groups={v} colourBy={{ categories: [], of: {} }} />);
    expect(qa('g.gp-treemap-group').map((g) => g.getAttribute('data-group'))).toEqual(['g']);
    expect(qa('rect.gp-treemap-cell').map((c) => c.getAttribute('data-line'))).toEqual(['a']);
  });
});

describe('UI-14 Treemap: scale, tooltips and props only', () => {
  it('renders 415 cells in < 16 ms re-layout on hover (bench) and every cell has a tooltip (test)', () => {
    const v = view(415, 12);
    const colour = colourFor(v);
    const labels = Object.fromEntries(
      v.groups.flatMap((g) =>
        g.lines.map((l) => [l.key, { label: `Line ${l.key}`, detail: 'Vendor' }]),
      ),
    );

    // layout of 415 lines: median of repeated runs under one 60 Hz frame
    treemapLayout(v); // warm up
    const runs = Array.from({ length: 25 }, () => {
      const t0 = performance.now();
      treemapLayout(v);
      return performance.now() - t0;
    }).sort((a, b) => a - b);
    expect(runs[12]!).toBeLessThan(16);

    // hover never re-renders (so never re-lays out) the treemap: the tooltip is a separate store
    const commits = vi.fn();
    render(
      <>
        <Profiler id="treemap" onRender={commits}>
          <Treemap
            groups={v}
            colourBy={colour}
            lineLabels={labels}
            selected="pool_0"
            onSelect={() => {}}
          />
        </Profiler>
        <Tooltip />
      </>,
    );
    const cells = qa('rect.gp-treemap-cell');
    expect(cells).toHaveLength(415);
    const after = commits.mock.calls.length;

    // every cell has a tooltip: hovering it shows the line, its detail, amount and category
    for (const cell of cells) {
      fireEvent.pointerEnter(cell, { clientX: 10, clientY: 10 });
      const k = cell.getAttribute('data-line')!;
      const line = v.groups.flatMap((g) => g.lines).find((l) => l.key === k)!;
      const cat = colour.categories.find((c) => c.key === colour.of[k])!.label;
      const money = fmt.money(line.value, { digits: line.value < 1 ? 2 : 1 });
      expect(screen.getByRole('tooltip').textContent).toBe(`Line ${k}Vendor${money} · ${cat}`);
      expect(cell.getAttribute('aria-label')).toBe(`Line ${k} ${money} ${cat}`);
      fireEvent.pointerLeave(cell);
    }
    expect(screen.getByRole('tooltip').textContent).toBe('');
    expect(commits.mock.calls.length).toBe(after);
  });

  it('values arrive as props: tier 2 group values set the group areas, line values the cells', () => {
    const v = view(20, 2);
    const area = (k: string) => {
      const o = box(q(`g[data-group="${k}"] rect.gp-treemap-outline`)!);
      return o.w * o.h;
    };
    render(<Treemap groups={v} colourBy={colourFor(v)} />);
    const before = area('pool_0') / area('pool_1');
    cleanup();
    // tier 2 says pool_0 is now three times its old value: the area follows the prop, the
    // component does not re-add the lines
    const bumped = structuredClone(v);
    bumped.groups[0]!.value = v.groups[0]!.value * 3;
    bumped.total = bumped.groups[0]!.value + bumped.groups[1]!.value;
    render(<Treemap groups={bumped} colourBy={colourFor(v)} />);
    expect(area('pool_0') / area('pool_1')).toBeGreaterThan(before * 2);
    // the chip value is the tier 2 value, formatted, never recomputed
    expect(q('g[data-group="pool_0"] text.gp-treemap-chip-value')!.textContent).toBe(
      fmt.money(bumped.groups[0]!.value),
    );
  });

  it('the layout is memoised on the view: changing the selection keeps every rectangle', () => {
    const v = view(30, 3);
    const colour = colourFor(v);
    const { rerender } = render(<Treemap groups={v} colourBy={colour} selected="pool_0" />);
    const rects = () => qa('rect').map((r) => r.outerHTML.replace(/ data-\w+="[^"]*"/g, ''));
    const first = rects();
    rerender(<Treemap groups={v} colourBy={colour} selected="pool_2" />);
    expect(rects()).toEqual(first);
    expect(q('g[data-group="pool_2"]')!.hasAttribute('data-selected')).toBe(true);
  });
});

describe('UI-14 Treemap: accessibility and tokens', () => {
  it('names the chart, each group (value, line count) and each cell; group focus shows its tooltip', () => {
    const v = view(12, 3);
    render(
      <>
        <Treemap
          groups={v}
          colourBy={colourFor(v)}
          selected="pool_1"
          onSelect={() => {}}
          title="Treemap of CY26 IT outlay by cost pool"
        />
        <Tooltip />
      </>,
    );
    expect(
      screen
        .getByRole('group', { name: 'Treemap of CY26 IT outlay by cost pool' })
        .tagName.toLowerCase(),
    ).toBe('svg');
    const g1 = v.groups[1]!;
    const btn = screen.getByRole('button', { name: `${g1.label} ${fmt.money(g1.value)}, 4 lines` });
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    fireEvent.focus(btn);
    expect(screen.getByRole('tooltip').textContent).toBe(
      `${g1.label}${fmt.money(g1.value)} · 4 lines`,
    );
    fireEvent.blur(btn);
    expect(screen.getByRole('tooltip').textContent).toBe('');
  });

  it('has no axe violations (static and interactive)', async () => {
    const v = view(30, 4);
    const { container, rerender } = render(<Treemap groups={v} colourBy={colourFor(v)} />);
    const opts = { rules: { 'color-contrast': { enabled: false } } };
    expect((await axe.run(container, opts)).violations).toEqual([]);
    rerender(<Treemap groups={v} colourBy={colourFor(v)} selected="pool_2" onSelect={() => {}} />);
    expect((await axe.run(container, opts)).violations).toEqual([]);
  });

  it('styles come from tokens: theme colour vars, no hex, no raw px', () => {
    expect(treemapCss).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(treemapCss).not.toMatch(/\dpx\b/);
    expect(rule('.gp-treemap text.gp-treemap-chip-label')).toContain('fill: var(--ink)');
    expect(rule('.gp-treemap-group[role="button"]:focus-visible .gp-treemap-outline')).toContain(
      'var(--accent)',
    );
    expect(treemapCss).toContain('prefers-reduced-motion');
  });
});

describe('UI-14 Treemap: no formulas', () => {
  it('source has no formulas over prop values (lint guard: no arithmetic on value/total, no sums)', () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    for (const f of ['Treemap.tsx', 'layout.ts']) {
      const src = readFileSync(join(dir, f), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      const fields = '(?:value|total)';
      expect(src, f).not.toMatch(new RegExp(`\\.${fields}\\s*[-+*/%]`));
      expect(src, f).not.toMatch(new RegExp(`[-+*/%]\\s*[\\w.]*\\.${fields}\\b(?!\\s*\\()`));
      expect(src, f).not.toMatch(/\.reduce\(|\.sum\(|\bsum\(|\bfsum\(|\bmean\(|\bmedian\(/);
      expect(src, f).not.toMatch(/\+=/);
    }
  });
});
