import { describe, expect, it } from 'vitest';
import {
  formatReport,
  frameStats,
  hostIsBusy,
  latencyStats,
  percentile,
  type HostInfo,
  type Metric,
} from './perf';

describe('perf maths', () => {
  it('percentile is nearest-rank', () => {
    const xs = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(xs, 95)).toBe(95);
    expect(percentile(xs, 50)).toBe(50);
    expect(percentile([3, 1, 2], 100)).toBe(3);
    expect(percentile([], 95)).toBeNaN();
  });

  it('frameStats reads intervals from rAF timestamps', () => {
    const ts = [0];
    for (let i = 0; i < 99; i += 1) ts.push(ts[ts.length - 1]! + (i === 50 ? 50 : 16.6));
    const s = frameStats(ts);
    expect(s.frames).toBe(99);
    expect(s.p95).toBeCloseTo(16.6, 6);
    expect(s.max).toBeCloseTo(50, 6);
    expect(s.dropped).toBe(1);
    expect(s.fps).toBeGreaterThan(55);
  });

  it('latencyStats summarises round trips', () => {
    expect(latencyStats([5, 1, 3, 2, 4])).toMatchObject({ n: 5, min: 1, p50: 3, max: 5 });
  });

  it('a host with more load than cpus is busy and the report says so', () => {
    const host: HostInfo = {
      cpus: 4,
      load1: 12,
      platform: 'linux',
      browser: 'chromium',
      headless: true,
      deviceProfile: false,
      devicePixelRatio: 1,
    };
    expect(hostIsBusy(host)).toBe(true);
    const m: Metric = {
      name: 'x',
      label: 'p95 frame interval',
      value: 20,
      unit: 'ms',
      budget: 16.7,
      pass: false,
    };
    const out = formatReport(host, [m]);
    expect(out).toContain('NOT trustworthy');
    expect(out).toContain('OVER');
    expect(formatReport({ ...host, load1: 1 }, [{ ...m, pass: true }])).not.toContain('WARNING');
  });
});
