/** Counting semaphore: at most `size` holders at once, waiters served in order. */
export class Semaphore {
  private free: number;
  private readonly waiters: Array<{ grant: () => void; reject: (err: Error) => void }> = [];

  constructor(size: number) {
    if (!Number.isInteger(size) || size < 1) throw new Error('semaphore size must be a positive integer');
    this.free = size;
  }

  /** Resolves with a release function once a slot is free; rejects if {@link rejectWaiters} runs first. */
  acquire(): Promise<() => void> {
    const release = (): void => {
      const next = this.waiters.shift();
      if (next) next.grant();
      else this.free += 1;
    };
    if (this.free > 0) {
      this.free -= 1;
      return Promise.resolve(release);
    }
    return new Promise((resolve, reject) => {
      this.waiters.push({ grant: () => resolve(release), reject });
    });
  }

  /** Rejects everyone still waiting (shutdown). */
  rejectWaiters(err: Error): void {
    for (const w of this.waiters.splice(0)) w.reject(err);
  }
}
