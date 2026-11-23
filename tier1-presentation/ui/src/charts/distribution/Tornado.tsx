import { ChartStyles } from './ChartStyles';
import { isNum, plain } from './plain';

/**
 * Policy and timing inputs are amber, levers blue (04 inventory #22). Tier 2 says which a
 * variable is; tier 1 only maps the word to a colour.
 */
export type TornadoCategory = 'policy' | 'timing' | 'lever';

export interface TornadoItem {
  /** Spec id, used verbatim (`g.ot_out_share`, `lev.L10.ren`). */
  variableId: string;
  /** Display name from the registry; falls back to the id. */
  label?: string;
  /** Swing in net savings, $M, from tier 2. */
  swing: number;
  category: TornadoCategory;
}

export interface TornadoProps {
  /** Rows in display order: tier 2 sorts them, tier 1 does not re-sort. */
  items: readonly TornadoItem[];
  /** Swing that fills the full bar length; defaults to the largest swing in `items`. */
  max?: number;
  /** Value label; the default drops the $ and M ("39.1"), the panel header says "swing $M". */
  formatValue?: (swing: number) => string;
  label?: string;
  className?: string;
}

/** viewBox geometry (prototype: 360 wide, 22 per row, 150 for names, 40 kept for the value). */
const WIDTH = 360;
const ROW_H = 22;
const LABEL_W = 150;
const VALUE_ROOM = 40;
const BAR_H = 14;
const BAR_RADIUS = 4;
const PAD = 3;
const LABEL_GAP = 10;
const VALUE_GAP = 6;
const TEXT_DY = 14;

const defaultFormat = (v: number) => plain(v, 1);

/** Tornado (#22): one bar per input, in the order given. */
export function Tornado({
  items,
  max,
  formatValue = defaultFormat,
  label = 'Tornado of net savings swing by input',
  className,
}: TornadoProps) {
  const rows = items.filter((i) => isNum(i.swing));
  const height = rows.length * ROW_H + 2 * PAD;
  const scaleMax = isNum(max) ? max : Math.max(0, ...rows.map((r) => r.swing));
  const barRoom = WIDTH - LABEL_W - VALUE_ROOM;
  const cls = className ? `gp-chart ${className}` : 'gp-chart';

  return (
    <>
      <ChartStyles />
      <svg
        className={cls}
        viewBox={`0 0 ${WIDTH} ${height}`}
        role="img"
        aria-label={rows.length ? label : `${label}: no data yet`}
        data-chart="tornado"
      >
        <title>{label}</title>
        {rows.map((r, i) => {
          const y = i * ROW_H + PAD;
          const name = r.label ?? r.variableId;
          const w = scaleMax > 0 ? Math.max(0, (barRoom * r.swing) / scaleMax) : 0;
          const value = formatValue(r.swing);
          return (
            <g
              key={r.variableId}
              data-part="row"
              data-variable-id={r.variableId}
              data-category={r.category}
            >
              <text
                className="gp-tornado-label"
                x={LABEL_W - LABEL_GAP}
                y={y + TEXT_DY}
                textAnchor="end"
              >
                {name}
              </text>
              <rect
                className="gp-tornado-bar"
                data-category={r.category}
                x={LABEL_W}
                y={y + PAD}
                width={w}
                height={BAR_H}
                rx={BAR_RADIUS}
              >
                <title>{`${name}: swing ${value}, ${r.category}`}</title>
              </rect>
              <text x={LABEL_W + w + VALUE_GAP} y={y + TEXT_DY} data-part="value">
                {value}
              </text>
            </g>
          );
        })}
      </svg>
    </>
  );
}
