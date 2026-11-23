import type { LeversMonthlyView } from '@glidepath/api-contract';
import { fmt } from '../../format';
import { tipProps } from '../../overlays/drawer';
import {
  MONTHLY_OFFSETS as O,
  MONTHLY_PLOT,
  MONTHLY_VIEWBOX,
  MONTH_LETTERS,
  MONTH_NAMES,
  monthlyDomain,
  monthlyGeometry,
  type MonthlyDomain,
} from './layout';
import { monthlyCss } from './styles';

/**
 * Item contract `MonthlyCurve(series, selected)`: `series` is the CON-02 `levers.monthly` view
 * payload as tier 2 sends it (family areas already summed, one series per lever); `selected` is
 * the lever member key whose own series is drawn as the ink line.
 */
export interface MonthlyCurveProps {
  series: LeversMonthlyView;
  /** Lever key of the selected lever (a `series.levers[].key`); none or unknown draws no line. */
  selected?: string | null;
  /** Value axis [floor, ceiling] in $M / month. Defaults to `monthlyDomain(series, selected)`. */
  domain?: MonthlyDomain;
  /** Display names by family key and lever key (the view carries keys only). Default: the key. */
  labels?: Readonly<Record<string, string>>;
  /** Accessible name of the chart, e.g. `Monthly savings in 2027 by lever family`. */
  title?: string;
  className?: string;
}

/** Injects the chart CSS once (React 19 hoists and de-duplicates `<style href precedence>`). */
function MonthlyStyles() {
  return (
    <style href="glidepath-monthly" precedence="glidepath">
      {monthlyCss}
    </style>
  );
}

/** Monthly curve (#26): stacked area by family with direct labels, selected lever as an ink line. */
export function MonthlyCurve({
  series,
  selected = null,
  domain,
  labels,
  title = 'Monthly savings by lever family',
  className,
}: MonthlyCurveProps) {
  const lever = selected === null ? undefined : series.levers.find((l) => l.key === selected);
  const axis = domain ?? monthlyDomain(series, lever);
  const g = monthlyGeometry(series, lever ?? null, axis);
  const name = (key: string) => labels?.[key] ?? key;
  const months = series.families[0]?.values.length ?? lever?.values.length ?? 0;
  const monthName = (i: number) => MONTH_NAMES[i] ?? String(i + 1);
  const perMonth = (i: number, value: number) => `${monthName(i)} ${fmt.money(value)}/mo`;

  return (
    <>
      <MonthlyStyles />
      <svg
        className={className ? `gp-monthly ${className}` : 'gp-monthly'}
        viewBox={`0 0 ${MONTHLY_VIEWBOX.width} ${MONTHLY_VIEWBOX.height}`}
        role="group"
        aria-label={title}
      >
        <g aria-hidden="true" data-part="axis">
          {g.ticks.map((t) => (
            <g key={t}>
              <line
                className="gp-monthly-grid"
                x1={MONTHLY_PLOT.left}
                x2={MONTHLY_PLOT.right}
                y1={g.y(t)}
                y2={g.y(t)}
              />
              <text
                data-part="tick"
                x={MONTHLY_PLOT.left - O.tickLabel}
                y={g.y(t) + O.tickBaseline}
                textAnchor="end"
              >
                {g.tickDigits ? fmt.money(t, { digits: g.tickDigits }) : fmt.fte(t)}
              </text>
            </g>
          ))}
          {Array.from({ length: months }, (_, i) => (
            <text
              key={i}
              data-part="month"
              x={g.x(i)}
              y={MONTHLY_VIEWBOX.height - O.monthLabel}
              textAnchor="middle"
            >
              {MONTH_LETTERS[i] ?? i + 1}
            </text>
          ))}
        </g>

        {g.bands.map((b) => {
          const key = b.family.key;
          const last = b.family.values.length - 1;
          const text = last >= 0 ? perMonth(last, b.family.values[last]!) : '';
          const tip = (
            <>
              <b>{name(key)}</b>
              <br />
              {text}
            </>
          );
          return (
            <g key={key} data-part="family" data-family={key}>
              <path
                className="gp-monthly-area"
                data-slot={b.slot}
                data-family={key}
                d={b.path}
                role="img"
                aria-label={`${name(key)} ${text}`}
                tabIndex={0}
                {...tipProps<SVGPathElement>(tip)}
              />
              <text
                className="gp-monthly-family-label"
                data-part="family-label"
                aria-hidden="true"
                x={MONTHLY_PLOT.right - O.familyLabelInset}
                y={b.labelY + O.familyLabelBaseline}
                textAnchor="end"
              >
                {name(key)}
              </text>
            </g>
          );
        })}

        {g.line && lever && (
          <g
            data-part="selected"
            data-lever={lever.key}
            role="img"
            aria-label={`${name(lever.key)} ${perMonth(lever.values.length - 1, lever.values[lever.values.length - 1]!)}`}
          >
            <path className="gp-monthly-line" data-part="line" d={g.line.path} />
            <circle
              className="gp-monthly-end"
              data-part="end-dot"
              cx={g.line.endX}
              cy={g.line.endY}
              r={O.endDotRadius}
            />
          </g>
        )}
      </svg>
    </>
  );
}
