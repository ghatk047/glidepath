import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  allShots,
  buildReport,
  CAPTURE_CSS,
  heightDelta,
  imageSize,
  MAX_DIFF_PIXELS,
  PIXEL_THRESHOLD,
  MODULES,
  reportSummary,
  THEMES,
  UX_DESKTOP_WIDTH,
  uxRenderName,
  VIEWPORT_HEIGHT,
  WIDTHS,
  type ReportEntry,
} from './visual';
import { baselineDirFor, collectEntries, uxScreensDir, writeRecord, writeReport } from './visual-report';

/** A header-only PNG of the given size (all `imageSize` reads). */
function png(width: number, height: number): Buffer {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'ascii');
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
}

describe('the screenshot matrix (G11)', () => {
  it('is 11 modules x 2 themes x the 2 presenter screens with unique keys', () => {
    const shots = allShots();
    expect(MODULES).toHaveLength(11);
    expect(THEMES).toHaveLength(2);
    expect(WIDTHS).toEqual([1280, 1920]);
    expect(VIEWPORT_HEIGHT).toEqual({ 1280: 720, 1920: 1080 });
    expect(shots).toHaveLength(44);
    expect(new Set(shots.map((s) => s.key)).size).toBe(44);
    expect(shots[0]!.key).toBe('cockpit-cruise-1280');
  });

  it('maps both screen sizes to the desktop render the UX pack drew at 1440', () => {
    const name = (module: (typeof MODULES)[number], theme: (typeof THEMES)[number]) =>
      uxRenderName({ module, theme });
    expect(UX_DESKTOP_WIDTH).toBe(1440);
    expect(name('cockpit', 'cruise')).toBe('cockpit-dark-1440.jpg');
    expect(name('cockpit', 'daylight')).toBe('cockpit-light-1440.jpg');
    expect(name('path', 'cruise')).toBe('solver-dark-1440.jpg');
    expect(name('excel', 'cruise')).toBe('data-dark-1440.jpg');
    const at = (width: 1280 | 1920) => allShots().find((s) => s.module === 'vps' && s.width === width)!;
    expect(uxRenderName(at(1280))).toBe(uxRenderName(at(1920)));
  });

  it('finds a render in docs/ux/screens/ for 22 of the 44 screens (11 desktop renders x 2 sizes)', () => {
    const files = new Set(readdirSync(uxScreensDir));
    const have = allShots().filter((s) => files.has(uxRenderName(s)));
    // the pack also holds four design pages (comps, ia, mood, story) and two phone renders
    expect(have).toHaveLength(22);
    for (const s of have) expect(files.has(uxRenderName(s))).toBe(true);
  });
});

describe('image sizes', () => {
  it('reads a PNG header', () => {
    expect(imageSize(png(2880, 3000))).toEqual({ width: 2880, height: 3000 });
  });
  it('reads the real UX renders (JPEG)', () => {
    const f = readFileSync(join(uxScreensDir, 'cockpit-dark-1440.jpg'));
    expect(imageSize(f)).toEqual({ width: 2880, height: 2806 });
    const phone = readFileSync(join(uxScreensDir, 'cockpit-dark-390.jpg'));
    expect(imageSize(phone)).toEqual({ width: 780, height: 6690 });
  });
  it('returns null for anything else', () => {
    expect(imageSize(Buffer.from('not an image at all, just text'))).toBeNull();
  });
});

describe('the reviewer report', () => {
  const entry = (over: Partial<ReportEntry> = {}): ReportEntry => ({
    module: 'cockpit',
    theme: 'cruise',
    width: 1920,
    key: 'cockpit-cruise-1920',
    status: 'approved',
    baseline: { href: 'baselines/cockpit-cruise-1920.png', size: { width: 3840, height: 3733 } },
    render: { href: 'ux-screens/cockpit-dark-1440.jpg', size: { width: 2880, height: 2806 } },
    ...over,
  });

  it('puts the render and the baseline side by side and says when a screen has no render', () => {
    const html = buildReport(
      [entry(), entry({ key: 'cockpit-cruise-1280', width: 1280, render: null })],
      { generated: '2026-11-23T00:00:00.000Z', baselineDir: 'e2e/visual/baselines/x', platform: 'x' },
    );
    expect(html).toContain('<img loading="lazy" src="ux-screens/cockpit-dark-1440.jpg"');
    expect(html).toContain('<img loading="lazy" src="baselines/cockpit-cruise-1920.png"');
    expect(html).toContain('data-key="cockpit-cruise-1280"');
    expect(html).toContain('The pack has no render of this screen.');
    expect(html).toContain('First approval');
  });

  it('flags a page whose height is more than 10% off the render, and only then', () => {
    expect(heightDelta(entry())).toBeCloseTo(-0.002, 3);
    const tall = entry({ baseline: { href: 'b.png', size: { width: 3840, height: 4800 } } });
    expect(heightDelta(tall)).toBeCloseTo(0.283, 2);
    expect(reportSummary([entry(), tall]).flagged).toBe(1);
    expect(heightDelta(entry({ render: null }))).toBeNull();
  });

  it('compares a baseline with a render of another width by scaling to the render', () => {
    const e = entry({
      width: 1280,
      baseline: { href: 'b.png', size: { width: 2560, height: 2400 } },
      render: { href: 'r.jpg', size: { width: 2880, height: 2700 } },
    });
    expect(heightDelta(e)).toBeCloseTo(0, 5); // 2400 px at 2560 wide is 2700 px at 2880 wide
  });
});

