import { Fragment, useState, type CSSProperties } from 'react';
import type { RenewalCalendar, RenewalStatus, SourcingMember, SourcingParam } from '@glidepath/api-contract';
import { fmt } from '@glidepath/ui/format';
import { GlassPanel } from '@glidepath/ui/glass';
import { parsePercent } from '@glidepath/ui/inputs/editable';
import { MemberEditor, type MemberField } from './MemberEditor';
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

/** The contract terms edited from a renewal row (attributes of the `contract` member, SRC-01 seed names). */
const TERMS: readonly MemberField[] = [
  { attr: 'target_cut_pct', label: 'Target cut', step: 0.01, min: 0, max: 1, format: (v) => fmt.pct(v, { digits: 0 }), parse: parsePercent('fraction') },
  { attr: 'notice_days', label: 'Notice days', step: 1, min: 0, format: (v) => fmt.fte(v) },
];

/** F6 · Renewal calendar: status counts, a month timeline of the window and the renewals, act-now first. */
export function RenewalsPanel({
  read,
  rows: stored,
  params,
  onCommitted,
}: {
  read: Read<RenewalCalendar>;
  /** Stored `contract` rows (`GET /sourcing/members?dim=contract`); null until read. */
  rows: readonly SourcingMember[] | null;
  params: readonly SourcingParam[];
  onCommitted(): void;
}) {
  const [open, setOpen] = useState<string | null>(null);
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
                  <Fragment key={r.contract}>
                  <li className="gp-src-row gp-src-renewal" data-contract={r.contract} data-status={r.status}>
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
                    <span className="gp-src-num">
                      <button
                        type="button"
                        className="gp-src-edit"
                        aria-expanded={open === r.contract}
                        aria-label={`Edit terms of ${r.vendor}: target cut ${fmt.pct(r.targetCut, { digits: 0 })}`}
                        title={`Escalator exposure ${fmt.money(r.escalatorExposure)}/yr · click to edit the terms`}
                        onClick={() => setOpen((o) => (o === r.contract ? null : r.contract))}
                      >
                        {fmt.pct(r.targetCut, { digits: 0 })}
                      </button>
                    </span>
                    <span className="gp-src-num">{fmt.money(r.capture)}</span>
                  </li>
                  {open === r.contract && (
                    <li className="gp-src-editor">
                      <MemberEditor
                        dim="contract"
                        member={stored?.find((m) => m.key === r.contract) ?? null}
                        fields={TERMS}
                        onCommitted={onCommitted}
                      />
                    </li>
                  )}
                  </Fragment>
                ))}
              </ul>
            </div>
          </>
        )}
      </div>
    </GlassPanel>
  );
}
