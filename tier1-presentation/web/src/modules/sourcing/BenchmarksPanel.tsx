import { Fragment, useState, type CSSProperties } from 'react';
import type { BenchmarkGap, BenchmarkTotals, SourcingMember, SourcingParam } from '@glidepath/api-contract';
import { MINUS, fmt } from '@glidepath/ui/format';
import { GlassPanel } from '@glidepath/ui/glass';
import { MemberEditor, type MemberField } from './MemberEditor';
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

/** The percentiles of a `benchmark` member (US$ per unit, SRC-01 seed names), edited from its row. */
const PERCENTILES: readonly MemberField[] = [
  { attr: 'p25_usd', label: 'p25', step: 1, min: 0, format: usd },
  { attr: 'median_usd', label: 'Median', step: 1, min: 0, format: usd },
  { attr: 'p75_usd', label: 'p75', step: 1, min: 0, format: usd },
];

/** F7 · Should-cost benchmarks: unit cost against the p25-p75 band, gap and opportunity per line. */
export function BenchmarksPanel({
  read,
  rows: stored,
  params,
  onCommitted,
}: {
  read: Read<BenchmarkGap>;
  /** Stored `benchmark` rows (`GET /sourcing/members?dim=benchmark`); null until read. */
  rows: readonly SourcingMember[] | null;
  params: readonly SourcingParam[];
  onCommitted(): void;
}) {
  const [open, setOpen] = useState<string | null>(null);
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
                  <span title="Benchmark line">Line</span>
                  <span title="25th percentile · median · 75th percentile">p25 · median · p75</span>
                  <span className="gp-src-num" title="Unit cost">Unit cost</span>
                  <span className="gp-src-num" title="Gap to the median benchmark">Gap</span>
                  <span className="gp-src-num" title="Opportunity">Opp.</span>
                </li>
                {d.rows.map((r) => {
                  const id = `${r.benchmark}-${r.line}`;
                  return (
                    <Fragment key={id}>
                      <li className="gp-src-row gp-src-bench" data-benchmark={r.benchmark} data-line={r.line}>
                        <span className="gp-src-name" title={`${r.label} · ${r.pool} · per ${r.unit}`}>
                          {r.label}
                          <span className="gp-src-sub"> · per {r.unit}</span>
                        </span>
                        <button
                          type="button"
                          className="gp-src-range gp-src-edit"
                          data-over={r.gapPerUnit > 0 || undefined}
                          aria-expanded={open === id}
                          aria-label={`Edit benchmark of ${r.label}: p25 ${usd(r.p25)}, median ${usd(r.median)}, p75 ${usd(r.p75)}, unit cost ${usd(r.unitCost)}`}
                          title={`p25 ${usd(r.p25)} · median ${usd(r.median)} · p75 ${usd(r.p75)} · unit cost ${usd(r.unitCost)} · click to edit`}
                          style={{ '--p25': r.p25, '--median': r.median, '--p75': r.p75, '--cost': r.unitCost } as CSSProperties}
                          onClick={() => setOpen((o) => (o === id ? null : id))}
                        >
                          <i className="band" />
                          <i className="mid" />
                          <i className="cost" />
                        </button>
                        <span className="gp-src-num">{usd(r.unitCost)}</span>
                        <span className="gp-src-num gp-src-sub">{usd(r.gapPerUnit)}</span>
                        <span className="gp-src-num" title={`Capturable ${fmt.money(r.capturable)}`}>
                          {fmt.money(r.opportunity)}
                        </span>
                      </li>
                      {open === id && (
                        <li className="gp-src-editor">
                          <MemberEditor
                            dim="benchmark"
                            member={stored?.find((m) => m.key === r.benchmark) ?? null}
                            fields={PERCENTILES}
                            onCommitted={onCommitted}
                          />
                        </li>
                      )}
                    </Fragment>
                  );
                })}
              </ul>
            </div>
          </>
        )}
      </div>
    </GlassPanel>
  );
}
