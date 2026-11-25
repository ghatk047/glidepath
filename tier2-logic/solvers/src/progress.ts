/** A monotonic millisecond clock; injectable so tests run on a fake one. */
export interface Clock {
  now(): number;
}

/** `performance.now()` where present, else `Date.now()`. */
export const systemClock: Clock = {
  now: () => (typeof performance === 'undefined' ? Date.now() : performance.now()),
};

/** 03 §4: a job writes progress at most every 250 ms. */
export const PROGRESS_INTERVAL_MS = 250;

/** `progress(fraction, note)` callback of `runSolver` (the worker's throttled writer, or the session's). */
export type ProgressFn = (fraction: number, note?: string) => void;

/**
 * Throttles `progress(fraction, note)` to at most one call per `intervalMs`, without timers: the first
 * report passes at once; reports inside the window keep only the latest, which passes on the first
 * `report` or `tick` after the window ends. Fractions are clamped to 0..1; non-finite ones are dropped.
 * A note that is absent keeps the last note given (the coalesced call carries it).
 */
export class ProgressThrottle {
  private last = Number.NEGATIVE_INFINITY;
  private pending: { fraction: number; note: string | undefined } | null = null;
  private note: string | undefined;

  constructor(
    private readonly sink: ProgressFn | undefined,
    private readonly clock: Clock,
    private readonly intervalMs: number = PROGRESS_INTERVAL_MS,
  ) {}

  report(fraction: number, note?: string): void {
    if (this.sink === undefined || !Number.isFinite(fraction)) return;
    if (note !== undefined) this.note = note;
    this.pending = { fraction: Math.min(1, Math.max(0, fraction)), note: this.note };
    this.tick();
  }

  /** Passes the pending report if the window has ended. */
  tick(): void {
    if (this.pending === null || this.sink === undefined) return;
    const now = this.clock.now();
    if (now - this.last < this.intervalMs) return;
    const { fraction, note } = this.pending;
    this.pending = null;
    this.last = now;
    if (note === undefined) this.sink(fraction);
    else this.sink(fraction, note);
  }
}
