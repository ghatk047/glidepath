import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { fmt } from '../../format';
import { tipProps } from '../../overlays/drawer';
import {
  TREEMAP_CHIP as C,
  TREEMAP_RADII,
  TREEMAP_VIEWBOX,
  treemapLayout,
  type TreemapGroup,
  type TreemapLine,
  type TreemapView,
} from './layout';
import { TREEMAP_SLOTS, treemapCss } from './styles';

/** How cells are coloured: a category per line, drawn in category order on the token ramp. */
export interface TreemapColourBy {
  /** Categories in legend order; category i uses colour slot i (cycled over `TREEMAP_SLOTS`). */
  categories: readonly { key: string; label: string }[];
  /** Category key by line key (a line attribute from `members`, e.g. `addr`). */
  of: Readonly<Record<string, string>>;
}

/** Display copy for a line (from `members`): its name and a second line such as the vendor. */
export interface TreemapLineLabel {
  label: string;
  detail?: string;
}

/**
 * Item contract `Treemap(groups, colourBy, selected, onSelect)`: `groups` is the CON
 * `baseline.groups` view payload as tier 2 sends it (group values and the total already in the
 * grouping's split); `colourBy` maps each line to a colour category; `selected` is the selected
 * group key; `onSelect` receives the group key on click, Enter or Space.
 */
export interface TreemapProps {
  groups: TreemapView;
  colourBy: TreemapColourBy;
  /** Group key outlined in ink (a `groups.groups[].key`); the other groups dim. */
  selected?: string | null;
  /** Called with the group key when a group is clicked or activated from the keyboard. */
  onSelect?: (key: TreemapGroup['key']) => void;
  /** Line names and details by line key (the view carries keys only). Default: the key. */
  lineLabels?: Readonly<Record<string, TreemapLineLabel>>;
  /** Accessible name of the chart, e.g. `Treemap of CY26 IT outlay by cost pool`. */
  title?: string;
  className?: string;
  /**
   * Fill the box the chart is given (CSS sets its width and height) instead of keeping the 800 x 500
   * shape: the viewBox follows the drawn size in CSS px, so labels keep their size and the groups
   * re-tile to the box's shape (UIX-01, screens that fit the viewport). Until measured, the default box.
   */
  fit?: boolean;
}

type Box = { width: number; height: number };
/** Smallest box the chart re-tiles to (CSS px): below it the default shape is kept. */
const MIN_FIT = 40;

/** The element's drawn size, rounded, while `on`; null before the first measure or without ResizeObserver. */
function useDrawnSize(on: boolean) {
  const ref = useRef<SVGSVGElement>(null);
  const [box, setBox] = useState<Box | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!on || !el || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      const width = Math.round(el.clientWidth);
      const height = Math.round(el.clientHeight);
      if (width < MIN_FIT || height < MIN_FIT) return;
      setBox((b) => (b && b.width === width && b.height === height ? b : { width, height }));
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, [on]);
  return [ref, on ? box : null] as const;
}

/** Injects the chart CSS once (React 19 hoists and de-duplicates `<style href precedence>`). */
function TreemapStyles() {
  return (
    <style href="glidepath-treemap" precedence="glidepath">
      {treemapCss}
    </style>
  );
}

/** Amounts under $1M keep two decimals so small lines do not read as $0.0M (prototype). */
const lineMoney = (line: TreemapLine) => fmt.money(line.value, { digits: line.value < 1 ? 2 : 1 });
const linesText = (n: number) => `${n} ${n === 1 ? 'line' : 'lines'}`;

