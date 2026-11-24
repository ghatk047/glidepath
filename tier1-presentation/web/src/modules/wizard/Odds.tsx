import { fmt } from '@glidepath/ui/format';
import { GlassPanel } from '@glidepath/ui/glass';
import { useBindContext } from '../../bind';
import { EmptyState, JobHeader } from '../../jobs';
import { BAR_CELL, NET_CELL } from '../path/copy';
import { oddsSpec } from '../path/params';
import { useAnalysis } from '../path/useAnalysis';
import { COPY } from './copyResult';

/** P(clear) as the Path screen prints it: one decimal, a whole number without it. */
const chance = (p: number) => fmt.pct(p).replace(/\.0%$/, '%');

/**
 * Odds panel: P(`res.net` >= `res.bar`) from tier 2's Monte Carlo look-up for this scenario.
 * Without a run, "Run N trials" with tier 2's trial count starts one (never saved).
 */
export function Odds() {
  const { tenant, scenarioId } = useBindContext();
  const analysis = useAnalysis(tenant, scenarioId, {
    problem: 'monte_carlo',
    ask: { quick: false, spec: oddsSpec },
  });
  const detail = analysis.result?.detail;
  const clear =
    detail?.problem === 'monte_carlo'
      ? detail.probabilities.find((r) => r.cell === NET_CELL && r.against === BAR_CELL)?.p
      : undefined;
  const trials = analysis.trials === null ? null : fmt.fte(analysis.trials);

  return (
    <GlassPanel
      span={4}
      data-testid="wizard-odds"
      header={{
        label: COPY.odds,
        status: analysis.jobId ? <JobHeader id={analysis.jobId} /> : undefined,
      }}
    >
      {typeof clear === 'number' ? (
        <div className="gp-wzr-odds" data-clear={clear}>
          <span className="gp-wzr-eyebrow">{COPY.pClear}</span>
          <span className="gp-wzr-odds-big">{chance(clear)}</span>
        </div>
      ) : (
        <EmptyState
          line={analysis.error ?? ''}
          action={{
            label: COPY.runTrials(trials),
            disabled: analysis.busy,
            onAction: () => void analysis.start(),
          }}
        />
      )}
    </GlassPanel>
  );
}
