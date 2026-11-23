import {
  toCellKey,
  type ScenarioId,
  type SolverRun,
  type TenantSlug,
} from '@glidepath/api-contract';
import { fmt } from '@glidepath/ui/format';
import { GlassPanel } from '@glidepath/ui/glass';
import { useShellNavigation } from '../../global/shell';
import { EmptyState, JobHeader } from '../../jobs';
import type { VpMember } from './VpCard';
import { useVpFeasible } from './useVpFeasible';

const NET = toCellKey('res.net', '');
/** `per_vp[vp_operations]` names the VP in brackets (tier 2's constraint id for per-VP rows). */
const memberOf = (constraint: string) => /\[(.*)\]$/.exec(constraint)?.[1] ?? null;

function Result({
  run,
  vps,
  current,
}: {
  run: SolverRun;
  vps: readonly VpMember[];
  current: boolean;
}) {
  const nav = useShellNavigation();
  const result = run.result;
  if (!result) return null;
  const label = (key: string) => vps.find((v) => v.key === key)?.label ?? key;
  const net = result.metrics[NET];
  const binding = (result.binding ?? [])
    .map((b) => memberOf(b.constraint))
    .filter((m) => m !== null);
  const coverage = result.detail?.problem === 'vp_feasible' ? result.detail.coverage : [];
  return (
    <>
      <p
        className="gp-vps-result"
        data-status={result.status}
        data-current={current}
        data-testid="feasible-result"
      >
        Optimizer with all {vps.length} VP bars: <strong data-value={net}>{fmt.money(net)}</strong>
        {binding.length > 0 && <>, {binding.map((m) => label(m)).join(', ')} binding</>}
        {result.status === 'infeasible' && <>. No plan clears every bar.</>}
      </p>
      {!current && (
        <p className="gp-vps-stale" data-testid="feasible-stale">
          From earlier inputs. Run again for this scenario as it stands.
        </p>
      )}
      {coverage.length > 0 && (
        <ul className="gp-vps-coverage" aria-label="Coverage per VP">
          {coverage.map((c) => (
            <li key={c.vp} data-vp={c.vp}>
              {label(c.vp)} · {fmt.pct(c.coverage)} of bar
            </li>
          ))}
        </ul>
      )}
      <div className="gp-vps-actions">
        <button type="button" className="gp-vps-btn" onClick={() => nav.toModule('path')}>
          Open in Path
        </button>
      </div>
    </>
  );
}

/** "Every VP clears?": the VP-feasible solver result, or an empty state with a run action. */
export function FeasiblePanel({
  tenant,
  scenarioId,
  vps,
}: {
  tenant: TenantSlug;
  scenarioId: ScenarioId;
  vps: readonly VpMember[];
}) {
  const feas = useVpFeasible(tenant, scenarioId);
  const done = feas.run?.status === 'done' && feas.run.result !== null;
  return (
    <GlassPanel
      level={2}
      header={{ label: 'Every VP clears?', status: <JobHeader id={feas.jobId} /> }}
    >
      {done ? (
        <Result run={feas.run!} vps={vps} current={feas.current} />
      ) : (
        <EmptyState
          line={
            feas.error ??
            (feas.run?.status === 'failed'
              ? (feas.run.error?.detail ?? 'The run failed.')
              : 'Not run on this scenario yet.')
          }
          action={{
            label: feas.busy ? 'Running…' : 'Find a plan where every VP clears',
            onAction: () => void feas.start(),
            disabled: feas.busy,
          }}
        />
      )}
    </GlassPanel>
  );
}
