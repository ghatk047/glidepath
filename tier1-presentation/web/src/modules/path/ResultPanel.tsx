import { useState } from 'react';
import {
  toCellKey,
  type SolverResult,
  type SolverRun,
  type VariableDef,
} from '@glidepath/api-contract';
import { fmt } from '@glidepath/ui/format';
import { GlassPanel } from '@glidepath/ui/glass';
import { StatusChip } from '@glidepath/ui/hud';
import { ComputeFlow } from '@glidepath/ui/compute';
import { MoveRow } from '@glidepath/ui/rows';
import { Value, useNode } from '../../bind';
import { EmptyState, RunIndicator } from '../../jobs';
import {
  COMPARE_ROWS,
  COPY,
  DEFAULT_OBJECTIVE,
  EVALUATIONS,
  FLOOR_NODE,
  METRIC,
  OBJECTIVES,
  RISK_EXPOSURE,
  STEPS,
} from './copy';
import { CheckIcon } from './icons';
import { useLanding } from './useLanding';
import { terminal } from './useSolverRun';

type Metrics = SolverResult['metrics'];

/** The hero number without its unit; the unit is drawn smaller beside it (render: `$143.0`M). */
const heroFormat = (v: number | undefined) => fmt.money(v).replace(/M$/, '');

/** `lev.L01.cut[]` → `lev.L01.cut`, `''`; `lev.start[L03]` → `lev.start`, `L03`. */
const splitCell = (cell: string): { id: string; member: string } => {
  const m = /^(.*)\[(.*)\]$/.exec(cell);
  return m ? { id: m[1]!, member: m[2]! } : { id: cell, member: '' };
};

/** References tier 2 reports beside the risk exposure (`risk_exposure[C]`), in its order. */
const REF = new RegExp(`^${RISK_EXPOSURE}\\[(.+)\\]$`);
function references(metrics: Metrics): { key: string; value: number }[] {
  return Object.entries(metrics).flatMap(([k, value]) => {
    const key = REF.exec(k)?.[1];
    return key === undefined ? [] : [{ key, value }];
  });
}

const cleared = (r: SolverResult) => r.status === 'optimal' || r.status === 'feasible';

function Stat({
  label,
  value,
  metric,
  note,
}: {
  label: string;
  value: string;
  metric: number | undefined;
  note?: string | null;
}) {
  return (
    <div className="gp-path-stat" data-metric={label}>
      <dt>{label}</dt>
      <dd>
        <span className="gp-path-stat-value" data-value={metric}>
          {value}
        </span>
        {note ? <span className="gp-path-stat-note">{note}</span> : null}
      </dd>
    </div>
  );
}

/** "unchanged" when the result keeps the start scenario's US headcount, else "from 2,692". */
function useHeadcountNote(metric: number | undefined): string | null {
  const now = useNode(FLOOR_NODE);
  if (metric === undefined || typeof now.value !== 'number') return null;
  return metric === now.value ? COPY.unchanged : COPY.fromNow(fmt.fte(now.value));
}

function Moves({
  run,
  from,
  variables,
}: {
  run: SolverRun;
  from: string;
  variables: readonly VariableDef[] | undefined;
}) {
  const ranked = run.result?.ranked ?? [];
  const shown = useLanding(run.id, ranked.length);
  if (ranked.length === 0) return null;
  return (
    <>
      <div className="gp-path-moves-head">
        <h3 className="gp-path-eyebrow">{COPY.moves(from)}</h3>
        <span className="gp-path-faint">{COPY.tick(from)}</span>
      </div>
      <ol className="gp-path-moves" aria-label={COPY.moves(from)} aria-busy={shown < ranked.length}>
        {ranked.slice(0, shown).map((move, i) => {
          const { id, member } = splitCell(move.cell);
          const def = variables?.find((v) => v.id === id);
          const label = def ? (member ? `${def.label} · ${member}` : def.label) : move.cell;
          return (
            <li key={move.cell} data-cell={move.cell} data-impact={move.impact}>
              <MoveRow
                variableId={id}
                label={label}
                from={move.from}
                to={move.to}
                min={def?.min ?? move.from}
                max={def?.max ?? move.to}
                unit={def?.unit ?? ''}
                step={def?.step ?? undefined}
                rank={i + 1}
                fromLabel={from}
              />
            </li>
          );
        })}
      </ol>
    </>
  );
}

