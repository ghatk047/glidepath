import type { BusinessCase, BusinessCaseRow, SourcingParam } from '@glidepath/api-contract';
import { ComputeFlow } from '@glidepath/ui/compute';
import { fmt } from '@glidepath/ui/format';
import { GlassPanel } from '@glidepath/ui/glass';
import { ParamStrip } from '../sourcing/ParamStrip';
import { Kpis, ReadError } from '../sourcing/parts';
import type { Read } from '../sourcing/useSourcing';
import { COPY, GROUP } from './copy';
import { capPct, months } from './parts';

/** Highest NPV first (a comparison, no arithmetic); ties keep tier 2's lever order. */
const byNpv = (a: BusinessCaseRow, b: BusinessCaseRow) => (a.npv > b.npv ? -1 : a.npv < b.npv ? 1 : 0);

/**
 * F9 · Business case: tier 2's lever business case (`GET /plan/business-case`) at the `discount_rate` and
 * `horizon_years` parameters, which are edited in place (steppers → structural change → read again). Rows by
 * NPV; IRR and ROI above the display cap read ">500%", undefined ones "—".
 */
export function BusinessCasePanel({
  read,
  params,
  onCommitted,
}: {
  read: Read<BusinessCase>;
  params: readonly SourcingParam[];
  onCommitted(): void;
}) {
  const d = read.data;
  const rows = d ? [...d.levers].sort(byNpv) : [];
  const t = d?.totals;

  return (
    <GlassPanel
      level={1}
      data-testid="plan-business-case"
      data-tour="plan-business-case"
      header={{
        label: COPY.businessCase,
        status: (
          <>
            {read.busy && (
              <span className="gp-src-compute" data-testid="plan-business-case-running">
                <ComputeFlow active variant="field" />
              </span>
            )}
            {d && (
              <em className="gp-src-tag" data-testid="plan-business-case-basis" title="Discount rate and horizon">
                {fmt.pct(d.discountRate)} · {d.years[0]}–{d.years.at(-1)}
              </em>
            )}
          </>
        ),
      }}
      loading={!d && !read.error}
    >
      <div className="gp-src-body">
        <ReadError error={read.error} />
        <ParamStrip params={params} group={GROUP.businessCase} onCommitted={onCommitted} />
        {d && t && (
          <div className={read.busy ? 'gp-src-body gp-src-stale' : 'gp-src-body'} aria-busy={read.busy || undefined}>
            <Kpis
              label="Portfolio business case"
              items={[
                { id: 'npv', label: 'NPV', value: fmt.money(t.npv) },
                { id: 'onetime', label: 'One-time', value: fmt.money(t.oneTime) },
                { id: 'runrate', label: 'Run-rate / yr', value: fmt.money(t.runRate) },
                { id: 'payback', label: 'Payback', value: months(t.paybackMonths) },
                { id: 'irr', label: 'IRR', value: capPct(t.irr) },
                { id: 'roi', label: 'ROI', value: capPct(t.roi) },
              ]}
            />
            <div className="gp-src-scroll" tabIndex={0} role="group" aria-label={COPY.scrollBusinessCase}>
              <ol className="gp-src-list" aria-label="Business case by lever, highest NPV first">
                <li className="gp-src-row gp-plan-bc gp-src-head" aria-hidden="true">
                  <span>Lever</span>
                  <span className="gp-src-num">One-time</span>
                  <span className="gp-src-num">Run-rate</span>
                  <span className="gp-src-num">NPV</span>
                  <span className="gp-src-num">Payback</span>
                  <span className="gp-src-num">IRR</span>
                  <span className="gp-src-num">ROI</span>
                </li>
                {rows.map((r) => (
                  <li key={r.lever} className="gp-src-row gp-plan-bc" data-lever={r.lever}>
                    <span className="gp-src-name" title={`${r.lever} · ${r.label}`}>
                      {r.label}
                    </span>
                    <span className="gp-src-num gp-src-sub">{fmt.money(r.oneTime)}</span>
                    <span className="gp-src-num">{fmt.money(r.runRate)}</span>
                    <span className="gp-src-num" data-npv>
                      {fmt.money(r.npv)}
                    </span>
                    <span className="gp-src-num gp-src-sub">{months(r.paybackMonths)}</span>
                    <span className="gp-src-num" data-irr>
                      {capPct(r.irr)}
                    </span>
                    <span className="gp-src-num" data-roi>
                      {capPct(r.roi)}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        )}
      </div>
    </GlassPanel>
  );
}
