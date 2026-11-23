import { useMemo } from 'react';
import { toCellKey, type RankedMove, type VariableDef } from '@glidepath/api-contract';
import { fmt } from '@glidepath/ui/format';
import { GlassPanel } from '@glidepath/ui/glass';
import { formatByUnit } from '@glidepath/ui/inputs/slider';
import { useBindContext } from '../../bind';
import { useBundle } from '../../data';
import { useShellNavigation } from '../../global/shell';
import { EmptyState, JobHeader } from '../../jobs';
import { COPY, MOVE_LABELS, PATH_METRICS, PATH_TOP_MOVES } from './copy';
import { useTileRun } from './runs';

const NET = toCellKey(PATH_METRICS.net, '');

/** The variable id of a move's cell (`lev.L17.cola[]` → `lev.L17.cola`): text, not a lookup. */
const variableOf = (cell: string) => cell.slice(0, cell.indexOf('['));

/** "70% → 100%" in the registry unit and step of the variable (as the sliders print it). */
function valueText(def: VariableDef | undefined, v: number): string {
  return def ? formatByUnit(v, def.unit, def.step ?? 1) : String(v);
}

function PathGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <circle cx="5" cy="19" r="2" />
      <circle cx="19" cy="5" r="2" />
      <path d="M6.5 17.5L17.5 6.5" />
    </svg>
  );
}

function Move({ move, rank, def }: { move: RankedMove; rank: number; def?: VariableDef }) {
  const id = variableOf(move.cell);
  const label = MOVE_LABELS[id] ?? def?.label ?? id;
  const from = valueText(def, move.from);
  const to = valueText(def, move.to);
  return (
    <li className="gp-cockpit-move" data-variable-id={id} data-from={move.from} data-to={move.to}>
      <span className="gp-cockpit-rank" aria-hidden="true">
        {String(rank).padStart(2, '0')}
      </span>
      <span className="gp-cockpit-move-label">{label}</span>
      <span className="gp-cockpit-move-value">
        <span className="gp-cockpit-before">{from}</span> → {to}
      </span>
    </li>
  );
}

/**
 * Fastest path to the bar (4 cols): the scenario's min-risk (`min_risk_mix`, lowest risk
 * exposure) `solver_run` result: net (`metrics['res.net[]']`), the number of moves, risk
 * exposure, the people-lever clause, and tier 2's first three ranked moves "from → to".
 * "Show me a path" opens the Path module. Without a result: one line and the same action.
 */
export function FastestPathPanel() {
  const { tenant } = useBindContext();
  const bundle = useBundle(tenant);
  const tile = useTileRun('min_risk_mix');
  const { toModule } = useShellNavigation();
  const defs = useMemo(
    () => new Map<string, VariableDef>((bundle.data?.variables ?? []).map((v) => [v.id, v])),
    [bundle.data],
  );
  const result = tile.result;
  const active = tile.job.active || tile.run?.status === 'queued' || tile.run?.status === 'running';
  const go = () => toModule('path');

  const status =
    active || tile.run?.status === 'failed' || tile.run?.status === 'cancelled' ? (
      <JobHeader id={tile.run?.id} />
    ) : undefined;

  let body;
  if (result) {
    // tier 2 keys a cell metric by its wire cell key (API-13)
    const net = result.metrics[NET];
    const risk = result.metrics[PATH_METRICS.risk];
    const people = result.metrics[PATH_METRICS.people];
    const summary = [
      COPY.moves(result.ranked.length),
      risk === undefined ? null : COPY.riskExposure(fmt.money(risk)),
      people === undefined ? null : COPY.people(people),
    ].filter((s): s is string => s !== null);
    body = (
      <div className="gp-cockpit-col gp-cockpit-path" data-stale={tile.stale || undefined}>
        <span className="gp-cockpit-big" data-metric={NET} data-value={net}>
          {fmt.money(net)}
        </span>
        <span className="gp-cockpit-of" data-moves={result.ranked.length}>
          {summary.join(' · ')}
        </span>
        <ol className="gp-cockpit-moves" aria-label={COPY.topMoves}>
          {result.ranked.slice(0, PATH_TOP_MOVES).map((m, i) => (
            <Move key={m.cell} move={m} rank={i + 1} def={defs.get(variableOf(m.cell))} />
          ))}
        </ol>
        <div>
          <button type="button" className="gp-cockpit-primary" onClick={go}>
            <PathGlyph />
            {COPY.showPath}
          </button>
        </div>
      </div>
    );
  } else {
    body = <EmptyState line={COPY.noPath} action={{ label: COPY.showPath, onAction: go }} />;
  }

  return (
    <GlassPanel
      span={4}
      className="gp-cockpit-fastest"
      data-testid="cockpit-path"
      header={{ label: COPY.pathLabel, status }}
    >
      {body}
    </GlassPanel>
  );
}
