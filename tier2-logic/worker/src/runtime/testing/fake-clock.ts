import type { Clock } from '../clock';

interface Timer {
  id: number;
  at: number;
  fn: () => void;
  every: number | null;
}

/** Manual clock: time moves only through `advance`, which fires due timers in order. */
export class FakeClock implements Clock {
  private t = 0;
  private nextId = 1;
  private timers: Timer[] = [];

  now(): number {
    return this.t;
  }

  setTimeout(fn: () => void, ms: number): unknown {
    const timer: Timer = { id: this.nextId++, at: this.t + ms, fn, every: null };
    this.timers.push(timer);
    return timer.id;
  }

  setInterval(fn: () => void, ms: number): unknown {
    const timer: Timer = { id: this.nextId++, at: this.t + ms, fn, every: ms };
    this.timers.push(timer);
    return timer.id;
  }

  clearTimeout(handle: unknown): void {
    this.timers = this.timers.filter((x) => x.id !== handle);
  }

  clearInterval(handle: unknown): void {
    this.clearTimeout(handle);
  }

  /** Timers still scheduled. */
  get pending(): number {
    return this.timers.length;
  }

  /** Moves time forward by `ms`, running every timer that comes due on the way. */
  advance(ms: number): void {
    const end = this.t + ms;
    for (;;) {
      const due = this.timers.filter((x) => x.at <= end).sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!due) break;
      this.t = due.at;
      if (due.every === null) this.timers = this.timers.filter((x) => x !== due);
      else due.at += due.every;
      due.fn();
    }
    this.t = end;
  }
}