/** Treemap (#20): groups → lines, squarified, coloured by a line category; click selects a group. */
export function Treemap({
  groups,
  colourBy,
  selected = null,
  onSelect,
  lineLabels,
  title = 'Treemap of outlay by group',
  className,
  fit = false,
}: TreemapProps) {
  const [svgRef, drawn] = useDrawnSize(fit);
  const size = drawn ?? TREEMAP_VIEWBOX;
  // Layout depends on the view and the box only: selection and hover never re-lay out the cells.
  const boxes = useMemo(() => treemapLayout(groups, size), [groups, size]);
  const slotOf = useMemo(() => {
    const index = new Map(colourBy.categories.map((cat, i) => [cat.key, i % TREEMAP_SLOTS]));
    const label = new Map(colourBy.categories.map((cat) => [cat.key, cat.label]));
    return (lineKey: string) => {
      const cat = colourBy.of[lineKey];
      const slot = cat === undefined ? undefined : index.get(cat);
      return {
        slot: slot === undefined ? 'none' : String(slot),
        label: cat ? label.get(cat) : undefined,
      };
    };
  }, [colourBy]);
  const hasSelection = selected !== null && boxes.some((b) => b.group.key === selected);
  const interactive = Boolean(onSelect);

  const onKey = (key: TreemapGroup['key']) => (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect?.(key);
    }
  };

  return (
    <>
      <TreemapStyles />
      <svg
        ref={svgRef}
        className={['gp-treemap', fit ? 'gp-treemap-fit' : '', className ?? ''].filter(Boolean).join(' ')}
        viewBox={`0 0 ${size.width} ${size.height}`}
        role="group"
        aria-label={title}
      >
        {boxes.map((b) => {
          const { group } = b;
          const isSelected = hasSelection && group.key === selected;
          const money = fmt.money(group.value);
          const count = linesText(b.cells.length);
          const { onFocus, onBlur } = tipProps<SVGGElement>(
            <>
              <b>{group.label}</b>
              <br />
              {`${money} · ${count}`}
            </>,
          );
          return (
            <g
              key={group.key}
              className="gp-treemap-group"
              data-group={group.key}
              data-selected={isSelected || undefined}
              data-dim={(hasSelection && !isSelected) || undefined}
              role={interactive ? 'button' : 'group'}
              aria-label={`${group.label} ${money}, ${count}`}
              aria-pressed={interactive ? isSelected : undefined}
              tabIndex={interactive ? 0 : undefined}
              onClick={interactive ? () => onSelect?.(group.key) : undefined}
              onKeyDown={interactive ? onKey(group.key) : undefined}
              onFocus={onFocus}
              onBlur={onBlur}
            >
              {b.cells.map((cell) => {
                const k = cell.line.key;
                const copy = lineLabels?.[k];
                const name = copy?.label ?? k;
                const { slot, label: category } = slotOf(k);
                const amount = lineMoney(cell.line);
                const tail = category ? `${amount} · ${category}` : amount;
                return (
                  <rect
                    key={k}
                    className="gp-treemap-cell"
                    data-line={k}
                    data-slot={slot}
                    x={cell.x}
                    y={cell.y}
                    width={cell.width}
                    height={cell.height}
                    rx={TREEMAP_RADII.cell}
                    role="img"
                    aria-label={category ? `${name} ${amount} ${category}` : `${name} ${amount}`}
                    {...tipProps<SVGRectElement>(
                      <>
                        <b>{name}</b>
                        <br />
                        {copy?.detail ? (
                          <>
                            {copy.detail}
                            <br />
                          </>
                        ) : null}
                        {tail}
                      </>,
                    )}
                  />
                );
              })}
              <rect
                className="gp-treemap-outline"
                data-part="outline"
                aria-hidden="true"
                x={b.x}
                y={b.y}
                width={b.width}
                height={b.height}
                rx={TREEMAP_RADII.group}
              />
              {b.chip && (
                <g data-part="chip" aria-hidden="true">
                  <rect
                    className="gp-treemap-scrim"
                    x={b.chip.x}
                    y={b.chip.y}
                    width={b.chip.width}
                    height={b.chip.height}
                    rx={TREEMAP_RADII.chip}
                  />
                  <text
                    className="gp-treemap-chip-label"
                    x={b.chip.x + C.textInset}
                    y={b.chip.y + C.labelBaseline}
                  >
                    {b.chip.label}
                  </text>
                  {b.chip.showValue && (
                    <text
                      className="gp-treemap-chip-value"
                      x={b.chip.x + C.textInset}
                      y={b.chip.y + C.valueBaseline}
                    >
                      {money}
                    </text>
                  )}
                </g>
              )}
            </g>
          );
        })}
      </svg>
    </>
  );
}
