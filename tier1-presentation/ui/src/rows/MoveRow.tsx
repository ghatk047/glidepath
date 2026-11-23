import { formatByUnit, percentOf } from '../inputs/slider';
import { tipProps } from '../overlays/drawer';
import { RowStyles } from './RowStyles';

export interface MoveRowProps {
  /** Spec variable id, verbatim (`lev.L17.pct`). */
  variableId: string;
  /** Short variable name. */
  label: string;
  /** Value in scenario C (the tick) and the solver's value (the thumb), in model units. */
  from: number;
  to: number;
  /** Track extent: the variable's display metadata from tier 2. */
  min: number;
  max: number;
  /** Registry unit, picks the "from → to" format. */
  unit: string;
  /** Step of the variable; sets the digits shown. Default 1. */
  step?: number;
  /** 1-based position in the solver's move list; shown as "01". */
  rank: number;
  /** Name of the reference the tick marks. Default "C". */
  fromLabel?: string;
  /** Overrides the unit-based value text. */
  format?: (value: number) => string;
}

const clampPct = (p: number) => Math.min(100, Math.max(0, p));

/** Move row (#24): a solver result. Track with the C tick, accent span between, thumb at the new value, "from → to". */
export function MoveRow({
  variableId,
  label,
  from,
  to,
  min,
  max,
  unit,
  step = 1,
  rank,
  fromLabel = 'C',
  format,
}: MoveRowProps) {
  const text = format ?? ((x: number) => formatByUnit(x, unit, step));
  const a = clampPct(percentOf(from, min, max));
  const b = clampPct(percentOf(to, min, max));
  const fromText = text(from);
  const toText = text(to);
  return (
    <>
      <RowStyles />
      <div
        className="gp-move"
        role="group"
        aria-label={`${label}: ${fromText} to ${toText}`}
        data-variable-id={variableId}
      >
        <span className="gp-move-rank" aria-hidden="true">
          {String(rank).padStart(2, '0')}
        </span>
        <span className="gp-move-label" title={label}>
          {label}
        </span>
        <span
          className="gp-move-hit"
          role="img"
          tabIndex={0}
          aria-label={`${fromLabel} ${fromText}, new value ${toText}`}
          {...tipProps(`${fromLabel} ${fromText} → ${toText}`)}
        >
          <span className="gp-move-track" data-testid="move-track">
            <span
              className="gp-move-span"
              data-testid="move-span"
              style={{ left: `${Math.min(a, b)}%`, width: `${Math.abs(b - a)}%` }}
            />
            <span className="gp-move-tick" data-testid="move-tick" style={{ left: `${a}%` }} />
            <span className="gp-move-thumb" data-testid="move-thumb" style={{ left: `${b}%` }} />
          </span>
        </span>
        <span className="gp-move-text">
          <span className="gp-move-from">{fromText}</span> → {toText}
        </span>
      </div>
    </>
  );
}
