import type { ReactNode } from 'react';
import { ComputeFlow } from '@glidepath/ui/compute';
import { EM_DASH, fmt } from '@glidepath/ui/format';
import { formatByUnit } from '@glidepath/ui/inputs/slider';
import type { NodeDef, VariableDef } from '@glidepath/api-contract';
import { COPY, PCT_CAP } from './copy';
import type { PlanRun } from './usePlanRun';

/** `lev.L03.pct[]` → `{ id: 'lev.L03.pct', member: '' }`; `lev.start[L03]` → member `L03`. Text only. */
export const splitCell = (cell: string): { id: string; member: string } => {
  const m = /^(.*)\[(.*)\]$/.exec(cell);
  return m ? { id: m[1]!, member: m[2]! } : { id: cell, member: '' };
};

/** A value in its registry unit (digits from the step), or the plain number when the bundle lacks the variable. */
export const byVariable = (def: VariableDef | undefined, value: number | null): string =>
  value === null ? EM_DASH : def ? formatByUnit(value, def.unit, def.step ?? 1, def.percentScale) : fmt.mult(value);

/** A signed delta in its node's unit: `$M` money, `$` per share, anything else a plain signed number. */
export const signedByNode = (def: NodeDef | undefined, value: number): string => {
  switch (def?.unit) {
    case '$M':
      return fmt.money(value, { signed: true });
    case '$':
      return fmt.eps(value, { signed: true, digits: 2 });
    default:
      return plain(value, true);
  }
};

/** A unitless number (two digits), e.g. a shadow price. */
export const plain = (value: number, signed = false): string => fmt.mult(value, { signed }).replace('×', '');

const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/** A month of 2027 as `lev.start` holds it (1 = Jan) → `Jan`. */
export const monthName = (m: number): string => MONTHS[m] ?? String(m);

/** IRR / ROI as a percent; beyond the display cap ">500%"; `null` (not defined) "—". */
export const capPct = (v: number | null): string =>
  v === null ? EM_DASH : v > PCT_CAP ? `>${fmt.pct(PCT_CAP, { digits: 0 })}` : fmt.pct(v, { digits: 0 });

/** Months to repay a one-time cost as tier 2 sent them: null = never. */
export const months = (v: number | null): string => (v === null ? COPY.never : `${fmt.fte(v)} mo`);

/** Header status of a run panel: compute flow while running, the failure line, or a stale chip. */
export function RunStatus({ tile, extra }: { tile: PlanRun; extra?: ReactNode }) {
  return (
    <>
      {tile.busy && (
        <span className="gp-src-compute" data-testid="plan-running">
          <ComputeFlow active variant="field" progress={tile.progress} />
        </span>
      )}
      {!tile.busy && tile.run && !tile.current && <em className="gp-src-tag">{COPY.stale}</em>}
      {extra}
    </>
  );
}

/** Tier 2's line when the run failed, with one action to ask again. */
export function RunError({ tile }: { tile: PlanRun }) {
  if (!tile.error) return null;
  return (
    <p className="gp-src-error gp-plan-error" role="alert">
      <span>
        {COPY.failed}: {tile.error}
      </span>
      <button type="button" className="gp-src-more" disabled={tile.busy} onClick={() => void tile.start()}>
        {COPY.rerun}
      </button>
    </p>
  );
}