function Compare({ from, metrics }: { from: string; metrics: Metrics }) {
  return (
    <table className="gp-path-compare" aria-label={COPY.compareTable(from)}>
      <thead>
        <tr>
          <th scope="col">
            <span className="gp-path-sr">Number</span>
          </th>
          <th scope="col">{from}</th>
          <th scope="col">{COPY.pathColumn}</th>
        </tr>
      </thead>
      <tbody>
        {COMPARE_ROWS.map((r) => {
          const m = metrics[toCellKey(r.node)];
          return (
            <tr key={r.node} data-node={r.node}>
              <th scope="row">{r.label}</th>
              <td data-side="start">
                <Value node={r.node} format={r.format} />
              </td>
              <td data-side="result" data-value={m}>
                {fmt[r.format](m)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function Result({
  run,
  from,
  pair,
  variables,
  onSave,
  saving,
  saveError,
}: {
  run: SolverRun;
  from: string;
  pair: { from: string; to: string } | null;
  variables: readonly VariableDef[] | undefined;
  onSave(): void;
  saving: boolean;
  saveError: string | null;
}) {
  const [comparing, setComparing] = useState(false);
  const result = run.result!;
  const m = result.metrics;
  const fte = m[METRIC.fteUs];
  const headcountNote = useHeadcountNote(fte);
  const refs = references(m);
  const lambda = result.detail?.problem === 'scenario_blend' ? result.detail.lambda : undefined;
  const ok = cleared(result);

  return (
    <div className="gp-path-result" data-testid="path-result" data-status={result.status}>
      <div className="gp-path-head">
        <div className="gp-path-hero-wrap">
          <span className="gp-path-hero" data-value={m[METRIC.net]}>
            {heroFormat(m[METRIC.net])}
            <span className="gp-path-hero-unit" aria-hidden="true">
              M
            </span>
          </span>
          {ok ? (
            <StatusChip status="clear" label={COPY.barCleared} />
          ) : m[METRIC.gap] !== undefined ? (
            <StatusChip gap={m[METRIC.gap]} />
          ) : (
            <StatusChip status="short" label={COPY.barShort} />
          )}
        </div>
        <dl className="gp-path-stats">
          {m[RISK_EXPOSURE] !== undefined && (
            <Stat
              label={COPY.riskExposure}
              value={fmt.money(m[RISK_EXPOSURE])}
              metric={m[RISK_EXPOSURE]}
              note={
                refs.length > 0
                  ? refs.map((r) => `${r.key}: ${fmt.money(r.value)}`).join(' · ')
                  : null
              }
            />
          )}
          {m[METRIC.oneTime] !== undefined && (
            <Stat
              label={COPY.oneTimeIt}
              value={fmt.money(m[METRIC.oneTime])}
              metric={m[METRIC.oneTime]}
            />
          )}
          {fte !== undefined && (
            <Stat label={COPY.usHeadcount} value={fmt.fte(fte)} metric={fte} note={headcountNote} />
          )}
          {m[METRIC.eps] !== undefined && (
            <Stat
              label={COPY.eps}
              value={fmt.signed(m[METRIC.eps], 'eps')}
              metric={m[METRIC.eps]}
            />
          )}
        </dl>
      </div>

      {pair && lambda !== undefined && (
        <p className="gp-path-lambda" data-value={lambda ?? undefined}>
          {lambda === null
            ? COPY.noBlend(pair.from, pair.to)
            : COPY.blendAt(fmt.pct(lambda, { digits: 0 }), pair.from, pair.to)}
        </p>
      )}

      <Moves run={run} from={from} variables={variables} />

      <div className="gp-path-actions">
        <button
          type="button"
          className="gp-path-btn"
          data-primary=""
          disabled={saving}
          onClick={onSave}
        >
          <CheckIcon />
          {saving ? COPY.saving : COPY.save}
        </button>
        <button
          type="button"
          className="gp-path-btn"
          aria-pressed={comparing}
          onClick={() => setComparing((c) => !c)}
        >
          {COPY.compare(from)}
        </button>
      </div>
      {saveError && (
        <p className="gp-path-problem" role="alert">
          {saveError}
        </p>
      )}
      {comparing && <Compare from={from} metrics={m} />}
    </div>
  );
}

export interface ResultPanelProps {
  run: SolverRun | null;
  jobId: string | null;
  busy: boolean;
  error: string | null;
  /** Name of the scenario the run started from (the render's "C"). */
  from: string;
  /** Names of the blend's two scenarios, for a `scenario_blend` run. */
  pair: { from: string; to: string } | null;
  variables: readonly VariableDef[] | undefined;
  onFind(): void;
  onSave(): void;
  saving: boolean;
  saveError: string | null;
}

function headerLabel(run: SolverRun | null, pair: ResultPanelProps['pair']): string {
  if (!run) return COPY.result;
  if (run.spec.problem === 'scenario_blend' && pair) return COPY.blendFound(pair.from, pair.to);
  const objective =
    run.spec.problem === 'min_risk_mix'
      ? (run.spec.params.objective ?? DEFAULT_OBJECTIVE)
      : DEFAULT_OBJECTIVE;
  const short = OBJECTIVES.find((o) => o.id === objective)?.short ?? objective;
  if (!terminal(run.status)) return COPY.searching(short);
  return run.result && cleared(run.result) ? COPY.found(short) : COPY.notFound(short);
}

/**
 * Result (8 cols): the solver run as tier 2 answered it. Progress while the job runs
 * (`JobHeader`), then net, bar chip, risk exposure (with the references tier 2 reports), one-time,
 * US headcount, EPS; the ranked moves land one by one in the optimizer's order; save as scenario
 * and compare with the start scenario. Every number is a metric of the run or a session cell.
 */
export function ResultPanel({
  run,
  jobId,
  busy,
  error,
  from,
  pair,
  variables,
  onFind,
  onSave,
  saving,
  saveError,
}: ResultPanelProps) {
  const done = run?.status === 'done' && run.result !== null;
  const m = run?.result?.metrics;
  const search =
    done && m && m[EVALUATIONS] !== undefined && m[STEPS] !== undefined ? (
      <span className="gp-path-faint" data-testid="path-search">
        {COPY.search(fmt.fte(m[EVALUATIONS]), fmt.fte(m[STEPS]))}
      </span>
    ) : null;

  return (
    <GlassPanel
      span={8}
      className="gp-path-result-panel"
      header={{
        label: headerLabel(run, pair),
        status: busy || jobId ? <RunIndicator busy={busy} jobId={jobId} /> : search,
      }}
    >
      {done ? (
        <Result
          key={run.id}
          run={run}
          from={from}
          pair={run.spec.problem === 'scenario_blend' ? pair : null}
          variables={variables}
          onSave={onSave}
          saving={saving}
          saveError={saveError}
        />
      ) : (
        <>
          {busy && (
            <div data-testid="path-flow" style={{ position: 'relative', height: '4rem' }}>
              <ComputeFlow active variant="field" />
            </div>
          )}
          <EmptyState
            line={
              error ??
              (run && terminal(run.status)
                ? (run.error?.detail ?? COPY.failed)
                : busy
                  ? COPY.finding
                  : COPY.empty)
            }
            action={{ label: COPY.find, onAction: onFind, disabled: busy }}
          />
        </>
      )}
    </GlassPanel>
  );
}
