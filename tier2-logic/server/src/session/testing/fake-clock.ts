import type { Clock, Timer } from '../clock';

/** A clock that only moves when told: `advance(ms)` fires every timer due, in due order. */
export class FakeClock implements Clock {
  private t = 0;
  private seq = 0;
  private readonly timers = new Map<number, { at: number; run: () => void }>();

  now(): number {
    return this.t;
  }

  after(ms: number, run: () => void): Timer {
    const id = ++this.seq;
    this.timers.set(id, { at: this.t + Math.max(0, ms), run });
    return { cancel: () => void this.timers.delete(id) };
  }

  /** Timers armed and not yet fired or cancelled. */
  get pending(): number {
    return this.timers.size;
  }

  advance(ms: number): void {
    const end = this.t + ms;
    for (;;) {
      let next: [number, { at: number; run: () => void }] | undefined;
      for (const e of this.timers) if (e[1].at <= end && (!next || e[1].at < next[1].at)) next = e;
      if (!next) break;
      this.timers.delete(next[0]);
      this.t = next[1].at;
      next[1].run();
    }
    this.t = end;
  }
}
