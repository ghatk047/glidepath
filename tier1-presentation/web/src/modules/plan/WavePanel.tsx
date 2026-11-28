import type { CSSProperties } from 'react';
import type { Member, SolverOutcome, SourcingParam } from '@glidepath/api-contract';
import { fmt } from '@glidepath/ui/format';
import { GlassPanel } from '@glidepath/ui/glass';
import { ParamStrip } from '../sourcing/ParamStrip';
import { Kpis, Tag, type Tone } from '../sourcing/parts';
import { COPY, GROUP } from './copy';
import { RunError, RunStatus, monthName, plain } from './parts';
import type { PlanRun } from './usePlanRun';

const TONE: Readonly<Record<SolverOutcome, Tone>> = {
  optimal: 'pos',
  feasible: 'accent',
  infeasible: 'neg',
  unreachable: 'neg',
  cancelled: undefined,
};

/**
 * F10 · Wave planner: tier 2's `wave_plan` worker run (lever start months under the quarterly one-time cap
 * and launch capacity, both `sourcing_param` members edited in place, then the run is asked again). Shows the
 * status, CY27 net before → after, one-time and launches per quarter against their caps (bars are CSS from
 * tier 2's numbers), the moved levers, and the binding constraints with their shadow prices. "Open as
 * scenario" saves the plan as a solver scenario and opens it.
 */
export function WavePanel({
  tile,
  params,
  levers,
  onCommitted,
  onOpen,
  opening,
  openError,
}: {
  tile: PlanRun;
  params: readonly SourcingParam[];
  levers: readonly Member[] | undefined;
  onCommitted(): void;
  onOpen(): void;
  opening: boolean;
  openError: string | null;
}) {
  const result = tile.result;
  const detail = result?.detail?.problem === 'wave_plan' ? result.detail : null;
  const moved = detail ? detail.levers.filter((l) => l.from !== l.to) : [];
  // Bar scales by comparison only: the largest one-time or cap, the largest launch count or capacity.
  let money = 0;
  let count = 0;
  for (const q of detail?.quarters ?? []) {
    if (q.oneTime > money) money = q.oneTime;
    if (q.cap !== null && q.cap > money) money = q.cap;
    if (q.launches > count) count = q.launches;
    if (q.launchCap !== null && q.launchCap > count) count = q.launchCap;
  }
  const nameOf = (lever: string) => levers?.find((m) => m.key === lever)?.label ?? lever;
  const canOpen = detail !== null && result?.status !== 'infeasible' && !tile.busy && !opening;

  return (
    <GlassPanel
      level={1}
      data-testid="plan-waves"
      data-tour="plan-wave"
      header={{
        label: COPY.waves,
        status: (
          <RunStatus
            tile={tile}
            extra={
              <>
                {result && !tile.busy && (
                  <Tag tone={TONE[result.status]}>
                    <span data-testid="plan-wave-status">{result.status}</span>
                  </Tag>
                )}
                <button
                  type="button"
                  className="gp-plan-open"
                  data-testid="plan-wave-open"
                  disabled={!canOpen}
                  onClick={onOpen}
                >
                  {opening ? COPY.opening : COPY.openScenario}
                </button>
              </>
            }
          />
        ),
      }}
      loading={!detail && !tile.error}
    >
      <div className="gp-src-body">
        <ParamStrip params={params} group={GROUP.wavePlan} onCommitted={onCommitted} />
        <RunError tile={tile} />
        {openError && (
          <p className="gp-src-error" role="alert">
            {openError}
          </p>
        )}
        {detail && result && (
          <div className={tile.busy ? 'gp-src-body gp-src-stale' : 'gp-src-body'} aria-busy={tile.busy || undefined}>
            <Kpis
              label="Wave plan"
              items={[
                {
                  id: 'net',
                  label: 'Net CY27',
                  value: (
                    <>
                      <span data-net="before">{fmt.money(detail.netBefore)}</span>
                      <small> → </small>
                      <span data-net="after">{fmt.money(detail.netAfter)}</span>
                    </>
                  ),
                },
                { id: 'moves', label: 'Moves', value: fmt.fte(moved.length) },
              ]}
            />
            <ol className="gp-plan-quarters" aria-label="One-time and launches per quarter against the caps">
              {detail.quarters.map((q) => (
                <li
                  key={q.quarter}
                  className="gp-plan-quarter"
                  data-quarter={q.quarter}
                  style={
                    {
                      '--ot': q.oneTime,
                      '--cap': q.cap ?? money,
                      '--ms': money,
                      '--ln': q.launches,
                      '--lc': q.launchCap ?? count,
                      '--cs': count,
                    } as CSSProperties
                  }
                >
                  <b>Q{q.quarter}</b>
                  <span className="gp-plan-qbar" data-capped={q.cap === null ? undefined : ''}>
                    <i aria-hidden="true" />
                    <s aria-hidden="true" />
                  </span>
                  <span className="gp-src-num" data-onetime>
                    {fmt.money(q.oneTime)}
                    <span className="gp-src-sub"> / {q.cap === null ? '—' : fmt.money(q.cap)}</span>
                  </span>
                  <span className="gp-plan-qbar gp-plan-qbar-launch" data-capped={q.launchCap === null ? undefined : ''}>
                    <i aria-hidden="true" />
                    <s aria-hidden="true" />
                  </span>
                  <span className="gp-src-num" data-launches>
                    {fmt.fte(q.launches)}
                    <span className="gp-src-sub"> / {q.launchCap === null ? '—' : fmt.fte(q.launchCap)}</span>
                  </span>
                </li>
              ))}
            </ol>
            {result.binding && result.binding.length > 0 && (
              <ul className="gp-src-binding" aria-label="Binding constraints">
                <li className="gp-src-sub">{COPY.bound}</li>
                {result.binding.map((b) => (
                  <li key={b.constraint} data-binding={b.constraint}>
                    <Tag tone="warn" title="Shadow price: net gained per unit of the cap">
                      {b.constraint} · {plain(b.shadowPrice)}
                    </Tag>
                  </li>
                ))}
              </ul>
            )}
            <div className="gp-src-scroll" tabIndex={0} role="group" aria-label={COPY.scrollWaves}>
              <ol className="gp-src-list" aria-label="Start month moves">
                {moved.map((l) => (
                  <li key={l.lever} className="gp-src-row gp-plan-wmove" data-wave-move={l.lever}>
                    <span className="gp-src-name" title={`${l.lever} · ${nameOf(l.lever)}`}>
                      {nameOf(l.lever)}
                    </span>
                    <span className="gp-src-num">
                      <span className="gp-src-sub">{monthName(l.from)}</span>
                      <span className="gp-src-arrow">→</span>
                      {monthName(l.to)}
                    </span>
                    <span className="gp-src-num gp-src-sub">Q{l.quarter}</span>
                  </li>
                ))}
              </ol>
              {moved.length === 0 && <p className="gp-src-note">{COPY.noMoves}</p>}
            </div>
          </div>
        )}
      </div>
    </GlassPanel>
  );
}
