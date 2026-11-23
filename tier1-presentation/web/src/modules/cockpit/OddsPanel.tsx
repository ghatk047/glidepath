import { toCellKey, type SolverDetail } from '@glidepath/api-contract';
import { Histogram } from '@glidepath/ui/charts/distribution';
import { fmt } from '@glidepath/ui/format';
import { GlassPanel } from '@glidepath/ui/glass';
import { EmptyState, JobHeader } from '../../jobs';
import { COPY, ODDS_CELLS } from './copy';
import { useTileRun } from './runs';

type MonteCarloDetail = Extract<SolverDetail, { problem: 'monte_carlo' }>;

const NET = toCellKey(ODDS_CELLS.net, '');
const BAR = toCellKey(ODDS_CELLS.bar, '');

/** P(clear) as the render prints it: one decimal, a whole number without it (`0%`, `4.5%`). */
const chance = (p: number) => fmt.pct(p).replace(/\.0%$/, '%');

/** The parts of tier 2's Monte Carlo detail this tile draws, looked up by cell; no arithmetic. */
function oddsOf(detail: MonteCarloDetail) {
  const net = detail.percentiles.find((r) => r.cell === NET);
  const bar = detail.percentiles.find((r) => r.cell === BAR);
  const clear = detail.probabilities.find((r) => r.cell === NET && r.against === BAR);
  const hist = detail.histograms.find((h) => h.cell === NET);
  return {
    net,
    bar: bar?.p50,
    clear: clear?.p,
    // the contract's `lo` / `hi` are the chart's `from` / `to`: renamed, not recomputed
    bins: (hist?.bins ?? []).map((b) => ({ from: b.lo, to: b.hi, count: b.count })),
    iterations: detail.iterations,
  };
}

/**
 * Odds (4 cols): the scenario's Monte Carlo `solver_run` result. P(`res.net` ≥ `res.bar`) as
 * the big number, the run count, the net histogram with P10 / P50 / P90 and the bar line (the
 * bar's P50), "P50 $74.5M" in the header. Without a result: "This scenario has not been
 * simulated." + "Run 2,000 trials" (`POST /solver-runs` monte_carlo with tier 2's defaults);
 * while it runs the header shows the job's note, progress and cancel (WEB-08).
 */
export function OddsPanel() {
  const tile = useTileRun('monte_carlo');
  const detail = tile.result?.detail?.problem === 'monte_carlo' ? tile.result.detail : null;
  const odds = detail ? oddsOf(detail) : null;
  const active = tile.job.active || tile.run?.status === 'queued' || tile.run?.status === 'running';

  const status =
    active || tile.run?.status === 'failed' || tile.run?.status === 'cancelled' ? (
      <JobHeader id={tile.run?.id} />
    ) : tile.error ? (
      <span className="gp-cockpit-error">
        {COPY.startFailed}: {tile.error}
      </span>
    ) : odds?.net ? (
      <span className="gp-cockpit-axis" data-cell={NET} data-p50={odds.net.p50}>
        {COPY.p50(fmt.money(odds.net.p50))}
      </span>
    ) : undefined;

  return (
    <GlassPanel
      span={4}
      className="gp-cockpit-odds"
      data-testid="cockpit-odds"
      header={{ label: COPY.oddsLabel, status }}
    >
      {odds ? (
        <div className="gp-cockpit-odds-body" data-stale={tile.stale || undefined}>
          <div className="gp-cockpit-spread">
            <div className="gp-cockpit-col">
              <span className="gp-cockpit-big" data-clear={odds.clear}>
                {typeof odds.clear === 'number' ? chance(odds.clear) : fmt.pct(null)}
              </span>
              <span className="gp-cockpit-of">{COPY.chanceOfClearing}</span>
            </div>
            <span className="gp-chip" data-iterations={odds.iterations}>
              {COPY.runs(fmt.fte(odds.iterations))}
            </span>
          </div>
          <Histogram
            className="gp-cockpit-hist"
            bins={odds.bins}
            p10={odds.net?.p10}
            p50={odds.net?.p50}
            p90={odds.net?.p90}
            bar={odds.bar}
            label={COPY.distribution}
          />
        </div>
      ) : (
        <div className="gp-cockpit-col">
          <span className="gp-cockpit-big gp-cockpit-faint" aria-hidden="true">
            {fmt.pct(null)}
          </span>
          <EmptyState
            line={COPY.notSimulated}
            action={{
              label: COPY.runTrials,
              disabled: tile.starting || active,
              onAction: () => void tile.start(),
            }}
          />
        </div>
      )}
    </GlassPanel>
  );
}
