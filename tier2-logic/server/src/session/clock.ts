/**
 * Time as sessions see it: the preview rate cap and the idle close (API-07) read `now` and arm timers
 * through this port, so tests drive them with a fake clock (`testing/fake-clock.ts`).
 */

/** An armed timer; `cancel` is a no-op once it has fired. */
export interface Timer {
  cancel(): void;
}

export interface Clock {
  /** Milliseconds, monotonic. */
  now(): number;
  /** Runs `run` once, `ms` from now. Real timers are unref'd: they never keep the process alive. */
  after(ms: number, run: () => void): Timer;
}

export const systemClock: Clock = {
  now: () => performance.now(),
  after(ms, run) {
    const t = setTimeout(run, Math.max(0, ms));
    t.unref();
    return { cancel: () => clearTimeout(t) };
  },
};
