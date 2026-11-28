import type { CSSProperties } from 'react';
import { STRESS_SCALE_MAX, STRESS_SCALE_MIN, type CellKey, type NodeDef } from '@glidepath/api-contract';
import { Stepper } from '@glidepath/ui/inputs/controls';
import { parseNumber } from '@glidepath/ui/inputs/editable';
import { fmt } from '@glidepath/ui/format';
import { GlassPanel } from '@glidepath/ui/glass';
import { COPY, SCALE_STEP, STRESS_COLUMNS } from './copy';
import { RunError, RunStatus, signedByNode, splitCell } from './parts';
import type { PlanRun } from './usePlanRun';

type Catalog = readonly { name: string; set?: Record<string, number | string>; shift?: Record<string, number> }[];

/** A shock's definition as tier 2 wrote it, for its chip's title: `lev.L03.pct = 0 · lev.start +3`. */
const definition = (c: Catalog[number]): string =>
  [
    ...Object.entries(c.set ?? {}).map(([id, v]) => `${id} = ${String(v)}`),
    ...Object.entries(c.shift ?? {}).map(([id, v]) => `${id} ${fmt.fte(v, { signed: true })}`),
  ].join(' · ');

/**
 * F3 · Stress tests: tier 2's quick `stress_presets` run. The shocks are tier 2's (`detail.catalog`, every shock
 * with its definition); chips switch one off or on and a stepper sets each shock's size (a run parameter,
 * `scales[name]`, 1 = as written), and the run is asked again. Each shock shows the deltas tier 2 reports
 * (`detail.presets[].delta`: net, gap, EPS, risk-adjusted net) as diverging bars with their values; bar lengths
 * are CSS from tier 2's numbers (`--d` over the column's largest swing).
 */
export function StressPanel({
  tile,
  nodes,
  catalog,
  off,
  scales,
  onToggle,
  onScale,
}: {
  tile: PlanRun;
  nodes: readonly NodeDef[] | undefined;
  /** Every shock tier 2 knows (from the last result); empty until the first run answers. */
  catalog: Catalog;
  /** Shocks switched off. */
  off: ReadonlySet<string>;
  /** Sizes the viewer set, by shock name (absent = 1). */
  scales: Readonly<Record<string, number>>;
  onToggle(name: string): void;
  onScale(name: string, scale: number): void;
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
  let onCount = 0;
  for (const c of catalog) if (!off.has(c.name)) onCount++;

  return (
    <GlassPanel
      level={1}
      data-testid="plan-stress"
      data-tour="plan-stress"
      header={{ label: COPY.stress, status: <RunStatus tile={tile} /> }}
      loading={!detail && !tile.error}
    >
      <div className="gp-src-body">
        {catalog.length > 0 && (
          <ul className="gp-plan-chips" aria-label={COPY.presets}>
            {catalog.map((c) => {
              const on = !off.has(c.name);
              return (
                <li key={c.name}>
                  <button
                    type="button"
                    className="gp-plan-chip"
                    aria-pressed={on}
                    title={definition(c)}
                    disabled={tile.busy || (on && onCount === 1)}
                    data-preset-toggle={c.name}
                    onClick={() => onToggle(c.name)}
                  >
                    {c.name}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <RunError tile={tile} />
        {detail && (
          <div className={tile.busy ? 'gp-src-scroll gp-src-stale' : 'gp-src-scroll'}>
            <table className="gp-plan-stress" aria-label="Effect of each shock">
              <thead>
                <tr>
                  <th scope="col" title="Shock">Shock</th>
                  <th scope="col" className="gp-plan-scale-col" title={COPY.scale}>
                    {COPY.scale}
                  </th>
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
                    <td className="gp-plan-scale" data-scale={p.name}>
                      <Stepper
                        variableId={`stress.scale[${p.name}]`}
                        label={`${COPY.scale} · ${p.name}`}
                        value={scales[p.name] ?? p.scale ?? 1}
                        step={SCALE_STEP}
                        min={STRESS_SCALE_MIN}
                        max={STRESS_SCALE_MAX}
                        format={(v) => fmt.mult(v)}
                        parse={parseNumber}
                        onChange={(v) => onScale(p.name, v)}
                      />
                    </td>
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
