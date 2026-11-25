import type { ScenarioId, SolverDetail, TenantSlug } from '@glidepath/api-contract';
import { Histogram } from '@glidepath/ui/charts/distribution';
import { fmt } from '@glidepath/ui/format';
import { GlassPanel } from '@glidepath/ui/glass';
import { EmptyState, JobHeader } from '../../jobs';
import { COPY, ODDS } from './copy';
import { oddsSpec } from './params';
import { useAnalysis, type Analysis } from './useAnalysis';

type MonteCarlo = Extract<SolverDetail, { problem: 'monte_carlo' }>;

/** P(clear) as the render prints it: one decimal, a whole number without it (`0%`, `4.5%`). */
const chance = (p: number) => fmt.pct(p).replace(/\.0%$/, '%');

/** The Monte Carlo detail of one scenario, read by cell. No statistics, no binning. */
function odds(detail: MonteCarlo) {
  const net = detail.percentiles.find((r) => r.cell === ODDS.net);
  const bar = detail.percentiles.find((r) => r.cell === ODDS.bar);
  const clear = detail.probabilities.find((r) => r.cell === ODDS.net && r.against === ODDS.bar);
  const hist = detail.histograms.find((h) => h.cell === ODDS.net);
  return {
    net,
    bar: bar?.p50,
    clear: clear?.p,
    // the contract's `lo` / `hi` are the chart's `from` / `to`: renamed, not recomputed
    bins: (hist?.bins ?? []).map((b) => ({ from: b.lo, to: b.hi, count: b.count })),
    iterations: detail.iterations,
  };
}

const detailOf = (tile: Analysis): MonteCarlo | null =>
  tile.result?.detail?.problem === 'monte_carlo' ? tile.result.detail : null;

function Chance({ name, tile }: { name: string; tile: Analysis }) {
  const detail = detailOf(tile);
  const clear = detail ? odds(detail).clear : undefined;
  return (
    <div className="gp-path-odds-col" data-scenario={name}>
      <span className="gp-path-faint">{name}</span>
      {typeof clear === 'number' ? (
        <span className="gp-path-odds-big" data-clear={clear}>
          {chance(clear)}
        </span>
      ) : (
        <button
          type="button"
          className="gp-path-btn"
          disabled={tile.busy}
          onClick={() => void tile.start()}
        >
          {COPY.runTrials(tile.trials === null ? null : fmt.fte(tile.trials))}
        </button>
      )}
    </div>
  );
}

/**
 * Odds (4 cols): the Monte Carlo `solver_run`s of the start scenario and the full-stretch preset.
 * P(`res.net` ≥ `res.bar`) for each, and the full-stretch net histogram with its P10/P50/P90 and
 * the bar line. A side-effect-free look-up shows what tier 2 holds; "Run N trials" (N is tier 2's,
 * from the look-up) runs one when a scenario has none. Every value is a metric tier 2 sent.
 */
export function OddsPanel({
  tenant,
  from,
  to,
}: {
  tenant: TenantSlug;
  /** The start scenario (the render's "Balanced"): its id and name. */
  from: { id: ScenarioId; name: string };
  /** The full-stretch preset (the render's "Full stretch"): its id and name. */
  to: { id: ScenarioId; name: string };
}) {
  const fromTile = useAnalysis(tenant, from.id, { problem: 'monte_carlo', ask: { quick: false, spec: oddsSpec } });
  const toTile = useAnalysis(tenant, to.id, { problem: 'monte_carlo', ask: { quick: false, spec: oddsSpec } });
  const toOdds = (() => {
    const detail = detailOf(toTile);
    return detail ? odds(detail) : null;
  })();

  const active = fromTile.jobId ?? toTile.jobId;
  const status = active ? (
    <JobHeader id={active} />
  ) : toOdds ? (
    <span className="gp-path-faint" data-iterations={toOdds.iterations}>
      {COPY.oddsRunsEach(fmt.fte(toOdds.iterations))}
    </span>
  ) : undefined;

  return (
    <GlassPanel
      span={4}
      className="gp-path-odds-panel"
      data-testid="path-odds"
      header={{ label: COPY.odds, status }}
    >
      <div className="gp-path-odds">
        <div className="gp-path-odds-row">
          <Chance name={from.name} tile={fromTile} />
          <Chance name={to.name} tile={toTile} />
        </div>
        {toOdds ? (
          <>
            <Histogram
              className="gp-path-hist"
              bins={toOdds.bins}
              p10={toOdds.net?.p10}
              p50={toOdds.net?.p50}
              p90={toOdds.net?.p90}
              bar={toOdds.bar}
              label={COPY.distribution(to.name)}
            />
            <p className="gp-path-faint gp-path-chart-note">{COPY.oddsNote}</p>
          </>
        ) : (
          <EmptyState
            line={COPY.notSimulated(to.name)}
            action={{
              label: COPY.runTrials(toTile.trials === null ? null : fmt.fte(toTile.trials)),
              disabled: toTile.busy,
              onAction: () => void toTile.start(),
            }}
          />
        )}
      </div>
    </GlassPanel>
  );
}
