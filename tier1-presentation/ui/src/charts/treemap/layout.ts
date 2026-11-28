/**
 * Treemap geometry: d3-hierarchy squarify over the view tier 2 sends (CON `baseline.groups`).
 * Layout only. Tier 2 already gives every group its value and the view its total; those become
 * the d3 node values as they are, so nothing here sums, nets or derives a business value. The
 * one ordering is largest first (squarify packs best that way, as the prototype does).
 * Positions are SVG user units in the prototype's 800 x 500 viewBox
 * (docs/ux/prototype/src/views.js `treemap`, core.js `squarify`).
 */
import type { BaselineGroupsView } from '@glidepath/api-contract';
import { descending } from 'd3-array';
import {
  hierarchy,
  treemap,
  treemapSquarify,
  type HierarchyNode,
  type HierarchyRectangularNode,
} from 'd3-hierarchy';

export type TreemapView = BaselineGroupsView;
export type TreemapGroup = BaselineGroupsView['groups'][number];
export type TreemapLine = TreemapGroup['lines'][number];

/** SVG user-unit box (prototype `W`, `H`). */
export const TREEMAP_VIEWBOX = { width: 800, height: 500 } as const;
/** Gaps between neighbouring groups and between neighbouring cells (component inventory #20). */
export const TREEMAP_GAPS = { group: 2, cell: 1 } as const;
/** Corner radii (user units): cells, the group outline, the label chip (prototype). */
export const TREEMAP_RADII = { cell: 2, group: 6, chip: 8 } as const;
/**
 * Label chip, from the prototype: a chip shows when the group is wider than `minWidth` and taller
 * than `minHeight`; the value line shows when it is taller than `valueMinHeight`. Text width is
 * estimated per character (`charWidth` for the chip, `fitCharWidth` for cutting the label).
 */
export const TREEMAP_CHIP = {
  inset: 6,
  padX: 14,
  textInset: 7,
  labelBaseline: 15,
  valueBaseline: 31,
  minChipWidth: 56,
  charWidth: 7.1,
  fitCharWidth: 7.5,
  height: 22,
  tallHeight: 40,
  minWidth: 80,
  minHeight: 40,
  valueMinHeight: 64,
} as const;
export const ELLIPSIS = '…';

export interface TreemapRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TreemapCell extends TreemapRect {
  line: TreemapLine;
}

export interface TreemapChip extends TreemapRect {
  /** Group label, cut with an ellipsis to fit the group. */
  label: string;
  /** The chip is tall enough for the group value line. */
  showValue: boolean;
}

export interface TreemapGroupBox extends TreemapRect {
  group: TreemapGroup;
  cells: TreemapCell[];
  /** Label chip on a ground scrim, or null when the group is too small for one. */
  chip: TreemapChip | null;
}

type Datum = TreemapView | TreemapGroup | TreemapLine;
const isView = (d: Datum): d is TreemapView => 'groups' in d;
const isGroup = (d: Datum): d is TreemapGroup => 'lines' in d;

/** Children with an area: a treemap cannot draw zero or negative values. */
const children = (d: Datum): readonly Datum[] | undefined => {
  if (isView(d)) return d.groups.filter((g) => g.value > 0);
  if (isGroup(d)) return d.lines.filter((l) => l.value > 0);
  return undefined;
};
/** The node value tier 2 sent: the view total, a group value, a line value. */
const valueOf = (d: Datum) => (isView(d) ? d.total : d.value);

/** Cut a group label to the characters that fit across `width` (prototype rule). */
export function chipLabel(label: string, width: number): string {
  const fit = Math.floor(width / TREEMAP_CHIP.fitCharWidth);
  return label.length > fit ? `${label.slice(0, Math.max(0, fit - 1))}${ELLIPSIS}` : label;
}

function chipFor(group: TreemapGroup, r: TreemapRect): TreemapChip | null {
  const C = TREEMAP_CHIP;
  if (!(r.width > C.minWidth && r.height > C.minHeight)) return null;
  const label = chipLabel(group.label, r.width);
  const showValue = r.height > C.valueMinHeight;
  return {
    x: r.x + C.inset,
    y: r.y + C.inset,
    width: Math.min(
      r.width - 2 * C.inset,
      Math.max(label.length * C.charWidth, C.minChipWidth) + C.padX,
    ),
    height: showValue ? C.tallHeight : C.height,
    label,
    showValue,
  };
}

const rectOf = (n: HierarchyRectangularNode<Datum>): TreemapRect => ({
  x: n.x0,
  y: n.y0,
  width: n.x1 - n.x0,
  height: n.y1 - n.y0,
});

/**
 * Two-level squarified treemap of a `baseline.groups` view: groups tile the viewBox with
 * `TREEMAP_GAPS.group` between them, each group's lines tile the group with `TREEMAP_GAPS.cell`
 * between them. Node values are the tier 2 values (d3 `treemap` reads `node.value`; no `sum`).
 * `size` is the viewBox to tile (default the prototype's 800 x 500).
 */
export function treemapLayout(
  view: TreemapView,
  size: { width: number; height: number } = TREEMAP_VIEWBOX,
): TreemapGroupBox[] {
  const root = hierarchy<Datum>(view, children);
  root.each((n: HierarchyNode<Datum>) => {
    (n as { value?: number }).value = valueOf(n.data);
  });
  root.sort((a, b) => descending(a.value, b.value));
  const laid = treemap<Datum>()
    .tile(treemapSquarify)
    .size([size.width, size.height])
    .paddingInner((n) => (n.depth === 0 ? TREEMAP_GAPS.group : TREEMAP_GAPS.cell))(root);

  return (laid.children ?? []).map((g): TreemapGroupBox => {
    const r = rectOf(g);
    const group = g.data as TreemapGroup;
    return {
      ...r,
      group,
      cells: (g.children ?? []).map((c) => ({ ...rectOf(c), line: c.data as TreemapLine })),
      chip: chipFor(group, r),
    };
  });
}
