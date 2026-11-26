import type { CSSProperties } from 'react';
import type { CellKey, NodeDef } from '@glidepath/api-contract';
import { GlassPanel } from '@glidepath/ui/glass';
import { COPY, STRESS_COLUMNS, STRESS_PRESETS } from './copy';
import { RunError, RunStatus, signedByNode, splitCell } from './parts';
import type { PlanRun } from './usePlanRun';

/**
 * F3 · Stress tests: tier 2's quick `stress_presets` run over the chosen named shocks. Each shock shows the
 * deltas tier 2 reports (`detail.presets[].delta`, keyed by wire cell: net, gap, EPS) as diverging bars with
 * their values; bar lengths are CSS from tier 2's numbers (`--d` over the column's largest swing). Shocks are
 * toggled on and off and the run asked again; their sizes are tier 2's (the contract takes names only).
 */
export function StressPanel({
  tile,
  nodes,
  chosen,
  onChoose,
}: {
  tile: PlanRun;
  nodes: readonly NodeDef[] | undefined;
  /** Shock names in the current question (spec order). */
  chosen: readonly string[];
  /** A new set of shock names: the run is asked again. */
  onChoose(next: readonly string[]): void;
}) {
  const detail = tile.result?.detail?.problem === 'stress_presets' ? tile.result.detail : null;
  const presets = detail?.presets ?? [];
  const cells = presets[0] ? (Object.keys(presets[0].delta) as CellKey[]) : [];
  // Largest swing each way per column, by comparison only (the bars' CSS scale).
  const scale = new Map<string, { hi: number; lo: number }>();
  for (const cell of cells) {
    let hi = 0;
    let lo = 0;
    for (const p of presets) {
      const d = p.delta[cell];
      if (d === undefined) continue;
      if (d > hi) hi = d;
      if (d < lo) lo = d;
    }
    scale.set(cell, { hi, lo });
  }
  const nodeOf = (cell: string) => nodes?.find((n) => n.id === splitCell(cell).id);
  const toggle = (name: string) => {
    const on = chosen.includes(name);
    if (on && chosen.length === 1) return;
    onChoose(STRESS_PRESETS.filter((n) => (n === name ? !on : chosen.includes(n))));
  };

  return (
    <GlassPanel
      level={1}
      data-testid="plan-stress"
      data-tour="plan-stress"
      header={{ label: COPY.stress, status: <RunStatus tile={tile} /> }}
      loading={!detail && !tile.error}
    >
      <div className="gp-src-body">
        <ul className="gp-plan-chips" aria-label={COPY.presets} title={COPY.sizesFixed}>
          {STRESS_PRESETS.map((name) => (
            <li key={name}>
              <button
                type="button"
                className="gp-plan-chip"
                aria-pressed={chosen.includes(name)}
                disabled={tile.busy}
                data-preset-toggle={name}
                onClick={() => toggle(name)}
              >
                {name}
              </button>
            </li>
          ))}
        </ul>
        <RunError tile={tile} />
        {detail && (
          <div className={tile.busy ? 'gp-src-scroll gp-src-stale' : 'gp-src-scroll'}>
            <table className="gp-plan-stress" aria-label="Effect of each shock">
              <thead>
                <tr>
                  <th scope="col">Shock</th>
                  {cells.map((cell) => (
                    <th key={cell} scope="col" title={nodeOf(cell)?.label ?? cell}>
                      {STRESS_COLUMNS[cell] ?? nodeOf(cell)?.label ?? cell}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {presets.map((p) => (
                  <tr key={p.name} data-preset={p.name}>
                    <th scope="row" className="gp-src-name" title={p.name}>
                      {p.name}
                    </th>
                    {cells.map((cell) => {
                      const d = p.delta[cell];
                      const s = scale.get(cell)!;
                      return (
                        <td key={cell} data-delta={cell}>
                          {d === undefined ? null : (
                            <span
                              className="gp-plan-div"
                              data-sign={d < 0 ? 'neg' : d > 0 ? 'pos' : undefined}
                              style={{ '--d': d, '--hi': s.hi, '--lo': s.lo } as CSSProperties}
                            >
                              <i aria-hidden="true" />
                              <b>{signedByNode(nodeOf(cell), d)}</b>
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </GlassPanel>
  );
}
