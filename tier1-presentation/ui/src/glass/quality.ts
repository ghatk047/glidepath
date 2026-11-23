/** Low-blur fallback triggers: prefers-reduced-transparency and frame-time sampling (07_frontend §5). */

export const REDUCED_TRANSPARENCY_QUERY = '(prefers-reduced-transparency: reduce)';

/** Frames below 40 fps at the 75th percentile switch glass to the low-blur fallback. */
export const LOW_BLUR_FRAME_MS = 1000 / 40;
export const FRAME_SAMPLE_COUNT = 60;
export const FRAME_WARMUP = 10;
/** Gaps longer than this many frame budgets are a hidden tab or a pause, not jank. */
const PAUSE_FACTOR = 10;

type MatchMedia = (query: string) => {
  matches: boolean;
  addEventListener?(type: 'change', l: (e: { matches: boolean }) => void): void;
  removeEventListener?(type: 'change', l: (e: { matches: boolean }) => void): void;
};

const browserMatchMedia = (): MatchMedia | undefined =>
  (globalThis as unknown as { matchMedia?: MatchMedia }).matchMedia?.bind(globalThis);

/** Calls `onChange` now and whenever the reduced-transparency preference changes. */
export function watchReducedTransparency(
  onChange: (reduce: boolean) => void,
  mm: MatchMedia | undefined = browserMatchMedia(),
): () => void {
  if (!mm) return () => {};
  const mql = mm(REDUCED_TRANSPARENCY_QUERY);
  onChange(mql.matches);
  const l = (e: { matches: boolean }) => onChange(e.matches);
  mql.addEventListener?.('change', l);
  return () => mql.removeEventListener?.('change', l);
}

/** 75th percentile frame time of the deltas, ignoring pauses. */
export function frameTimeP75(deltas: readonly number[], budgetMs = LOW_BLUR_FRAME_MS): number {
  const xs = deltas.filter((d) => d > 0 && d < budgetMs * PAUSE_FACTOR).sort((a, b) => a - b);
  if (xs.length === 0) return 0;
  return xs[Math.min(xs.length - 1, Math.floor(xs.length * 0.75))]!;
}

export const isSlow = (deltas: readonly number[], budgetMs = LOW_BLUR_FRAME_MS): boolean =>
  frameTimeP75(deltas, budgetMs) > budgetMs;

export interface FrameSamplerOptions {
  frames?: number;
  warmup?: number;
  budgetMs?: number;
  raf?: (cb: (t: number) => void) => number;
  cancelRaf?: (handle: number) => void;
}

/**
 * Samples `frames` animation-frame intervals (after `warmup` frames) and reports whether the
 * screen runs slower than the budget. Returns a stop function. No-op without rAF.
 */
export function sampleFrameTime(
  onResult: (slow: boolean, p75: number) => void,
  {
    frames = FRAME_SAMPLE_COUNT,
    warmup = FRAME_WARMUP,
    budgetMs = LOW_BLUR_FRAME_MS,
    raf = globalThis.requestAnimationFrame?.bind(globalThis),
    cancelRaf = globalThis.cancelAnimationFrame?.bind(globalThis),
  }: FrameSamplerOptions = {},
): () => void {
  if (!raf) return () => {};
  const deltas: number[] = [];
  let seen = 0;
  let last: number | null = null;
  let handle = 0;
  let stopped = false;
  const tick = (t: number) => {
    if (stopped) return;
    seen += 1;
    if (last !== null && seen > warmup) deltas.push(t - last);
    last = t;
    if (deltas.length >= frames) {
      stopped = true;
      onResult(isSlow(deltas, budgetMs), frameTimeP75(deltas, budgetMs));
      return;
    }
    handle = raf(tick);
  };
  handle = raf(tick);
  return () => {
    stopped = true;
    cancelRaf?.(handle);
  };
}
