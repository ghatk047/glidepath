import type { Clock } from './clock';
import { PROGRESS_INTERVAL_MS } from './config';

export interface ProgressUpdate {
  /** 0..1 */
  readonly fraction: number;
  /** Undefined keeps the previous note. */
  readonly note: string | undefined;
}

/**
 * Coalesces `progress(fraction, note)` calls into writes at most `intervalMs` apart (03 section 4:
 * 250 ms). The first call writes at once; calls inside the window keep only the latest value, which is
 * written when the window ends. Writes never overlap. A failed write is reported to `onError` and
 * dropped: progress is advisory and must not fail the job.
 */
export class ProgressThrottle {
  private pending: ProgressUpdate | null = null;
  private lastWriteAt = Number.NEGATIVE_INFINITY;
  private inFlight: Promise<void> | null = null;
  private timer: unknown = null;
  private closed = false;

  constructor(
    private readonly write: (update: ProgressUpdate) => Promise<void>,
    private readonly clock: Clock,
    private readonly onError: (err: unknown) => void = () => undefined,
    private readonly intervalMs: number = PROGRESS_INTERVAL_MS,
  ) {}

  /** Records the latest progress; non-finite fractions are ignored, others clamped to 0..1. */
  report(fraction: number, note?: string): void {
    if (this.closed || !Number.isFinite(fraction)) return;
    this.pending = { fraction: Math.min(1, Math.max(0, fraction)), note };
    this.schedule();
  }

  private schedule(): void {
    if (this.closed || this.pending === null || this.inFlight !== null || this.timer !== null) return;
    const wait = this.lastWriteAt + this.intervalMs - this.clock.now();
    if (wait <= 0) {
      this.writeNow();
    } else {
      this.timer = this.clock.setTimeout(() => {
        this.timer = null;
        this.writeNow();
      }, wait);
    }
  }

  private writeNow(): void {
    const update = this.pending;
    if (update === null || this.closed) return;
    this.pending = null;
    this.lastWriteAt = this.clock.now();
    this.inFlight = this.write(update)
      .catch((err: unknown) => this.onError(err))
      .finally(() => {
        this.inFlight = null;
        this.schedule();
      });
  }

  /** Stops scheduling, drops anything not yet written (the job's final write supersedes it) and waits for a write in flight. */
  async close(): Promise<void> {
    this.closed = true;
    this.pending = null;
    if (this.timer !== null) {
      this.clock.clearTimeout(this.timer);
      this.timer = null;
    }
    await this.inFlight;
  }
}
