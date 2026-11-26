import type { ScenarioId, SolverDetail, SolverResult, TenantSlug } from '@glidepath/api-contract';
import { fmt } from '@glidepath/ui/format';
import { ComputeFlow } from '@glidepath/ui/compute';
import { GlassPanel } from '@glidepath/ui/glass';
import {
  BAR_CELL,
  COPY,
  NET_CELL,
  NET_REF,
  PATH_POINT,
  RISK_EXPOSURE,
  RISK_REF,
  SCATTER_REFS,
} from './copy';
import { frontierSpec } from './params';
import { useAnalysis } from './useAnalysis';

type Pareto = Extract<SolverDetail, { problem: 'pareto' }>;

/** A number tier 2 sent, or undefined — so a point with a missing coordinate simply drops. */
const num = (v: number | undefined): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;

interface Point {
  readonly label: string;
  /** Risk exposure, $M (x). */
  readonly x: number;
  /** Net savings, $M (y). */
  readonly y: number;
  readonly path: boolean;
}

/** The labelled points, each from a (net, risk) pair tier 2 reports. Nothing is computed. */
function points(metrics: SolverResult['metrics']): Point[] {
  const out: Point[] = [];
  const px = num(metrics[RISK_EXPOSURE]);
  const py = num(metrics[NET_CELL]);
  if (px !== undefined && py !== undefined)
    out.push({ label: PATH_POINT, x: px, y: py, path: true });
  for (const ref of SCATTER_REFS) {
    const x = num(metrics[RISK_REF(ref.key)]);
    const y = num(metrics[NET_REF(ref.key)]);
    if (x !== undefined && y !== undefined) out.push({ label: ref.label, x, y, path: false });
  }
  return out;
}

/** viewBox geometry (prototype: 360 × 230, 40 kept for the net axis, 30 under the risk axis). */
const W = 360;
const H = 230;
const L = 40;
const R = 12;
const T = 12;
const B = 28;

/** [min, max] of the values, without `Math` (a plain scan: display scaling, not a calculation). */
function span(values: readonly number[]): [number, number] {
  let lo = values[0] ?? 0;
  let hi = values[0] ?? 1;
  for (const v of values) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return lo === hi ? [lo - 1, hi + 1] : [lo, hi];
}

/**
 * Savings vs risk (4 cols): net savings against risk exposure. The labelled points (C, Path, the
 * all-VP optimum and D) are the (net, risk) pairs tier 2 reports on the Path run; the dashed bar
 * line is `res.bar`. A `pareto` run's feasible points (ascending bar) draw the frontier line, the point at the
 * current `res.bar` marked, hidden when none exists. Tier 1 only scales the values it is handed to the svg; it computes no savings.
 */
