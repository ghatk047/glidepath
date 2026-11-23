import { cpus, loadavg, platform } from 'node:os';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AppModule,
  PREVIEW_MIN_INTERVAL_MS,
  WS_PROTOCOL_VERSION,
  WS_SESSION_PATH,
  toCellKey,
} from '@glidepath/api-contract';
import { config, readRepoJson } from '@glidepath/int';
import type { Page } from '@playwright/test';
import { expect, HEADLINE, test } from '../tests/fixtures';
import {
  FRAME_P95_BUDGET_MS,
  GLASS_LAYER_BUDGET,
  PREVIEW_P95_BUDGET_MS,
  formatReport,
  frameStats,
  latencyStats,
  type HostInfo,
  type Metric,
} from '../src/perf';

/**
 * QA-08 performance monitors against the compose stack, reached through Caddy like a browser:
 *
 * 1. `drag_frame_p95_within_60fps`: frame-time sampling (rAF) during a lever drag on Cockpit.
 * 2. `preview_round_trip_p95_under_25ms`: browser -> Caddy -> tier 2 -> browser, one `preview`
 *    frame answered by its `delta`, sequentially (no coalescing), over the page's own origin.
 * 3. `glass_layers_within_budget_on_every_module`: at most three backdrop-filter layers on screen.
 * 4. `report`: prints every metric in one table (`pnpm e2e:perf -- --device` runs the same on the
 *    demo Mac in a headed browser).
 *
 * Budgets are the spec's and are never relaxed; on a busy host the report flags the numbers as
 * untrustworthy instead.
 */

/** The slider that moves `res.target` (spec id, verbatim). */
const TARGET = 'g.target_net';
interface RegistryVariable {
  id: string;
  min: number | null;
  max: number | null;
  step: number | null;
}
const targetDef = readRepoJson<{ variables: RegistryVariable[] }>(
  'docs',
  'spec',
  'variables.json',
).variables.find((v) => v.id === TARGET);

const DEVICE = process.env.GP_PERF_DEVICE === '1';
/** Drag: moves per sweep, sweeps, warm-up frames dropped from the sample. */
const DRAG_MOVES = 90;
const DRAG_SWEEPS = 3;
const FRAME_WARMUP = 5;
/** Preview round trips measured, after a warm-up the numbers do not include. */
const PREVIEW_SAMPLES = 200;
const PREVIEW_WARMUP = 20;
/** drag.frame_p95, preview.round_trip_p95, glass.layers */
const EXPECTED_METRICS = 3;

/**
 * Metrics are kept in `perf-report.json` (git-ignored; reset by `perf.mjs`), not in memory: the tests
 * are independent, so one over-budget metric does not hide the others, and a Playwright worker
 * restart after a failure does not lose the numbers already measured.
 */
const REPORT = join(import.meta.dirname, '..', 'perf-report.json');
interface Report {
  host: HostInfo;
  metrics: Metric[];
}
const readReport = (fallback: HostInfo): Report =>
  existsSync(REPORT)
    ? (JSON.parse(readFileSync(REPORT, 'utf8')) as Report)
    : { host: fallback, metrics: [] };
let host: HostInfo;
const record = (m: Omit<Metric, 'pass'>): Metric => {
  const full: Metric = { ...m, pass: m.value <= m.budget };
  const report = readReport(host);
  report.host = { ...host, load1: Math.max(host.load1, report.host.load1) };
  report.metrics = [...report.metrics.filter((x) => x.name !== m.name), full];
  writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);
  return full;
};
const printNow = (m: Metric) =>
  process.stdout.write(
    `  ${m.pass ? 'PASS' : 'OVER'}  ${m.label}: ${m.value.toFixed(2)} ${m.unit} (budget <= ${m.budget})${m.detail ? `  ${m.detail}` : ''}\n`,
  );

