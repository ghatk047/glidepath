import { describe, expect, it } from 'vitest';
import { PROGRESS_INTERVAL_MS } from './config';
import { ProgressThrottle } from './progress';
import type { ProgressUpdate } from './progress';
import { FakeClock } from './testing/fake-clock';

/** JOB-01: progress written to solver_run.progress at most every 250 ms (fake clock). */

const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

function harness(opts: { fail?: boolean; slow?: boolean } = {}) {
  const clock = new FakeClock();
  const writes: Array<{ at: number; update: ProgressUpdate }> = [];
  const errors: unknown[] = [];
  let release: (() => void) | null = null;
  const throttle = new ProgressThrottle(
    async (update) => {
      writes.push({ at: clock.now(), update });
      if (opts.slow) await new Promise<void>((r) => (release = r));
      if (opts.fail) throw new Error('db down');
    },
    clock,
    (e) => errors.push(e),
  );
  return { clock, writes, errors, throttle, release: () => release?.() };
}

describe('progress throttle (progress written to solver_run.progress at most every 250 ms)', () => {
  it('uses 250 ms as its interval', () => {
    expect(PROGRESS_INTERVAL_MS).toBe(250);
  });

  it('writes the first report at once and holds the rest back until the window ends', async () => {
    const h = harness();
    h.throttle.report(0.1, 'a');
    await flush();
    expect(h.writes).toEqual([{ at: 0, update: { fraction: 0.1, note: 'a' } }]);
    for (let i = 1; i <= 20; i++) {
      h.clock.advance(10);
      h.throttle.report(i / 40, `n${i}`);
    }
    await flush();
    expect(h.writes).toHaveLength(1);
    h.clock.advance(49);
    await flush();
    expect(h.writes).toHaveLength(1);
    h.clock.advance(1); // t = 250
    await flush();
    expect(h.writes).toHaveLength(2);
    expect(h.writes[1]).toEqual({ at: 250, update: { fraction: 0.5, note: 'n20' } });
  });

  it('never writes twice within 250 ms over a long burst of reports', async () => {
    const h = harness();
    for (let t = 0; t < 5000; t += 7) {
      h.clock.advance(7);
      h.throttle.report(t / 5000);
      await flush();
    }
    h.clock.advance(250);
    await flush();
    expect(h.writes.length).toBeGreaterThan(10);
    for (let i = 1; i < h.writes.length; i++) {
      expect(h.writes[i]!.at - h.writes[i - 1]!.at).toBeGreaterThanOrEqual(250);
    }
    const last = h.writes[h.writes.length - 1]!.update.fraction;
    expect(last).toBeCloseTo(4998 / 5000, 3);
  });

  it('writes again at once when a report comes after a quiet window', async () => {
    const h = harness();
    h.throttle.report(0.2);
    await flush();
    h.clock.advance(1000);
    h.throttle.report(0.4);
    await flush();
    expect(h.writes.map((w) => [w.at, w.update.fraction])).toEqual([
      [0, 0.2],
      [1000, 0.4],
    ]);
  });

  it('clamps to 0..1 and ignores non-finite values', async () => {
    const h = harness();
    h.throttle.report(Number.NaN);
    h.throttle.report(Number.POSITIVE_INFINITY);
    await flush();
    expect(h.writes).toHaveLength(0);
    h.throttle.report(1.7);
    await flush();
    h.clock.advance(250);
    h.throttle.report(-3);
    await flush();
    expect(h.writes.map((w) => w.update.fraction)).toEqual([1, 0]);
  });

  it('never overlaps writes: a slow write delays the next one', async () => {
    const h = harness({ slow: true });
    h.throttle.report(0.1);
    await flush();
    h.clock.advance(300);
    h.throttle.report(0.2);
    await flush();
    expect(h.writes).toHaveLength(1); // first write still in flight
    h.release();
    await flush();
    h.clock.advance(250);
    await flush();
    expect(h.writes.map((w) => w.update.fraction)).toEqual([0.1, 0.2]);
    h.release();
    await flush();
  });

  it('reports a failed write to onError and keeps going', async () => {
    const h = harness({ fail: true });
    h.throttle.report(0.1);
    await flush();
    expect(h.errors).toHaveLength(1);
    h.clock.advance(250);
    h.throttle.report(0.2);
    await flush();
    expect(h.writes).toHaveLength(2);
  });

  it('close() drops what has not been written and clears its timer', async () => {
    const h = harness();
    h.throttle.report(0.1);
    h.throttle.report(0.5);
    await flush();
    expect(h.clock.pending).toBe(1);
    await h.throttle.close();
    expect(h.clock.pending).toBe(0);
    h.clock.advance(1000);
    await flush();
    expect(h.writes).toHaveLength(1);
    h.throttle.report(0.9);
    await flush();
    expect(h.writes).toHaveLength(1);
  });
});
