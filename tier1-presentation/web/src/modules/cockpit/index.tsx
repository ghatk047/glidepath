import { Grid, GridCell } from '@glidepath/ui/glass';
import { useBindContext } from '../../bind';
import { useScenarios, useTenants } from '../../data';
import { presetName } from '../../global/shell';
import { COPY, cy } from './copy';
import { NetSavingsPanel } from './NetSavingsPanel';
import { OutlayBridgePanel } from './OutlayBridgePanel';
import { CockpitStyles } from './styles';
import { YourInputsPanel } from './YourInputsPanel';

/** Scenario chip of the Net savings panel: the preset's name, "· edited" once it has edits. */
function ScenarioChip() {
  const { tenant, scenarioId } = useBindContext();
  const scenarios = useScenarios(tenant);
  const s = scenarios.data?.scenarios.find((x) => x.id === scenarioId);
  if (!s) return null;
  const name = s.kind === 'preset' ? presetName(s.key, s.label) : s.label;
  return (
    <span className="gp-chip gp-cockpit-scenario" data-scenario={s.key}>
      {s.editsCount > 0 ? `${name} · ${COPY.edited}` : name}
    </span>
  );
}

/**
 * Cockpit · "Path to the bar" (03_screens; cockpit-*-1440 / -390 renders), hero row (MOD-01):
 * Net savings gauge (5) beside the CY26 → CY27 outlay bridge and Your inputs (7, stacked).
 * The VP rings, Shareholder, Odds and Fastest path tiles follow in MOD-02.
 * Renders inside the global layer (`GlobalLayout`: bindings, commit queue); every value is
 * pushed by tier 2 through the session, nothing is computed here.
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
      </Grid>
    </main>
  );
}
