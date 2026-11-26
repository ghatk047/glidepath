import { useState, type CSSProperties } from 'react';
import type { VendorSpend, VendorSpendRow } from '@glidepath/api-contract';
import { fmt } from '@glidepath/ui/format';
import { GlassPanel } from '@glidepath/ui/glass';
import { Kpis, ReadError, Tag } from './parts';
import type { Read } from './useSourcing';

/** Named vendors listed before "more" (the rest open on demand). */
const SHOWN = 12;
/** Lever chips per row before "+n". */
const LEVER_CHIPS = 3;

function VendorRow({ v, rank, top }: { v: VendorSpendRow; rank: number | null; top: number }) {
  const extra = v.levers.slice(LEVER_CHIPS);
  return (
    <li
      className="gp-src-row gp-src-vendor"
      data-vendor={v.vendorKey ?? v.vendor}
      data-aggregate={v.aggregate || undefined}
      data-muted={v.aggregate || undefined}
    >
      <span className="gp-src-rank">{rank ?? ''}</span>
      <span className="gp-src-name" title={v.vendor}>
        {v.vendor}
        <span className="gp-src-tags">
          {v.preferred && <Tag tone="pos">pref</Tag>}
          {v.levers.slice(0, LEVER_CHIPS).map((l) => (
            <Tag key={l} tone="accent">
              {l}
            </Tag>
          ))}
          {extra.length > 0 && <Tag title={extra.join(', ')}>+{extra.length}</Tag>}
        </span>
      </span>
      <span
        className="gp-src-bar"
        data-preferred={v.preferred || undefined}
        data-muted={v.aggregate || undefined}
        style={{ '--share': v.share, '--top': top } as CSSProperties}
        aria-hidden="true"
      >
        <i />
      </span>
      <span className="gp-src-num" data-value={v.spend}>
        {fmt.money(v.spend)}
      </span>
      <span className="gp-src-num gp-src-sub">{fmt.pct(v.share)}</span>
    </li>
  );
}

/** F5 · Vendor spend: KPI tiles and the ranked vendor list; aggregate buckets last and muted. */
export function VendorsPanel({ read }: { read: Read<VendorSpend> }) {
  const [all, setAll] = useState(false);
  const d = read.data;
  const named = d?.vendors.filter((v) => !v.aggregate) ?? [];
  const buckets = d?.vendors.filter((v) => v.aggregate) ?? [];
  // Bars are scaled to the largest named vendor (tier 2 sorts by spend, so it is the first).
  const top = named[0]?.share ?? 1;
  const rest = named.slice(SHOWN);
  const shown = all ? named : named.slice(0, SHOWN);

  return (
    <GlassPanel
      level={1}
      data-testid="sourcing-vendors"
      data-tour="sourcing-vendors"
      header={{
        label: 'Vendor spend',
        status: d ? <span className="gp-src-sub">{d.year}</span> : undefined,
      }}
      loading={!d && !read.error}
    >
      <div className="gp-src-body">
        <ReadError error={read.error} />
        {d && (
          <>
            <Kpis
              label="Vendor spend totals"
              items={[
                { id: 'spend', label: '3rd-party spend', value: fmt.money(d.totals.thirdPartySpend) },
                { id: 'hhi', label: 'HHI', value: fmt.fte(d.totals.hhi) },
                { id: 'top5', label: 'Top-5 share', value: fmt.pct(d.totals.top5Share) },
                { id: 'preferred', label: 'Preferred', value: fmt.pct(d.totals.preferredShare) },
                { id: 'count', label: 'Vendors', value: fmt.fte(d.totals.vendorCount) },
              ]}
            />
            <div className="gp-src-scroll">
              <ol className="gp-src-list" aria-label="Vendors by spend">
                {shown.map((v, i) => (
                  <VendorRow key={`${v.vendor}-${i}`} v={v} rank={i + 1} top={top} />
                ))}
              </ol>
              {rest.length > 0 && (
                <button type="button" className="gp-src-more" onClick={() => setAll((a) => !a)}>
                  {all ? 'Show top vendors only' : `${rest.length} more vendors`}
                </button>
              )}
              {buckets.length > 0 && (
                <>
                  <ul className="gp-src-list" aria-label="Aggregate buckets">
                    {buckets.map((v) => (
                      <VendorRow key={v.vendor} v={v} rank={null} top={top} />
                    ))}
                  </ul>
                  <p className="gp-src-note">Buckets, not vendors: left out of HHI, top-5 and the count.</p>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </GlassPanel>
  );
}