test.describe('QA-08 performance monitors', () => {
  let page: Page;
  let presetC: string;

  test.beforeAll(async ({ browser, stack }) => {
    presetC = stack.presets.get('C')!.id;
    host = {
      cpus: cpus().length,
      load1: loadavg()[0]!,
      platform: `${platform()} ${process.arch}`,
      browser: `chromium ${browser.version()}`,
      headless: !DEVICE,
      deviceProfile: DEVICE,
      devicePixelRatio: 1,
    };
    page = await browser.newPage();
    await stack.signInPage(page);
  });
  test.afterAll(async () => {
    await page.close();
  });

  test('drag_frame_p95_within_60fps', async () => {
    if (targetDef?.min == null || targetDef.max == null)
      throw new Error(`registry has no bounded ${TARGET}`);
    const { min, max } = { min: targetDef.min, max: targetDef.max };
    await page.goto(`/${config.tenant}/${presetC}/cockpit`);
    const slider = page.locator(`[data-variable-id="${TARGET}"] input[type="range"]`);
    await expect(slider).toBeVisible();
    // let the first paint, module chunks and the glass frame sampler settle before sampling
    await page.waitForTimeout(1500);
    host.devicePixelRatio = await page.evaluate(() => window.devicePixelRatio);

    // control: the same page idle for 90 frames. Not a budget; it shows how much of the drag number is
    // the machine (a busy host misses vsyncs with nothing happening)
    const idle = frameStats(
      await page.evaluate(
        () =>
          new Promise<number[]>((resolve) => {
            const stamps: number[] = [];
            const tick = (t: number) => {
              stamps.push(t);
              if (stamps.length >= 90) resolve(stamps);
              else requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
          }),
      ),
    );

    const box = (await slider.boundingBox())!;
    const y = box.y + box.height / 2;
    const at = (v: number) => box.x + ((v - min) / (max - min)) * box.width;
    const from = Number(await slider.inputValue());

    await page.evaluate(() => {
      const w = window as unknown as { __perf: { stamps: number[]; long: number; on: boolean } };
      w.__perf = { stamps: [], long: 0, on: true };
      const tick = (t: number) => {
        if (!w.__perf.on) return;
        w.__perf.stamps.push(t);
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      new PerformanceObserver((l) => (w.__perf.long += l.getEntries().length)).observe({
        type: 'longtask',
        buffered: false,
      });
    });

    await page.mouse.move(at(from), y);
    await page.mouse.down();
    // one pointer move per frame, sweeping the registry range back and forth: a real drag
    const nextFrame = () =>
      page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => r())));
    for (let s = 0; s < DRAG_SWEEPS; s += 1) {
      for (let i = 0; i <= DRAG_MOVES; i += 1) {
        const k = s % 2 === 0 ? i / DRAG_MOVES : 1 - i / DRAG_MOVES;
        await page.mouse.move(at(min + k * (max - min)), y);
        await nextFrame();
      }
    }
    const { stamps, long } = await page.evaluate(() => {
      const w = window as unknown as { __perf: { stamps: number[]; long: number; on: boolean } };
      w.__perf.on = false;
      return { stamps: w.__perf.stamps, long: w.__perf.long };
    });
    await page.mouse.up();

    const stats = frameStats(stamps.slice(FRAME_WARMUP));
    const quality = await page.locator('.gp-aurora').first().getAttribute('data-quality');
    const m = record({
      name: 'drag.frame_p95',
      label: `lever drag p95 frame interval`,
      value: stats.p95,
      unit: 'ms',
      budget: FRAME_P95_BUDGET_MS,
      detail: `p50 ${stats.p50.toFixed(1)}, p99 ${stats.p99.toFixed(1)}, max ${stats.max.toFixed(1)} ms; ${stats.fps.toFixed(1)} fps over ${stats.frames} frames; ${stats.dropped} dropped; ${long} long tasks; glass quality ${quality}; idle control p95 ${idle.p95.toFixed(1)} ms, ${idle.dropped} dropped of ${idle.frames}`,
    });
    printNow(m);
    expect(stats.frames, 'frames sampled during the drag').toBeGreaterThan(DRAG_MOVES);
    expect(stats.p95, m.detail).toBeLessThanOrEqual(FRAME_P95_BUDGET_MS);
  });

  test('preview_round_trip_p95_under_25ms', async ({ stack }) => {
    if (targetDef?.step == null) throw new Error(`registry has no step for ${TARGET}`);
    void stack;
    await page.goto(`/${config.tenant}/${presetC}/cockpit`);
    await expect(page.getByRole('main', { name: 'Cockpit' })).toBeVisible();
    await page.waitForTimeout(1000);

    const target = toCellKey(TARGET);
    const url = `${config.baseUrl.replace(/^http/, 'ws')}${WS_SESSION_PATH}?${new URLSearchParams({
      tenant: config.tenant,
      scenario: presetC,
    }).toString()}`;
    // runs in the page: its own origin, cookies and TLS to Caddy, like the SPA's socket
    const ms = await page.evaluate(
      async (a) => {
        const ws = new WebSocket(a.url);
        const frames: {
          type: string;
          seq?: number | null;
          cells?: Record<string, number | null>;
        }[] = [];
        let wake: (() => void) | null = null;
        ws.onmessage = (e) => {
          frames.push(JSON.parse(String(e.data)));
          wake?.();
        };
        const wait = (pred: (f: (typeof frames)[number]) => boolean, ms = 5000) =>
          new Promise<(typeof frames)[number]>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error(`no frame within ${ms} ms`)), ms);
            const look = () => {
              const i = frames.findIndex(pred);
              if (i < 0) return false;
              const [f] = frames.splice(i, 1);
              clearTimeout(timer);
              resolve(f!);
              return true;
            };
            if (look()) return;
            wake = () => {
              if (look()) wake = null;
            };
          });
        await new Promise<void>((resolve, reject) => {
          ws.onopen = () => resolve();
          ws.onerror = () => reject(new Error('WebSocket failed to open through Caddy'));
        });
        ws.send(JSON.stringify({ v: a.v, type: 'subscribe', cells: [a.target, ...a.headline] }));
        const snap = await wait((f) => f.type === 'snapshot');
        const current = snap.cells![a.target];
        if (typeof current !== 'number') throw new Error('snapshot carries no target value');
        const out: number[] = [];
        let sentAt = Number.NEGATIVE_INFINITY;
        for (let n = 1; n <= a.warmup + a.samples; n += 1) {
          const value = n % 2 === 1 ? current + a.step : current;
          // paced like the SPA's client: one preview per PREVIEW_MIN_INTERVAL_MS (the server caps
          // reruns at that rate), so the round trip excludes the rate limiter's own wait
          const pause = sentAt + a.interval - performance.now();
          if (pause > 0) await new Promise((r) => setTimeout(r, pause));
          const t0 = (sentAt = performance.now());
          ws.send(
            JSON.stringify({
              v: a.v,
              type: 'preview',
              seq: n,
              changes: [{ var: a.variable, member: '', value }],
            }),
          );
          await wait((f) => f.type === 'delta' && f.seq === n);
          if (n > a.warmup) out.push(performance.now() - t0);
        }
        ws.send(JSON.stringify({ v: a.v, type: 'cancelPreview', seq: a.warmup + a.samples + 1 }));
        ws.close();
        return out;
      },
      {
        url,
        v: WS_PROTOCOL_VERSION,
        target,
        variable: TARGET,
        headline: HEADLINE.map((id) => toCellKey(id)),
        step: targetDef.step,
        interval: PREVIEW_MIN_INTERVAL_MS,
        warmup: PREVIEW_WARMUP,
        samples: PREVIEW_SAMPLES,
      },
    );

    const s = latencyStats(ms);
    const m = record({
      name: 'preview.round_trip_p95',
      label: 'preview round trip p95',
      value: s.p95,
      unit: 'ms',
      budget: PREVIEW_P95_BUDGET_MS,
      detail: `min ${s.min.toFixed(1)}, p50 ${s.p50.toFixed(1)}, p99 ${s.p99.toFixed(1)}, max ${s.max.toFixed(1)} ms over ${s.n} previews`,
    });
    printNow(m);
    expect(s.n).toBe(PREVIEW_SAMPLES);
    expect(s.p95, m.detail).toBeLessThan(PREVIEW_P95_BUDGET_MS);
  });

  test('glass_layers_within_budget_on_every_module', async () => {
    let worst = 0;
    let worstAt = '';
    const rows: string[] = [];
    for (const module of AppModule.options) {
      await page.goto(`/${config.tenant}/${presetC}/${module}`);
      await expect(page.locator('.gp-panel').first(), `${module} renders glass`).toBeVisible();
      await page.waitForTimeout(500);
      const layers = await blurredLayers(page);
      rows.push(`${module}=${layers}`);
      if (layers > worst) {
        worst = layers;
        worstAt = module;
      }
      expect(layers, `backdrop-filter layers on ${module}`).toBeLessThanOrEqual(GLASS_LAYER_BUDGET);
    }
    // an overlay on top (the lever popover on Cockpit) still keeps within the budget
    await page.goto(`/${config.tenant}/${presetC}/cockpit`);
    await page.locator('[data-node="res.bar"]').click();
    await expect(page.locator('.gp-pop[role="dialog"]')).toBeVisible();
    const withOverlay = await blurredLayers(page);
    rows.push(`cockpit+popover=${withOverlay}`);
    expect(
      withOverlay,
      'backdrop-filter layers on cockpit with the edit popover open',
    ).toBeLessThanOrEqual(GLASS_LAYER_BUDGET);
    worst = Math.max(worst, withOverlay);
    const m = record({
      name: 'glass.layers',
      label: 'backdrop-filter layers on screen (max)',
      value: worst,
      unit: 'layers',
      budget: GLASS_LAYER_BUDGET,
      detail: `${rows.join(' ')}${worstAt ? ` (worst ${worstAt})` : ''}`,
    });
    printNow(m);
  });

  test('report', () => {
    const report = readReport(host);
    process.stdout.write(formatReport(report.host, report.metrics));
    expect(report.metrics.length, 'metrics measured').toBe(EXPECTED_METRICS);
    expect(
      report.metrics.every((m) => m.pass),
      'every metric within its budget',
    ).toBe(true);
  });
});

/** Visible elements whose computed `backdrop-filter` is not `none`. */
function blurredLayers(page: Page): Promise<number> {
  return page.evaluate(() => {
    let n = 0;
    for (const el of document.querySelectorAll('*')) {
      const cs = getComputedStyle(el);
      const bf = cs.backdropFilter || cs.getPropertyValue('-webkit-backdrop-filter');
      if (!bf || bf === 'none') continue;
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none')
        n += 1;
    }
    return n;
  });
}