describe('writing the report from files (report generated)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'gp-visual-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('writes index.html with one pair per screen, copying the images next to it', () => {
    const baselineDir = join(dir, 'baselines');
    const runDir = join(dir, 'report', 'run');
    mkdirSync(baselineDir, { recursive: true });
    for (const s of allShots()) writeFileSync(join(baselineDir, `${s.key}.png`), png(s.width * 2, 3000));
    writeRecord({ key: 'cockpit-cruise-1920', status: 'approved' }, runDir);
    const actual = join(dir, 'actual.png');
    writeFileSync(actual, png(3840, 3010));
    writeRecord({ key: 'levers-cruise-1920', status: 'failed', actual, diff: actual }, runDir);

    const { file, entries, html } = writeReport(
      { baselineDir, uxDir: uxScreensDir, reportDir: join(dir, 'report'), runDir, platform: 'test' },
      new Date('2026-11-23T10:00:00Z'),
    );
    expect(file).toBe(join(dir, 'report', 'index.html'));
    expect(readFileSync(file, 'utf8')).toBe(html);
    expect(entries).toHaveLength(44);
    expect(html.match(/<section class="shot"/g)).toHaveLength(44);
    // every screen the pack has a render of shows that render beside the baseline, and the file is there
    const withRender = entries.filter((e) => e.render);
    expect(withRender).toHaveLength(22);
    for (const e of withRender) {
      expect(readdirSync(join(dir, 'report', 'ux-screens'))).toContain(e.render!.href.split('/')[1]);
      expect(readdirSync(join(dir, 'report', 'baselines'))).toContain(`${e.key}.png`);
    }
    expect(entries.find((e) => e.key === 'cockpit-cruise-1920')!.status).toBe('approved');
    const failed = entries.find((e) => e.key === 'levers-cruise-1920')!;
    expect(failed.status).toBe('failed');
    expect(failed.diff?.href).toBe('diff/levers-cruise-1920.png');
    expect(entries.find((e) => e.key === 'vps-cruise-1280')!.status).toBe('unchecked');
  });

  it('reports a screen with no baseline as missing, not as a pass', () => {
    const runDir = join(dir, 'report', 'run');
    writeRecord({ key: 'market-cruise-1920', status: 'passed' }, runDir);
    const entries = collectEntries({
      baselineDir: join(dir, 'none'),
      uxDir: uxScreensDir,
      reportDir: join(dir, 'report'),
      runDir,
      platform: 'test',
    });
    expect(entries.find((e) => e.key === 'market-cruise-1920')!.status).toBe('missing');
  });

  it('keeps baselines per platform', () => {
    expect(baselineDirFor('chromium-linux')).toMatch(/visual\/baselines\/chromium-linux$/);
  });
});

describe('the G11 threshold and capture style', () => {
  it('allows anti-aliasing noise only: an absolute count of at most 200 pixels, colour tolerance 0.1', () => {
    expect(PIXEL_THRESHOLD).toBe(0.1);
    expect(MAX_DIFF_PIXELS).toBeGreaterThanOrEqual(50);
    expect(MAX_DIFF_PIXELS).toBeLessThanOrEqual(200);
  });

  it('neutralises the flight strip and live blur during capture and leaves the desktop rail alone', () => {
    expect(CAPTURE_CSS).toMatch(/\.gp-hud\s*\{[^}]*visibility:\s*hidden/);
    expect(CAPTURE_CSS).toMatch(/\.gp-panel\s*\{[^}]*backdrop-filter:\s*none/);
    expect(CAPTURE_CSS).not.toMatch(/\.gp-rail/);
  });
});
