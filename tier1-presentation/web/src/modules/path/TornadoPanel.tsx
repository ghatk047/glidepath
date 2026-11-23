import type { ScenarioId, TenantSlug, VariableDef } from '@glidepath/api-contract';
import { Tornado, type TornadoCategory, type TornadoItem } from '@glidepath/ui/charts/distribution';
import { GlassPanel } from '@glidepath/ui/glass';
import { EmptyState, JobHeader } from '../../jobs';
import { COPY, GOVERNANCE_GROUP, TARGET_LAYER, TORNADO_TOP } from './copy';
import { tornadoLookupParams, tornadoSpec } from './params';
import { useAnalysis } from './useAnalysis';

/** The variable id of a move's cell (`g.ot_out_share[]` → `g.ot_out_share`): text, not a lookup. */
const idOf = (cell: string) => {
  const i = cell.indexOf('[');
  return i < 0 ? cell : cell.slice(0, i);
};

/** Bar length is a magnitude; tier 2's `ranked.impact` is the signed net delta. Display only. */
const magnitude = (n: number) => (n < 0 ? -n : n);

/**
 * The colour word for an input, mapped from the registry fields tier 2 authors (01_moodboard,
 * 04 #22): the governance group's target layer is policy, the rest of that group timing, everything
 * else a lever. Policy and timing draw amber, levers blue. No rule or number of tier 1's own.
 */
function categoryOf(def: VariableDef | undefined): TornadoCategory {
  if (def?.group !== GOVERNANCE_GROUP) return 'lever';
  return def.layer === TARGET_LAYER ? 'policy' : 'timing';
}

/**
 * What moves net most (4 cols): the scenario's quick `sensitivity` (tornado on `res.net[]`) run.
 * Tier 2 returns the inputs already sorted by swing; tier 1 shows the top ten as bars, policy and
 * timing amber by category, and prints each swing in $M. A side-effect-free look-up shows an
 * existing run; "Run sensitivity" starts one when the scenario has none. Nothing is computed here.
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

  const items: TornadoItem[] = (result?.ranked ?? []).slice(0, TORNADO_TOP).map((m) => {
    const id = idOf(m.cell);
    const def = defs?.find((v) => v.id === id);
    return {
      variableId: id,
      label: def?.label ?? id,
      swing: magnitude(m.impact),
      category: categoryOf(def),
    };
  });

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
