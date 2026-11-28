import type { LeversMonthlyView } from '@glidepath/api-contract';
import { MonthlyCurve } from '@glidepath/ui/charts/monthly';
import { GlassPanel } from '@glidepath/ui/glass';
import { Value } from '../../bind';

/** All levers (panel 3): `res.tot_iy`, one-time in IT, net vs bar. */
export function AllLevers() {
  return (
    <GlassPanel as="section" header={{ label: 'All levers · in-year', labelAs: 'h2' }}>
      <Value node="res.tot_iy" format="money" className="gp-lv-all-hero" />
      <p className="gp-lv-all-sub">
        − one-time in IT <Value node="res.tot_ot_it" format="money" />
      </p>
      <div className="gp-lv-all-pair">
        <div>
          <span className="gp-lv-eyebrow">Net</span>
          <Value node="res.net" format="money" />
        </div>
        <div>
          <span className="gp-lv-eyebrow">Bar</span>
          <Value node="res.bar" format="money" />
        </div>
      </div>
    </GlassPanel>
  );
}

export interface MonthlyPanelProps {
  monthly: LeversMonthlyView | undefined;
  labels: Readonly<Record<string, string>>;
  selected: string | null;
}

/** 2027 by month: `levers.monthly`, the selected lever as a line. */
export function MonthlyPanel({ monthly, labels, selected }: MonthlyPanelProps) {
  return (
    <GlassPanel
      as="section"
      className="gp-lv-month"
      header={{
        label: '2027 by month',
        status: <span className="gp-lv-eyebrow">$M / mo</span>,
        labelAs: 'h2',
      }}
      loading={monthly === undefined}
    >
      {monthly && (
        <>
          <MonthlyCurve
            series={monthly}
            selected={selected}
            labels={labels}
            title="Monthly savings in 2027 by lever family"
          />
          {selected !== null && <p className="gp-lv-eyebrow">Line: {selected}</p>}
        </>
      )}
    </GlassPanel>
  );
}
