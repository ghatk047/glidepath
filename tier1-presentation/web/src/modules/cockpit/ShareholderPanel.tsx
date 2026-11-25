import { fmt } from '@glidepath/ui/format';
import { GlassPanel } from '@glidepath/ui/glass';
import { Value, useNode } from '../../bind';
import { useShellNavigation } from '../../global/shell';
import { COPY, SHAREHOLDER_NODES as N, SHAREHOLDER_YEARS as Y } from './copy';

/** EPS and share price are dollars per share: `$0.091`, `$1.02` (`fmt.eps` with its digits). */
const epsDelta = (v: number) => fmt.eps(v, { signed: true });
const priceDelta = (v: number) => fmt.eps(v, { digits: 2, signed: true });
const epsLevel = (v: number) => fmt.eps(v);
const priceLevel = (v: number) => fmt.eps(v, { digits: 2 });
const cents = (v: number) => fmt.cents(v);

function Cell({
  node,
  member = '',
  format,
  className,
}: {
  node: string;
  member?: string;
  format: (v: number) => string;
  className?: string;
}) {
  return (
    <span className={className} data-node={node} data-member={member}>
      <Value node={node} member={member} format={format} />
    </span>
  );
}

function Chevron() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

/**
 * Shareholder view (4 cols, prototype Cockpit `data-go="market"`): the IT effect on EPS
 * (`br.eps27`) and share price (`br.px27`); EPS and price without → with the programme
 * (`pl.eps`, `val.px` on `fy27b` → `fy27it`); "Same as 1.7¢ off every gallon of jet fuel"
 * (`br.fuel_equiv_cents`). All are session cells; the chevron opens the Market module.
 */
export function ShareholderPanel({ year }: { year: number | null }) {
  const eps = useNode(N.eps);
  const { toModule } = useShellNavigation();
  return (
    <GlassPanel
      span={4}
      className="gp-cockpit-share"
      data-testid="cockpit-shareholder"
      loading={eps.value === undefined}
      header={{
        label: COPY.shareholderLabel(year),
        status: (
          <button
            type="button"
            className="gp-cockpit-go"
            aria-label={COPY.openMarket}
            onClick={() => toModule('market')}
          >
            <Chevron />
          </button>
        ),
      }}
    >
      <dl className="gp-cockpit-share-big">
        <div>
          <dt>{COPY.eps}</dt>
          <dd>
            <Cell node={N.eps} format={epsDelta} />
          </dd>
        </div>
        <div>
          <dt>{COPY.sharePrice}</dt>
          <dd>
            <Cell node={N.price} format={priceDelta} />
          </dd>
        </div>
      </dl>
      <dl className="gp-cockpit-stats gp-cockpit-share-stats">
        <div className="gp-cockpit-stat">
          <dt>{COPY.epsYear(year)}</dt>
          <dd className="gp-cockpit-span">
            <Cell
              node={N.epsLevel}
              member={Y.before}
              format={epsLevel}
              className="gp-cockpit-before"
            />
            <span className="gp-cockpit-arrow"> → </span>
            <Cell node={N.epsLevel} member={Y.after} format={epsLevel} />
          </dd>
        </div>
        <div className="gp-cockpit-stat">
          <dt>{COPY.price}</dt>
          <dd className="gp-cockpit-span">
            <Cell
              node={N.priceLevel}
              member={Y.before}
              format={priceLevel}
              className="gp-cockpit-before"
            />
            <span className="gp-cockpit-arrow"> → </span>
            <Cell node={N.priceLevel} member={Y.after} format={priceLevel} />
          </dd>
        </div>
      </dl>
      <p className="gp-cockpit-fuel">
        {COPY.fuelBefore} <Cell node={N.fuel} format={cents} className="gp-cockpit-strong" />{' '}
        {COPY.fuelAfter}
      </p>
    </GlassPanel>
  );
}
