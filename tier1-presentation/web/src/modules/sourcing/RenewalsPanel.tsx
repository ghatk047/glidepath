import type { CSSProperties } from 'react';
import type { RenewalCalendar, RenewalStatus, SourcingParam } from '@glidepath/api-contract';
import { fmt } from '@glidepath/ui/format';
import { GlassPanel } from '@glidepath/ui/glass';
import { ParamStrip } from './ParamStrip';
import { Kpis, ReadError, Tag, monthLabel, type Tone } from './parts';
import type { Read } from './useSourcing';

/** List order: what needs a decision now first. */
export const STATUS_ORDER: readonly RenewalStatus[] = ['act_now', 'overdue', 'plan', 'later'];
const STATUS: Record<RenewalStatus, { word: string; tone: Tone }> = {
  act_now: { word: 'act now', tone: 'warn' },
  overdue: { word: 'overdue', tone: 'neg' },
  plan: { word: 'plan', tone: 'accent' },
  later: { word: 'later', tone: undefined },
};

/** F6 · Renewal calendar: status counts, a month timeline of the window and the renewals, act-now first. */
export function RenewalsPanel({
  read,
  params,
  onCommitted,
}: {
  read: Read<RenewalCalendar>;
  params: readonly SourcingParam[];
  onCommitted(): void;
}) {
  const d = read.data;
  const rows = d
    ? STATUS_ORDER.flatMap((s) => d.renewals.filter((r) => r.status === s))
    : [];
  // Timeline bars are scaled to the busiest month of tier 2's window (picked, not computed).
  let vmax = 1;
  for (const m of d?.byMonth ?? []) if (m.annualValue > vmax) vmax = m.annualValue;

  return (
    <GlassPanel
      level={1}
      data-testid="sourcing-renewals"
      data-tour="sourcing-renewals"
      header={{
        label: 'Renewal calendar',
        status: d ? (
          <span className="gp-src-statuses" aria-label="Renewals by status">
            {STATUS_ORDER.map((s) => (
              <Tag key={s} tone={STATUS[s].tone}>
                <span data-status-count={s}>{d.totals.byStatus[s]}</span>&nbsp;{STATUS[s].word}
              </Tag>
            ))}
          </span>
        ) : undefined,
      }}
      loading={!d && !read.error}
    >
      <div className="gp-src-body">
        <ReadError error={read.error} />
        <ParamStrip params={params} group="renewals" onCommitted={onCommitted} />
        {d && (
          <>
            <Kpis
              label="Renewal totals"
              items={[
                { id: 'value', label: 'Annual value', value: fmt.money(d.totals.annualValue) },
                { id: 'escalator', label: 'Escalator exposure', value: fmt.money(d.totals.escalatorExposure) },
                {
                  id: 'capture',
                  label: `Capture ${d.planYear}`,
                  value: fmt.money(d.totals.capture),
                },
              ]}
            />
            <ol className="gp-src-timeline" aria-label="Renewals by month" style={{ '--vmax': vmax } as CSSProperties}>
              {d.byMonth.map((m, i) => (
                <li
                  key={m.month}
                  className="gp-src-month"
                  data-month={m.month}
                  data-has={m.renewals > 0 || undefined}
                  title={`${monthLabel(m.month)}: ${m.renewals} renewals, ${fmt.money(m.annualValue)}, capture ${fmt.money(m.capture)}`}
                  style={{ '--v': m.annualValue } as CSSProperties}
                >
                  <i />
                  {(i === 0 || m.month.endsWith('-01')) && <b>{monthLabel(m.month)}</b>}
                </li>
              ))}
            </ol>
            <div className="gp-src-scroll">
              <ul className="gp-src-list" aria-label="Renewals">
                <li className="gp-src-row gp-src-renewal gp-src-head" aria-hidden="true">
                  <span>Status</span>
                  <span>Contract</span>
                  <span className="gp-src-num">Notice</span>
                  <span className="gp-src-num">Value</span>
                  <span className="gp-src-num">Cut</span>
                  <span className="gp-src-num">Capture</span>
                </li>
                {rows.map((r) => (
                  <li key={r.contract} className="gp-src-row gp-src-renewal" data-contract={r.contract} data-status={r.status}>
                    <span>
                      <Tag tone={STATUS[r.status].tone}>{STATUS[r.status].word}</Tag>
                    </span>
                    <span className="gp-src-name" title={`${r.vendor} · ${r.category} · renews ${monthLabel(r.renewalMonth)}`}>
                      {r.vendor}
                      <span className="gp-src-sub"> · {r.category}</span>
                    </span>
                    <span className="gp-src-num" title={`Notice deadline ${r.noticeDeadline}`}>
                      {fmt.fte(r.daysToDeadline)}d
                    </span>
                    <span className="gp-src-num">{fmt.money(r.annualValue)}</span>
                    <span className="gp-src-num" title={`Escalator exposure ${fmt.money(r.escalatorExposure)}/yr`}>
                      {fmt.pct(r.targetCut, { digits: 0 })}
                    </span>
                    <span className="gp-src-num">{fmt.money(r.capture)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </div>
    </GlassPanel>
  );
}
