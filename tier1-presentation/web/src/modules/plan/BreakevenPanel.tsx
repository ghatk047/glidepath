import type { Member, NodeDef, SolverDetail, VariableDef } from '@glidepath/api-contract';
import { fmt } from '@glidepath/ui/format';
import { GlassPanel } from '@glidepath/ui/glass';
import { Tag } from '../sourcing/parts';
import { BREAKEVEN_OUTPUT_NODE, COPY } from './copy';
import { RunError, RunStatus, byVariable, signedByNode, splitCell } from './parts';
import type { PlanRun } from './usePlanRun';

type Row = Extract<SolverDetail, { problem: 'breakeven' }>['rows'][number];

/** Reachable in the lever's range, reachable only outside it (registry range), or by no value. */
const standing = (r: Row): 'reachable' | 'beyond' | 'none' =>
  r.feasible ? 'reachable' : r.needed === null ? 'none' : 'beyond';
const ORDER = { reachable: 0, beyond: 1, none: 2 } as const;

/** The lever member a lever input belongs to (`lev.L03.pct` → `L03`), by its id text. */
const leverOf = (id: string): string | null => /^lev\.([^.]+)\./.exec(id)?.[1] ?? null;

/**
 * F1 · Breakeven by lever: tier 2's quick `breakeven` run (each lever-intensity input goal-sought alone to
 * `res.gap[] = 0`). Rows as tier 2 sent them, grouped reachable → outside range → not reachable; each shows the
 * current value, the value needed and the range searched, formatted by the registry unit. A row no value closes
 * shows tier 2's best value in range and the gap it leaves.
 */
export function BreakevenPanel({
  tile,
  variables,
  levers,
  nodes,
}: {
  tile: PlanRun;
  variables: readonly VariableDef[] | undefined;
  levers: readonly Member[] | undefined;
  nodes: readonly NodeDef[] | undefined;
}) {
  const gapNode = nodes?.find((n) => n.id === BREAKEVEN_OUTPUT_NODE);
  const detail = tile.result?.detail?.problem === 'breakeven' ? tile.result.detail : null;
  const rows = detail
    ? [...detail.rows].sort((a, b) => {
        const x = ORDER[standing(a)];
        const y = ORDER[standing(b)];
        return x < y ? -1 : x > y ? 1 : 0;
      })
    : [];
  // Tier 2's own counts (breakeven `metrics.feasible` of `metrics.rows`).
  const reachable = tile.result?.metrics['feasible'];
  const total = tile.result?.metrics['rows'];

  return (
    <GlassPanel
      level={1}
      data-testid="plan-breakeven"
      data-tour="plan-breakeven"
      header={{
        label: COPY.breakeven,
        status: (
          <RunStatus
            tile={tile}
            extra={
              detail && !tile.busy && reachable !== undefined && total !== undefined ? (
                <Tag tone={reachable > 0 ? 'pos' : 'warn'} title="Levers that close the gap alone, of all levers">
                  <span data-testid="plan-breakeven-count">{fmt.fte(reachable)}</span>/{fmt.fte(total)} alone
                </Tag>
              ) : null
            }
          />
        ),
      }}
      loading={!detail && !tile.error}
    >
      <div className="gp-src-body">
        <RunError tile={tile} />
        {detail && (
          <div className={tile.busy ? 'gp-src-scroll gp-src-stale' : 'gp-src-scroll'}>
            <ol className="gp-src-list" aria-label="Value each lever needs alone to close the gap">
              <li className="gp-src-row gp-plan-be gp-src-head" aria-hidden="true">
                <span>Lever input</span>
                <span className="gp-src-num">Now</span>
                <span className="gp-src-num">Needed</span>
                <span className="gp-src-num">Range</span>
                <span />
              </li>
              {rows.map((r) => {
                const { id } = splitCell(r.cell);
                const def = variables?.find((v) => v.id === id);
                const lever = leverOf(id);
                const name = levers?.find((m) => m.key === lever)?.label ?? lever ?? id;
                const s = standing(r);
                return (
                  <li key={r.cell} className="gp-src-row gp-plan-be" data-cell={r.cell} data-standing={s} data-muted={s === 'none' ? '' : undefined}>
                    <span className="gp-src-name" title={`${name} · ${def?.label ?? id}`}>
                      {name}
                      <span className="gp-src-sub"> · {def?.label ?? id}</span>
                    </span>
                    <span className="gp-src-num gp-src-sub">{byVariable(def, r.current)}</span>
                    <span className="gp-src-num" data-needed>
                      {s === 'none' && r.best != null ? (
                        <span className="gp-src-sub" data-best title="Closest value in range">
                          {COPY.best} {byVariable(def, r.best)}
                        </span>
                      ) : (
                        byVariable(def, r.needed)
                      )}
                    </span>
                    <span className="gp-src-num gp-src-sub">
                      {byVariable(def, r.min)}–{byVariable(def, r.max)}
                    </span>
                    <span>
                      {s === 'reachable' && <Tag tone="pos">{COPY.reachable}</Tag>}
                      {s === 'beyond' && <Tag tone="warn">{COPY.beyondRange}</Tag>}
                      {s === 'none' &&
                        (r.bestOutput != null ? (
                          <Tag tone="neg" title={`${COPY.notReachable}: the best value leaves this gap`}>
                            <span data-best-gap>gap {signedByNode(gapNode, r.bestOutput)}</span>
                          </Tag>
                        ) : (
                          <Tag tone="neg">{COPY.notReachable}</Tag>
                        ))}
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>
        )}
      </div>
    </GlassPanel>
  );
}
