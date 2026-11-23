import { useMemo, useState, type ReactNode } from 'react';
import type { Change, MemberKey, VarKey } from '@glidepath/api-contract';
import { GlassPanel, Skeleton } from '@glidepath/ui/glass';
import { BoundEditable, useBindContext, useVariable } from '../../bind';
import { useMembers } from '../../data';
import { Dial, Segmented } from '@glidepath/ui/inputs/controls';
import { COPY, DIALS, DRIVER_YEAR, LABOR_VARIABLE, VALUATION } from './copy';
import { driverFormat } from './format';
import { activeMembers } from './members';

const fail = () => undefined; // the commit queue (WEB-05) surfaces errors in the shell

/**
 * One dial: `useVariable` + the ui Dial. Dragging shows the local value at once and previews it
 * (tier 2 answers with the recalculated cells); releasing commits through the queue. Min, max,
 * step and unit are the registry's as the bundle sent them.
 */
function DriverDial({
  id,
  member,
  label,
  extra,
}: {
  id: string;
  member: string;
  label: string;
  extra?: ReactNode;
}) {
  const v = useVariable(id, member);
  const d = v.definition;
  const [drag, setDrag] = useState<number | null>(null);
  if (!d || typeof v.value !== 'number' || d.min === null || d.max === null || d.step === null) {
    return (
      <div className="gp-market-dial" aria-busy="true" data-variable-id={id}>
        <Skeleton size="text" width="100%" />
      </div>
    );
  }
  return (
    <div
      className="gp-market-dial"
      data-variable-id={id}
      data-member={member}
      data-stale={v.stale || undefined}
    >
      <Dial
        variableId={id}
        label={label}
        value={drag ?? v.value}
        min={d.min}
        max={d.max}
        step={d.step}
        defaultValue={d.default ?? v.value}
        format={driverFormat(d.unit, d.step)}
        onChange={(next) => {
          setDrag(next);
          v.preview(next);
        }}
        onCommit={(next) => {
          setDrag(null);
          void v.commit(next).catch(fail);
        }}
      />
      {extra}
    </div>
  );
}

/** The labor dial edits one labor group's FY27 pay rise: the group is a picker. */
function LaborDial({ label }: { label: string }) {
  const { tenant } = useBindContext();
  const members = useMembers(tenant);
  const groups = useMemo(() => activeMembers(members.data, 'lgroup'), [members.data]);
  const [picked, setPicked] = useState<string | null>(null);
  const group = picked ?? (groups[0]?.key as string | undefined);
  if (!group) {
    return (
      <div className="gp-market-dial" aria-busy="true" data-variable-id={LABOR_VARIABLE}>
        <Skeleton size="text" width="100%" />
      </div>
    );
  }
  return (
    <DriverDial
      id={LABOR_VARIABLE}
      member={`${group},${DRIVER_YEAR}`}
      label={label}
      extra={
        <select
          className="gp-market-group"
          aria-label={COPY.laborGroup}
          value={group}
          onChange={(e) => setPicked(e.target.value)}
        >
          {groups.map((g) => (
            <option key={g.key as string} value={g.key as string}>
              {g.label}
            </option>
          ))}
        </select>
      }
    />
  );
}

type Basis = 'ev' | 'pe';
const BASIS = [
  { id: 'ev', label: COPY.basisEv },
  { id: 'pe', label: COPY.basisPe },
] as const;

/**
 * Valuation: EV / EBITDAR or P/E. The basis is `corp.w_pe`, the weight on the P/E method: the
 * registry's min (EV / EBITDAR only) or max (P/E only) is written, and any weight above the min
 * reads as P/E. The multiple shown is `corp.ev_mult` or `corp.pe`, editable.
 */
function Valuation() {
  const w = useVariable(VALUATION.weight);
  const d = w.definition;
  const basis: Basis = typeof w.value === 'number' && w.value > (d?.min ?? 0) ? 'pe' : 'ev';
  const multiple = basis === 'pe' ? VALUATION.pe : VALUATION.ev;
  const ready = d && typeof w.value === 'number' && d.min !== null && d.max !== null;
  return (
    <div className="gp-market-valuation">
      <span className="gp-market-valuation-label">{COPY.valuation}</span>
      <Segmented<Basis>
        variableId={VALUATION.weight}
        label={COPY.valuationBasis}
        options={BASIS}
        value={basis}
        onChange={(next) => {
          if (!ready || next === basis) return;
          const to = next === 'pe' ? d.max! : d.min!;
          w.preview(to);
          void w.commit(to).catch(fail);
        }}
      />
      <span className="gp-market-valuation-value" data-basis={basis}>
        <BoundEditable key={multiple} variable={multiple} format="mult" />
      </span>
    </div>
  );
}

function ResetGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M4 9V4M4 9h5M5.5 15a7 7 0 1 0 1.6-7.4L4 9" />
    </svg>
  );
}

/** Cells the Drivers panel edits, for Reset. */
function useDriverCells(): { id: string; member: string }[] {
  const { tenant } = useBindContext();
  const members = useMembers(tenant);
  const lgroups = activeMembers(members.data, 'lgroup');
  return [
    ...DIALS.filter((x) => x.id !== LABOR_VARIABLE).map((x) => ({ id: x.id, member: DRIVER_YEAR })),
    ...lgroups.map((g) => ({ id: LABOR_VARIABLE, member: `${g.key as string},${DRIVER_YEAR}` })),
    { id: VALUATION.ev, member: '' },
    { id: VALUATION.pe, member: '' },
    { id: VALUATION.weight, member: '' },
  ];
}

/**
 * Drivers · FY27 (5 cols): six dials (`corp.brent`, `corp.crack`, `corp.gdp`, `corp.lab_wage_g`,
 * `corp.ac_add`, `corp.sofr`) and the valuation row. Reset clears this scenario's own values of
 * these cells (a `null` write each) so they inherit the tenant defaults again.
 */
export function DriversPanel() {
  const ctx = useBindContext();
  const cells = useDriverCells();
  const reset = () => {
    if (!ctx.commit) return;
    for (const c of cells) {
      const change: Change = {
        target: 'variable',
        key: c.id as VarKey,
        member: c.member as MemberKey,
        value: null,
      };
      void ctx.commit(change).catch(fail);
    }
  };
  return (
    <GlassPanel
      span={5}
      level={1}
      data-testid="market-drivers"
      header={{
        label: COPY.driversLabel,
        status: (
          <button type="button" className="gp-market-reset" onClick={reset}>
            <ResetGlyph />
            <span>{COPY.reset}</span>
          </button>
        ),
      }}
    >
      <div className="gp-market-dials">
        {DIALS.map((x) =>
          x.id === LABOR_VARIABLE ? (
            <LaborDial key={x.id} label={x.label} />
          ) : (
            <DriverDial key={x.id} id={x.id} member={DRIVER_YEAR} label={x.label} />
          ),
        )}
      </div>
      <Valuation />
    </GlassPanel>
  );
}
