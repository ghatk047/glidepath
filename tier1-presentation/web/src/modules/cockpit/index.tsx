import { useMemo, type ReactNode } from 'react';
import { Grid, GridCell } from '@glidepath/ui/glass';
import { useBindContext } from '../../bind';
import { useApiClient, useScenarios, useTenants } from '../../data';
import { JobsProvider, solverRunCanceller } from '../../jobs';
import { COPY, cy } from './copy';
import { FastestPathPanel } from './FastestPathPanel';
import { NetSavingsPanel } from './NetSavingsPanel';
import { OddsPanel } from './OddsPanel';
import { OutlayBridgePanel } from './OutlayBridgePanel';
import { useSolverRunDiscovery } from './runs';
import { ShareholderPanel } from './ShareholderPanel';
import { CockpitStyles } from './styles';
import { VpRings } from './VpRings';
import { YourInputsPanel } from './YourInputsPanel';

/** Scenario chip of the Net savings panel: the preset's name, "· edited" once it has edits. */
function ScenarioChip() {
  const { tenant, scenarioId } = useBindContext();
  const scenarios = useScenarios(tenant);
  const s = scenarios.data?.scenarios.find((x) => x.id === scenarioId);
  if (!s) return null;
  const name = s.shortLabel;
  return (
    <span className="gp-chip gp-cockpit-scenario" data-scenario={s.key}>
      {s.editsCount > 0 ? `${name} · ${COPY.edited}` : name}
    </span>
  );
}

/**
 * Job plumbing of the Odds and Fastest path tiles (WEB-08): `job` messages from the screen's
 * session, cancel by `DELETE /solver-runs/:id`; ended solver jobs are picked up for the tiles.
 */
function CockpitJobs({ children }: { children: ReactNode }) {
  const { tenant, session } = useBindContext();
  const api = useApiClient();
  const cancel = useMemo(() => solverRunCanceller(api, tenant), [api, tenant]);
  useSolverRunDiscovery();
  return (
    <JobsProvider session={session} cancel={cancel}>
      {children}
    </JobsProvider>
  );
}

/**
 * Cockpit · "Path to the bar" (03_screens; cockpit-*-1440 / -390 renders). Hero row (MOD-01):
 * Net savings gauge (5) beside the CY26 → CY27 outlay bridge and Your inputs (7, stacked).
 * Tiles (MOD-02): one VP ring per `vp` member (3 cols each), then Shareholder view, Odds and
 * Fastest path (4 each). Renders inside the global layer (`GlobalLayout`: bindings, commit
 * queue); every value is pushed by tier 2 through the session or read from the API, nothing is
 * computed here.
 */
export default function Cockpit() {
  const { tenant } = useBindContext();
  const tenants = useTenants();
  const row = tenants.data?.tenants.find((t) => t.slug === tenant);
  const from = row ? cy(row.baseYear) : null;
  const to = row ? cy(row.targetYear) : null;
  return (
    <main className="gp-module gp-cockpit" aria-label={COPY.module}>
      <CockpitStyles />
      <CockpitJobs>
        <Grid data-testid="cockpit-grid">
          <NetSavingsPanel
            year={to}
            runRateYear={row ? row.targetYear + 1 : null}
            status={<ScenarioChip />}
          />
          <GridCell span={7} stack>
            <OutlayBridgePanel fromYear={from} toYear={to} />
            <YourInputsPanel />
          </GridCell>
          <VpRings />
          <ShareholderPanel year={row ? row.targetYear : null} />
          <OddsPanel />
          <FastestPathPanel />
        </Grid>
      </CockpitJobs>
    </main>
  );
}
