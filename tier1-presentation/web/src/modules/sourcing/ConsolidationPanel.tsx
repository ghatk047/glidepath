import type { ConsolidationResult, SourcingParam } from '@glidepath/api-contract';
import { ComputeFlow } from '@glidepath/ui/compute';
import { fmt } from '@glidepath/ui/format';
import { GlassPanel } from '@glidepath/ui/glass';
import { ParamStrip, paramText } from './ParamStrip';
import { Kpis, ReadError, Tag, paybackText } from './parts';
import type { Read } from './useSourcing';

/** F8 · Vendor consolidation: the optimizer's moves, before/after concentration and what bound it. */
export function ConsolidationPanel({
  read,
  params,
  onCommitted,
}: {
  read: Read<ConsolidationResult>;
  params: readonly SourcingParam[];
  onCommitted(): void;
}) {
  const d = read.data;
  const byKey = new Map(params.map((p) => [p.key as string, p]));
  const bound = (key: string, value: number) => {
    const p = byKey.get(key);
    return p ? paramText(p, value) : fmt.fte(value);
  };

  return (
    <GlassPanel
      level={1}
      data-testid="sourcing-consolidation"
      data-tour="sourcing-consolidation"
      header={{
        label: 'Vendor consolidation',
        status: (
          <>
            {read.busy && (
              <span className="gp-src-compute" data-testid="sourcing-consolidation-running">
                <ComputeFlow active variant="field" />
              </span>
            )}
            {d && !read.busy && (
              <Tag tone={d.exact ? 'pos' : undefined} title={d.exact ? 'No plan of moves does better' : 'Best plan found inside the search budget'}>
                {d.exact ? 'optimal' : 'best found'}
              </Tag>
            )}
          </>
        ),
      }}
      loading={!d && !read.error}
    >
      <div className="gp-src-body">
        <ReadError error={read.error} />
        <ParamStrip params={params} group="consolidation" onCommitted={onCommitted} />
        {d && (
          <div className={read.busy ? 'gp-src-body gp-src-stale' : 'gp-src-body'} aria-busy={read.busy || undefined}>
            <Kpis
              label="Consolidation totals"
              items={[
                { id: 'saving', label: 'Saving / yr', value: fmt.money(d.totals.annualSaving) },
                { id: 'onetime', label: 'One-time', value: fmt.money(d.totals.oneTimeCost) },
                { id: 'payback', label: 'Payback', value: paybackText(d.totals.paybackMonths) },
                {
                  id: 'hhi',
                  label: 'HHI',
                  value: (
                    <>
                      <span data-hhi="before">{fmt.fte(d.hhiBefore)}</span>
                      <small> → </small>
                      <span data-hhi="after">{fmt.fte(d.hhiAfter)}</span>
                    </>
                  ),
                },
                {
                  id: 'vendors',
                  label: 'Vendors',
                  value: (
                    <>
                      {fmt.fte(d.totals.vendorsBefore)}
                      <small> → </small>
                      {fmt.fte(d.totals.vendorsAfter)}
                    </>
                  ),
                },
                { id: 'top', label: 'Top vendor after', value: fmt.pct(d.topVendorShareAfter) },
              ]}
            />
            {d.binding.length > 0 && (
              <ul className="gp-src-binding" aria-label="Binding constraints">
                <li className="gp-src-sub">Bound by</li>
                {d.binding.map((b) => (
                  <li key={b.param} data-binding={b.param}>
                    <Tag tone="warn" title={b.label}>
                      {b.label} {bound(b.param, b.value)}
                    </Tag>
                  </li>
                ))}
              </ul>
            )}
            <div className="gp-src-scroll">
              <ol className="gp-src-list" aria-label="Moves">
                <li className="gp-src-row gp-src-move gp-src-head" aria-hidden="true">
                  <span title="Consolidation move">Move</span>
                  <span className="gp-src-num" title="Spend moved">Spend</span>
                  <span className="gp-src-num" title="Saving per year">Save/yr</span>
                  <span className="gp-src-num" title="Payback (months)">Payback</span>
                  <span className="gp-src-num" title="Net saving">Net</span>
                </li>
                {d.moves.map((m, i) => (
                  <li key={`${m.from}-${m.to}-${m.pool}-${i}`} className="gp-src-row gp-src-move" data-move={i}>
                    <span className="gp-src-name" title={`${m.from} → ${m.to} · ${m.pool} · one-time ${fmt.money(m.oneTimeCost)}`}>
                      {m.from}
                      <span className="gp-src-arrow">→</span>
                      {m.to}
                      <span className="gp-src-sub"> · {m.pool}</span>
                    </span>
                    <span className="gp-src-num">{fmt.money(m.spendMoved)}</span>
                    <span className="gp-src-num">{fmt.money(m.annualSaving)}</span>
                    <span className="gp-src-num gp-src-sub">{paybackText(m.paybackMonths)}</span>
                    <span className="gp-src-num">{fmt.money(m.netBenefit)}</span>
                  </li>
                ))}
              </ol>
              {d.moves.length === 0 && <p className="gp-src-note">No move pays under these limits.</p>}
            </div>
          </div>
        )}
      </div>
    </GlassPanel>
  );
}
