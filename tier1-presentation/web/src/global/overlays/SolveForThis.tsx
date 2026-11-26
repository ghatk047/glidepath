import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { ApiError, toCellKey, type ScenarioId, type TenantSlug } from '@glidepath/api-contract';
import { ComputeFlow } from '@glidepath/ui/compute';
import { GlassPanel } from '@glidepath/ui/glass';
import { useApiClient } from '../../data';

/** The output goal seek drives to its target: the plan's gap to the bar, `res.gap = 0`. */
export const SOLVE_OUTPUT = 'res.gap';
/** Target of the output: tier 2's own definition of "on the bar" (a spec constant, not a business number). */
const SOLVE_TARGET = 0;

export const SOLVE_COPY = {
  action: 'Solve for this',
  title: 'Solve so the gap closes',
  running: 'Solving',
  apply: 'Apply',
  found: (value: string) => `Value found: ${value}`,
  unreachable: (best: string) => `Not reachable in range. Best value: ${best}`,
  failed: 'The solve failed.',
} as const;

/** Variable kinds a goal seek makes sense for (not simulation draws); types must be numeric. */
export const solvable = (d: { type: string; kind: string }): boolean =>
  (d.type === 'number' || d.type === 'int') && (d.kind === 'decision' || d.kind === 'estimate');

type State =
  | { phase: 'idle' }
  | { phase: 'running' }
  | { phase: 'found'; value: number; reachable: boolean }
  | { phase: 'failed'; line: string };

const lineOf = (e: unknown): string =>
  e instanceof ApiError ? e.problem.detail : e instanceof Error ? e.message : SOLVE_COPY.failed;

/**
 * "Solve for this" under an input's edit popover: one quick `goal_seek` run of the open input
 * against `res.gap = 0` (tier 2 searches the registry range). Shows the value tier 2 found, or
 * "not reachable in range" with the closest value it reports. Apply hands that value to the
 * popover's own commit path. Nothing is computed here.
 */
export function SolveForThis({
  tenant,
  scenarioId,
  cell,
  format,
  onApply,
}: {
  tenant: TenantSlug;
  scenarioId: ScenarioId;
  /** `var[member]` of the open input. */
  cell: string;
  /** The popover's display transform for the input. */
  format: (v: number) => string;
  onApply: (value: number) => void;
}) {
  const api = useApiClient();
  const [state, setState] = useState<State>({ phase: 'idle' });
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const live = useRef(0);

  // hang the strip under the popover it belongs to (the popover is fixed-positioned by the ui kit)
  useLayoutEffect(() => {
    const host = document.querySelector<HTMLElement>('.gp-pop[role="dialog"]');
    const r = host?.getBoundingClientRect();
    if (r && (pos === null || pos.x !== r.left || pos.y !== r.bottom + 6)) {
      setPos({ x: r.left, y: r.bottom + 6 });
    }
  });

  const solve = () => {
    const ticket = ++live.current;
    setState({ phase: 'running' });
    api
      .solverRunQuick({
        params: { tenant },
        body: {
          scenarioId,
          save: false,
          spec: {
            problem: 'goal_seek',
            params: {
              var: cell as ReturnType<typeof toCellKey>,
              output: toCellKey(SOLVE_OUTPUT),
              target: SOLVE_TARGET,
            },
          },
        },
      })
      .then((run) => {
        if (live.current !== ticket) return;
        const detail = run.result?.detail;
        if (run.status === 'done' && detail?.problem === 'goal_seek') {
          setState({ phase: 'found', value: detail.value, reachable: detail.reachable });
        } else {
          setState({ phase: 'failed', line: run.error?.detail ?? SOLVE_COPY.failed });
        }
      })
      .catch((e: unknown) => {
        if (live.current === ticket) setState({ phase: 'failed', line: lineOf(e) });
      });
  };

  const style: CSSProperties & Record<`--${string}`, string> = {};
  if (pos) {
    style['--gp-pop-x'] = `${pos.x}px`;
    style['--gp-pop-y'] = `${pos.y}px`;
  }

  return (
    <GlassPanel
      as="div"
      level={3}
      padding="tight"
      className="gp-pop gp-solve"
      role="region"
      aria-label={SOLVE_COPY.title}
      data-tour="solve-for-this"
      data-phase={state.phase}
      style={style}
    >
      <div
        className="gp-pop-actions"
        style={{ marginTop: 0, justifyContent: 'space-between', alignItems: 'center' }}
      >
        {state.phase === 'running' ? (
          <div
            data-testid="solve-flow"
            role="status"
            aria-label={SOLVE_COPY.running}
            style={{ position: 'relative', height: '1.5rem', flex: 1 }}
          >
            <ComputeFlow active variant="inline" />
          </div>
        ) : (
          <button type="button" className="gp-btn" data-variant="ghost" onClick={solve}>
            {SOLVE_COPY.action}
          </button>
        )}
        {state.phase === 'found' && (
          <>
            <span role="status" data-testid="solve-result" data-reachable={state.reachable}>
              {state.reachable
                ? SOLVE_COPY.found(format(state.value))
                : SOLVE_COPY.unreachable(format(state.value))}
            </span>
            {state.reachable && (
              <button
                type="button"
                className="gp-btn"
                data-variant="primary"
                onClick={() => {
                  onApply(state.value);
                  setState({ phase: 'idle' });
                }}
              >
                {SOLVE_COPY.apply}
              </button>
            )}
          </>
        )}
        {state.phase === 'failed' && (
          <span role="status" data-testid="solve-error">
            {state.line}
          </span>
        )}
      </div>
    </GlassPanel>
  );
}
