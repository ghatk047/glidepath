import { Grid } from '@glidepath/ui/glass';
import { useBindContext } from '../../bind';
import { useTenants } from '../../data';
import { COPY } from './copy';
import { DriversPanel } from './DriversPanel';
import { EpsPanel, SharePricePanel } from './EpsPanel';
import { MoreDrivers } from './MoreDrivers';
import { MarketStyles } from './styles';
import { TracePanel } from './TracePanel';

/**
 * Market · "Shareholder view" (MOD-08; 03_screens, market-dark-1440.jpg). Renders inside
 * `GlobalLayout`: every number is a pushed cell of the session (`useNode`, `useVariable`), every
 * edit goes through the commit queue, every trace node opens the trace drawer. Nothing is
 * computed here.
 */
export default function Market() {
  const { tenant } = useBindContext();
  const tenants = useTenants();
  const row = tenants.data?.tenants.find((t) => t.slug === tenant);
  return (
    <main className="gp-module gp-market" aria-label={COPY.module}>
      <MarketStyles />
      <Grid data-testid="market-grid">
        <TracePanel year={row ? String(row.targetYear) : null} />
        <DriversPanel />
        <EpsPanel />
        <SharePricePanel />
        <MoreDrivers />
      </Grid>
      <p className="gp-market-note">{COPY.note}</p>
    </main>
  );
}