export function SavingsRiskPanel({
  tenant,
  scenarioId,
  result,
}: {
  tenant: TenantSlug;
  scenarioId: ScenarioId;
  /** The Path run's result; its metrics carry the points and the bar line. */
  result: SolverResult | null;
}) {
  const frontier = useAnalysis(tenant, scenarioId, {
    problem: 'pareto',
    ask: { quick: false, spec: frontierSpec },
    autoStart: true,
  });
  const paretoDetail: Pareto | null =
    frontier.result?.detail?.problem === 'pareto' ? frontier.result.detail : null;
  // Tier 2's feasible points in ascending bar order (a sort by comparison; infeasible bars drop).
  const curve = (paretoDetail?.points ?? [])
    .filter(
      (p) =>
        p.feasible &&
        num(p.bar) !== undefined &&
        num(p.risk) !== undefined &&
        num(p.net) !== undefined,
    )
    .sort((a, b) => (a.bar < b.bar ? -1 : a.bar > b.bar ? 1 : 0));

  const pts = result ? points(result.metrics) : [];
  const bar = result ? num(result.metrics[BAR_CELL]) : undefined;

  const xs: number[] = [];
  const ys: number[] = [];
  for (const p of pts) {
    xs.push(p.x);
    ys.push(p.y);
  }
  for (const p of curve) {
    xs.push(p.risk);
    ys.push(p.net);
  }
  if (bar !== undefined) ys.push(bar);

  const [xlo, xhi] = span(xs);
  const [ylo, yhi] = span(ys);
  const padX = (xhi - xlo) * 0.12;
  const padY = (yhi - ylo) * 0.12;
  const x0 = xlo - padX;
  const x1 = xhi + padX;
  const y0 = ylo - padY;
  const y1 = yhi + padY;
  const sx = (v: number) => L + ((W - L - R) * (v - x0)) / (x1 - x0);
  const sy = (v: number) => T + (H - T - B) * (1 - (v - y0) / (y1 - y0));

  const curvePts = curve.map((p) => `${sx(p.risk)},${sy(p.net)}`).join(' ');
  const hasData = pts.length > 0;

  return (
    <GlassPanel
      span={4}
      className="gp-path-scatter-panel"
      data-testid="path-scatter"
      header={{
        label: COPY.savingsRisk,
        status: <span className="gp-path-faint">{COPY.savingsUnit}</span>,
      }}
    >
      <div className="gp-path-scatter-wrap" style={{ position: 'relative' }}>
        {frontier.busy && (
          <div
            data-testid="path-frontier-flow"
            style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
          >
            <ComputeFlow active variant="field" />
          </div>
        )}
        <svg
          className="gp-path-scatter"
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={hasData ? COPY.savingsChart : `${COPY.savingsChart}: no data yet`}
          data-chart="scatter"
        >
          <title>{COPY.savingsChart}</title>
          <line className="gp-path-axis" x1={L} y1={T} x2={L} y2={H - B} />
          <line className="gp-path-axis" x1={L} y1={H - B} x2={W - R} y2={H - B} />
          {curvePts !== '' && (
            <polyline className="gp-path-frontier" data-part="frontier" points={curvePts} />
          )}
          {bar !== undefined && (
            <g data-part="bar-line" data-value={bar}>
              <line className="gp-path-bar-line" x1={L} y1={sy(bar)} x2={W - R} y2={sy(bar)} />
              <text className="gp-path-bar-label" x={W - R} y={sy(bar) - 5} textAnchor="end">
                {COPY.barLineLabel(fmt.money(bar))}
              </text>
            </g>
          )}
          {curve.map((p) => {
            const isCurrent = bar !== undefined && p.bar === bar;
            return (
              <g
                key={p.bar}
                data-part="frontier-point"
                data-bar={p.bar}
                data-x={p.risk}
                data-y={p.net}
                data-current={isCurrent || undefined}
              >
                <circle
                  className="gp-path-frontier-dot"
                  data-current={isCurrent || undefined}
                  cx={sx(p.risk)}
                  cy={sy(p.net)}
                  r={isCurrent ? 5 : 3}
                >
                  <title>
                    {COPY.frontierPoint(fmt.money(p.bar), fmt.money(p.net), fmt.money(p.risk))}
                  </title>
                </circle>
              </g>
            );
          })}
          {pts.map((p) => (
            <g key={p.label} data-point={p.label} data-x={p.x} data-y={p.y}>
              <circle
                className="gp-path-dot"
                data-path={p.path || undefined}
                cx={sx(p.x)}
                cy={sy(p.y)}
                r={6}
              >
                <title>{`${p.label}: net ${fmt.money(p.y)}, risk ${fmt.money(p.x)}`}</title>
              </circle>
              <text className="gp-path-dot-label" x={sx(p.x) + 10} y={sy(p.y) + 4}>
                {p.label}
              </text>
            </g>
          ))}
        </svg>
      </div>
      <p className="gp-path-faint gp-path-chart-note">{COPY.frontierNote}</p>
    </GlassPanel>
  );
}
