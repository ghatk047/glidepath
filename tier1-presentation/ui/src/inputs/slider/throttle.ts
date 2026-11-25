/**
 * Preview cadence (07_frontend §3): previews go to tier 2 at most every 33 ms, latest value wins.
 * Leading edge: the first value in an idle window goes at once; values that arrive inside the
 * window replace each other and the last one goes when the window closes.
 */
export const PREVIEW_INTERVAL_MS = 33;

export interface LatestThrottle<T> {
  push(value: T): void;
  /** Drop a pending value and end the window (a commit supersedes it). */
  cancel(): void;
}

export function latestThrottle<T>(
  emit: (value: T) => void,
  intervalMs: number = PREVIEW_INTERVAL_MS,
): LatestThrottle<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: { value: T } | null = null;

  const tick = () => {
    if (pending) {
      const { value } = pending;
      pending = null;
      emit(value);
      timer = setTimeout(tick, intervalMs);
    } else timer = null;
  };

  return {
    push(value) {
      if (timer === null) {
        emit(value);
        timer = setTimeout(tick, intervalMs);
      } else pending = { value };
    },
    cancel() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      pending = null;
    },
  };
}
