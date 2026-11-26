import type { CSSProperties } from 'react';
import type { BenchmarkGap, BenchmarkTotals, SourcingParam } from '@glidepath/api-contract';
import { MINUS, fmt } from '@glidepath/ui/format';
import { GlassPanel } from '@glidepath/ui/glass';
import { ParamStrip } from './ParamStrip';
import { Kpis, ReadError, Tag, usd } from './parts';
import type { Read } from './useSourcing';

/**
 * Headroom in words. Tier 2's `headroom` is capturable gap less what the levers already take; below
 * zero the levers go further than the benchmark, said as such rather than as a negative headroom.
 * The amount is tier 2's number, only its sign is dropped from the text.
 */
export function Headroom({ totals }: { totals: BenchmarkTotals }) {
  const beyond = totals.headroom < 0;
  const amount = fmt.money(totals.headroom).replace(MINUS, '');
  return (
    <p className="gp-src-headroom" data-sign={beyond ? 'beyond' : 'room'} data-testid="sourcing-headroom">
      {beyond ? (
        <>
          Levers already go <strong>{amount}</strong> beyond the benchmark gap
        </>
      ) : (
        <>
          <strong>{amount}</strong> of capturable gap not yet taken by levers
        </>
      )}
    </p>
  );
}

/** F7 · Should-cost benchmarks: unit cost against the p25-p75 band, gap and opportunity per line. */
export function BenchmarksPanel({
  read,
  params,
  onCommitted,
}: {
  read: Read<BenchmarkGap>;
  params: readonly SourcingParam[];
  onCommitted(): void;
}) {
  const d = read.data;
  const percentile = d?.rows[0]?.percentile;
  return (
    <GlassPanel
      level={1}
      data-testid="sourcing-benchmarks"
      data-tour="sourcing-benchmarks"
      header={{
        label: 'Should-cost benchmarks',
        status: percentile ? <Tag>vs {percentile}</Tag> : undefined,
      }}
      loading={!d && !read.error}
    >
      <div className="gp-src-body">
        <ReadError error={read.error} />
        <ParamStrip params={params} group="benchmarks" onCommitted={onCommitted} />
        {d && (
          <>
            <Kpis
              label="Benchmark totals"
              items={[
                { id: 'opportunity', label: 'Gap to target', value: fmt.money(d.totals.opportunity) },
                { id: 'capturable', label: 'Capturable', value: fmt.money(d.totals.capturable) },
                { id: 'levers', label: 'Lever savings', value: fmt.money(d.totals.leverSavings) },
              ]}
            />
            <Headroom totals={d.totals} />
            <div className="gp-src-scroll">
              <ul className="gp-src-list" aria-label="Benchmarked lines">
                <li className="gp-src-row gp-src-bench gp-src-head" aria-hidden="true">
                  <span>Line</span>
                  <span>p25 · median · p75</span>
                  <span className="gp-src-num">Unit cost</span>
                  <span className="gp-src-num">Gap</span>
                  <span className="gp-src-num">Opp.</span>
                </li>
                {d.rows.map((r) => (
                  <li key={`${r.benchmark}-${r.line}`} className="gp-src-row gp-src-bench" data-benchmark={r.benchmark} data-line={r.line}>
                    <span className="gp-src-name" title={`${r.label} · ${r.pool} · per ${r.unit}`}>
                      {r.label}
                      <span className="gp-src-sub"> · per {r.unit}</span>
                    </span>
                    <span
                      className="gp-src-range"
                      data-over={r.gapPerUnit > 0 || undefined}
                      title={`p25 ${usd(r.p25)} · median ${usd(r.median)} · p75 ${usd(r.p75)} · unit cost ${usd(r.unitCost)}`}
                      style={{ '--p25': r.p25, '--median': r.median, '--p75': r.p75, '--cost': r.unitCost } as CSSProperties}
                    >
                      <i className="band" />
                      <i className="mid" />
                      <i className="cost" />
                    </span>
                    <span className="gp-src-num">{usd(r.unitCost)}</span>
                    <span className="gp-src-num gp-src-sub">{usd(r.gapPerUnit)}</span>
                    <span className="gp-src-num" title={`Capturable ${fmt.money(r.capturable)}`}>
                      {fmt.money(r.opportunity)}
                    </span>
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
