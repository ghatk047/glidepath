import type { ScenarioId, SolverDetail, TenantSlug, VariableDef } from '@glidepath/api-contract';
import { Tornado, type TornadoItem } from '@glidepath/ui/charts/distribution';
import { GlassPanel } from '@glidepath/ui/glass';
import { EmptyState, JobHeader } from '../../jobs';
import { COPY, TORNADO_TOP } from './copy';
import { tornadoLookupParams, tornadoSpec } from './params';
import { useAnalysis } from './useAnalysis';

type Sensitivity = Extract<SolverDetail, { problem: 'sensitivity' }>;

/** The variable id of a row's cell (`g.ot_out_share[]` → `g.ot_out_share`): text, not a lookup. */
const idOf = (cell: string) => {
  const i = cell.indexOf('[');
  return i < 0 ? cell : cell.slice(0, i);
};

/**
 * What moves net most (4 cols): the scenario's quick `sensitivity` (tornado on `res.net[]`) run.
 * Tier 2's `detail.rows` come sorted by swing, each with its `category` (lever, policy, timing) and its
 * `swing`; tier 1 shows the top ten as bars as sent, policy and timing amber by that category, and prints
 * each swing in $M. It classifies nothing and takes no magnitude. A side-effect-free look-up shows an
 * existing run; "Run sensitivity" starts one when the scenario has none.
 */
export function TornadoPanel({
  tenant,
  scenarioId,
  variables,
}: {
  tenant: TenantSlug;
  scenarioId: ScenarioId;
  variables: readonly VariableDef[] | undefined;
}) {
  const tile = useAnalysis(tenant, scenarioId, {
    problem: 'sensitivity',
    ask: { quick: true, spec: tornadoSpec },
    lookupParams: tornadoLookupParams,
  });
  const result = tile.result;
  const defs = variables;

  const detail: Sensitivity | null =
    result?.detail?.problem === 'sensitivity' ? result.detail : null;
  // A row without tier 2's category and swing (a Sobol row) is not a tornado bar.
  const items: TornadoItem[] = [];
  for (const row of detail?.rows ?? []) {
    if (items.length === TORNADO_TOP) break;
    if (row.category === undefined || row.swing === undefined) continue;
    const id = idOf(row.cell);
    items.push({
      variableId: id,
      label: defs?.find((v) => v.id === id)?.label ?? id,
      swing: row.swing,
      category: row.category,
    });
  }

  const status = tile.jobId ? (
    <JobHeader id={tile.jobId} />
  ) : tile.error ? (
    <span className="gp-path-problem" role="alert">
      {COPY.startFailed}: {tile.error}
    </span>
  ) : (
    <span className="gp-path-faint">{COPY.swingUnit}</span>
  );

  return (
    <GlassPanel
      span={4}
      className="gp-path-tornado"
      data-testid="path-tornado"
      header={{ label: COPY.tornado, status }}
    >
      {result ? (
        <>
          <Tornado items={items} label={COPY.tornadoChart} className="gp-path-tornado-chart" />
          <p className="gp-path-faint gp-path-chart-note">{COPY.tornadoNote}</p>
        </>
      ) : (
        <EmptyState
          line={COPY.noSensitivity}
          action={{
            label: COPY.runSensitivity,
            disabled: tile.busy,
            onAction: () => void tile.start(),
          }}
        />
      )}
    </GlassPanel>
  );
}
