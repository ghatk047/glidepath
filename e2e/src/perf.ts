/**
 * Perf monitors (QA-08): the budgets and the pure maths behind `pnpm e2e:perf`. The numbers are the
 * non-functional targets of 01_architecture_overview §6 (60 fps while dragging, preview round trip
 * p95 < 25 ms) and the glass budget of 07_frontend §5; nothing here is a business number.
 */
import { GLASS_BLUR_BUDGET } from '@glidepath/ui/glass';

/** 60 fps while dragging: p95 frame interval at most 16.7 ms (QA-08 acceptance). */
export const FRAME_P95_BUDGET_MS = 16.7;
/** Preview round trip, browser to tier 2 and back through Caddy: p95 below 25 ms. */
export const PREVIEW_P95_BUDGET_MS = 25;
/** At most three backdrop-filter layers on screen. */
export const GLASS_LAYER_BUDGET = GLASS_BLUR_BUDGET;

/** Nearest-rank percentile (`p` in 0..100) of `xs`; NaN for no samples. */
export function percentile(xs: readonly number[], p: number): number {
  if (xs.length === 0) return Number.NaN;
  const sorted = [...xs].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[Math.min(sorted.length, rank) - 1]!;
}

export interface FrameStats {
  frames: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  /** Mean frames per second over the sampled span. */
  fps: number;
  /** Intervals longer than 1.5 frames at 60 Hz (a missed vsync or worse). */
  dropped: number;
}

/** Frame statistics from `requestAnimationFrame` timestamps (ms, ascending). */
export function frameStats(timestamps: readonly number[]): FrameStats {
  const deltas = timestamps.slice(1).map((t, i) => t - timestamps[i]!);
  const span = timestamps.length > 1 ? timestamps[timestamps.length - 1]! - timestamps[0]! : 0;
  return {
    frames: deltas.length,
    p50: percentile(deltas, 50),
    p95: percentile(deltas, 95),
    p99: percentile(deltas, 99),
    max: deltas.length ? Math.max(...deltas) : Number.NaN,
    fps: span > 0 ? (deltas.length * 1000) / span : Number.NaN,
    dropped: deltas.filter((d) => d > 1.5 * (1000 / 60)).length,
  };
}

export interface LatencyStats {
  n: number;
  min: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

export function latencyStats(ms: readonly number[]): LatencyStats {
  return {
    n: ms.length,
    min: ms.length ? Math.min(...ms) : Number.NaN,
    p50: percentile(ms, 50),
    p95: percentile(ms, 95),
    p99: percentile(ms, 99),
    max: ms.length ? Math.max(...ms) : Number.NaN,
  };
}

export interface HostInfo {
  cpus: number;
  /** 1-minute load average when the run started. */
  load1: number;
  platform: string;
  browser: string;
  headless: boolean;
  deviceProfile: boolean;
  devicePixelRatio: number;
}

/**
 * A busy host makes frame and latency numbers meaningless: they are still reported, and flagged
 * so nobody reads them as a device measurement. The budgets are never relaxed.
 */
export const hostIsBusy = (h: Pick<HostInfo, 'cpus' | 'load1'>): boolean => h.load1 > h.cpus;

export interface Metric {
  name: string;
  /** What the number is, e.g. `p95 frame interval`. */
  label: string;
  value: number;
  unit: string;
  /** The value must be at most the budget. */
  budget: number;
  pass: boolean;
  detail?: string;
}

const f = (v: number, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : 'n/a');

/** The metric table every perf run prints (and `--device` prints on the demo Mac). */
export function formatReport(host: HostInfo, metrics: readonly Metric[]): string {
  const lines = [
    '',
    'QA-08 performance monitors',
    `  host      ${host.platform}, ${host.cpus} cpus, load1 ${f(host.load1)}, ${host.browser}, ` +
      `${host.headless ? 'headless' : 'headed'}, dpr ${host.devicePixelRatio}` +
      (host.deviceProfile ? ', --device profile' : ''),
  ];
  if (hostIsBusy(host)) {
    lines.push(
      `  WARNING   host load ${f(host.load1)} exceeds ${host.cpus} cpus: frame and latency numbers ` +
        'below are NOT trustworthy; re-measure on a quiet machine (budgets are unchanged)',
    );
  }
  lines.push('');
  for (const m of metrics) {
    lines.push(
      `  ${m.pass ? 'PASS' : 'OVER'}  ${m.label.padEnd(34)} ${f(m.value).padStart(8)} ${m.unit}` +
        `  (budget <= ${m.budget} ${m.unit})${m.detail ? `  ${m.detail}` : ''}`,
    );
  }
  lines.push('');
  return lines.join('\n');
}
