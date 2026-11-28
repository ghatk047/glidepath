/**
 * Visual baselines (QA-06, G11): which screenshots exist, how they are named, which render of the
 * UX pack (`docs/ux/screens/`) each one is compared with on first approval, and the reviewer's
 * HTML report. Pure: no IO (the files are read and written in `visual-report.ts` and the spec).
 */

/** The eleven modules of the rail (contract ids), in site-map order. */
export const MODULES = [
  'cockpit',
  'wizard',
  'baseline',
  'levers',
  'vps',
  'path',
  'sourcing',
  'plan',
  'market',
  'excel',
  'airlines',
] as const;
export type VisualModule = (typeof MODULES)[number];

/** The two themes (`<html data-theme>`) and the tone the UX pack's file names give them. */
export const THEMES = ['cruise', 'daylight'] as const;
export type VisualTheme = (typeof THEMES)[number];
export const THEME_TONE: Readonly<Record<VisualTheme, 'dark' | 'light'>> = {
  cruise: 'dark',
  daylight: 'light',
};

/**
 * The presenter's two screens (CSS px): the 1280x720 laptop and the 1920x1080 monitor the demo
 * runs on full screen. Phones are out of scope (owner's direction), so there is no phone width.
 */
export const WIDTHS = [1280, 1920] as const;
export type VisualWidth = (typeof WIDTHS)[number];

/** Viewport heights of the two screens; the screenshots are full page, so a page taller than
 * this scrolls on that screen and shows as a taller baseline. */
export const VIEWPORT_HEIGHT: Readonly<Record<VisualWidth, number>> = { 1280: 720, 1920: 1080 };

/** The UX pack drew its desktop renders at 1440 px; both screens are compared with those. */
export const UX_DESKTOP_WIDTH = 1440;

/** The UX pack's renders are 2x full-page captures; the baselines are taken the same way. */
export const DEVICE_SCALE_FACTOR = 2;

/**
 * The G11 pixel threshold. `PIXEL_THRESHOLD` is Playwright's per-pixel colour tolerance (YIQ
 * distance, 0 strict .. 1 anything); `MAX_DIFF_PIXELS` is the absolute number of pixels allowed to
 * differ beyond it. It is absolute on purpose: a share of a tall 2x full-page image (0.2% of a
 * 780 x 4300 capture is about 6,700 pixels) is more than a reordered chip or a changed label, so
 * those slipped through. Anti-aliasing noise is a few dozen pixels; one changed word is hundreds.
 */
export const PIXEL_THRESHOLD = 0.1;
export const MAX_DIFF_PIXELS = 100;

/**
 * Injected during capture only (never in the product). Full-page capture lays `position: fixed`
 * elements out against the first viewport, so they land mid-page and cover panel headers. The
 * floating Net/Bar/Gap flight strip (`.gp-hud`) is hidden (its values are on the screen anyway;
 * `visibility` keeps the layout). Live backdrop blur is switched off: when few enough surfaces
 * share the budget (Build, VPs, Market, Excel, Airlines) they get real backdrop-filter layers, and
 * the Excel 1280 capture moved chips and borders by one device pixel from run to run although the
 * layout boxes were identical; without the blur the captures are stable. The blur sits over the pre-blurred sky, so the capture
 * looks the same without it. The desktop rail is sticky, draws at the top of the page and is left
 * alone.
 */
export const CAPTURE_CSS = `
.gp-hud { visibility: hidden !important; }
.gp-panel { -webkit-backdrop-filter: none !important; backdrop-filter: none !important; }
`;

/** A module's name in the UX pack's file names. */
const UX_NAME: Readonly<Record<VisualModule, string>> = {
  cockpit: 'cockpit',
  wizard: 'wizard', // the pack has no render of it
  baseline: 'baseline',
  levers: 'levers',
  vps: 'vps',
  path: 'solver', // the pack's "solver" render is the Path module
  sourcing: 'sourcing', // SRC: the pack has no render of it
  plan: 'plan', // SRC: the pack has no render of it
  market: 'market',
  excel: 'data', // the pack's "data" render is the Excel module
  airlines: 'airlines',
};

export interface Shot {
  module: VisualModule;
  theme: VisualTheme;
  width: VisualWidth;
  /** `cockpit-cruise-1920`: the baseline's file stem and the test's title. */
  key: string;
}

export const shotKey = (module: VisualModule, theme: VisualTheme, width: VisualWidth) =>
  `${module}-${theme}-${width}`;

/** All 11 x 2 x 2 shots, theme and width outermost so one browser context serves a run of them. */
export function allShots(): Shot[] {
  const shots: Shot[] = [];
  for (const theme of THEMES)
    for (const width of WIDTHS)
      for (const module of MODULES)
        shots.push({ module, theme, width, key: shotKey(module, theme, width) });
  return shots;
}

/** The UX pack's desktop render a shot is shown beside (it may not exist: the pack has 11 desktop
 * renders, so 22 of the 44 shots have one). Both screen sizes pair with the same 1440 render. */
export const uxRenderName = (s: Pick<Shot, 'module' | 'theme'>) =>
  `${UX_NAME[s.module]}-${THEME_TONE[s.theme]}-${UX_DESKTOP_WIDTH}.jpg`;

// ---------------------------------------------------------------------------------------------
// Image sizes (PNG baselines, JPEG renders), read from the file headers.

export interface ImageSize {
  width: number;
  height: number;
}

const PNG_MAGIC_HI = 0x89504e47;
const PNG_MAGIC_LO = 0x0d0a1a0a;
const JPEG_SOI = 0xffd8;

/** Pixel size of a PNG or JPEG, or null when the bytes are neither. */
export function imageSize(buf: Uint8Array): ImageSize | null {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  // PNG: signature, then the IHDR chunk (width and height at byte 16 and 20)
  if (buf.length >= 24 && v.getUint32(0) === PNG_MAGIC_HI && v.getUint32(4) === PNG_MAGIC_LO) {
    return { width: v.getUint32(16), height: v.getUint32(20) };
  }
  // JPEG: walk the segments to the first start-of-frame marker
  if (buf.length >= 4 && v.getUint16(0) === JPEG_SOI) {
    let at = 2;
    while (at + 9 < buf.length) {
      if (buf[at] !== 0xff) return null;
      const marker = buf[at + 1]!;
      if (marker === 0xff) {
        at += 1;
        continue;
      }
      const isSof =
        marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) return { height: v.getUint16(at + 5), width: v.getUint16(at + 7) };
      at += 2 + v.getUint16(at + 2);
    }
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// The reviewer's report.

export type ShotStatus = 'approved' | 'passed' | 'failed' | 'missing' | 'unchecked';

export interface ReportImage {
  /** href relative to the report page */
  href: string;
  size: ImageSize;
}

export interface ReportEntry extends Shot {
  /** This run: `approved` = baseline just written or updated (first approval), `passed` /
   * `failed` = compared with the approved baseline, `missing` = no baseline, `unchecked` = the
   * screen was not captured in this run (the baseline shown is the one on disk). */
  status: ShotStatus;
  baseline: ReportImage | null;
  /** The UX pack render of the same screen, when the pack has one. */
  render: ReportImage | null;
  /** What this run captured and its pixel diff, only when the comparison failed. */
  actual?: ReportImage | null;
  diff?: ReportImage | null;
}

/** A baseline is flagged when its page is this much taller or shorter than the render (share). */
export const HEIGHT_FLAG_RATIO = 0.1;

/** Height of the baseline relative to the render (same scale): +0.12 = 12% taller. */
export function heightDelta(e: Pick<ReportEntry, 'baseline' | 'render'>): number | null {
  if (!e.baseline || !e.render || e.render.size.height === 0) return null;
  const scale = e.render.size.width / e.baseline.size.width; // 1 when both are 2x
  return (e.baseline.size.height * scale - e.render.size.height) / e.render.size.height;
}

const isFlagged = (e: ReportEntry) => {
  const d = heightDelta(e);
  return d !== null && Math.abs(d) > HEIGHT_FLAG_RATIO;
};

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const dims = (i: ReportImage) => `${i.size.width} × ${i.size.height}`;
const PERCENT = 100;

function figure(label: string, img: ReportImage | null, empty: string, key: string): string {
  if (!img) {
    return `<figure data-slot="${esc(label)}" data-state="empty"><figcaption>${esc(label)}</figcaption><p class="empty">${esc(empty)}</p></figure>`;
  }
  return (
    `<figure data-slot="${esc(label)}"><figcaption>${esc(label)} <small>${dims(img)}</small></figcaption>` +
    `<a href="${esc(img.href)}" target="_blank" rel="noopener"><img loading="lazy" src="${esc(img.href)}" alt="${esc(`${label}: ${key}`)}"></a></figure>`
  );
}

const STATUS_WORD: Readonly<Record<ShotStatus, string>> = {
  approved: 'First approval',
  passed: 'Matches baseline',
  failed: 'Differs from baseline',
  missing: 'No baseline yet',
  unchecked: 'Not captured this run',
};

function row(e: ReportEntry): string {
  const delta = heightDelta(e);
  const flagged = isFlagged(e);
  const note =
    delta === null
      ? e.render
        ? ''
        : 'The UX pack has no render of this screen.'
      : `Page height ${delta >= 0 ? '+' : '−'}${Math.abs(delta * PERCENT).toFixed(1)}% against the render${flagged ? ' (check the layout)' : ''}.`;
  return (
    `<section class="shot" id="${esc(e.key)}" data-key="${esc(e.key)}" data-module="${e.module}" data-theme="${e.theme}" data-width="${e.width}" data-status="${e.status}" data-render="${e.render ? 'yes' : 'no'}" data-flag="${flagged ? 'height' : ''}">` +
    `<h3>${esc(e.module)} · ${e.theme} · ${e.width}px <span class="status" data-status="${e.status}">${STATUS_WORD[e.status]}</span></h3>` +
    (note ? `<p class="note"${flagged ? ' data-flag="height"' : ''}>${esc(note)}</p>` : '') +
    `<div class="pair w${e.width}">` +
    figure('UX pack render', e.render, 'The pack has no render of this screen.', e.key) +
    figure('Baseline', e.baseline, 'No baseline yet: pnpm e2e:visual -- --update.', e.key) +
    (e.status === 'failed'
      ? figure('This run', e.actual ?? null, 'Not captured.', e.key) +
        figure('Pixel diff', e.diff ?? null, 'Not produced.', e.key)
      : '') +
    `</div></section>`
  );
}

export interface ReportMeta {
  /** ISO time of the run */
  generated: string;
  /** Where the baselines live, for the reviewer */
  baselineDir: string;
  /** Playwright platform suffix of the baselines, e.g. `chromium-linux` */
  platform: string;
}

export function reportSummary(entries: readonly ReportEntry[]) {
  const by = (s: ShotStatus) => entries.filter((e) => e.status === s).length;
  return {
    total: entries.length,
    withRender: entries.filter((e) => e.render).length,
    withoutRender: entries.filter((e) => !e.render).length,
    approved: by('approved'),
    passed: by('passed'),
    failed: by('failed'),
    missing: by('missing'),
    unchecked: by('unchecked'),
    flagged: entries.filter(isFlagged).length,
  };
}

const STYLE = `
:root { --bg:#f6f7f9; --panel:#fff; --ink:#14181f; --muted:#5b6472; --line:#d8dde5; --ok:#1c7c4a; --warn:#9a6200; --bad:#b3261e; --accent:#2457c5; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg:#0d1118; --panel:#161b24; --ink:#e8ecf2; --muted:#9aa4b2; --line:#2b3340; --ok:#5fd394; --warn:#e8b04a; --bad:#ff8a80; --accent:#8db1ff; } }
:root[data-theme="dark"] { --bg:#0d1118; --panel:#161b24; --ink:#e8ecf2; --muted:#9aa4b2; --line:#2b3340; --ok:#5fd394; --warn:#e8b04a; --bad:#ff8a80; --accent:#8db1ff; }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--ink); font:15px/1.5 system-ui, sans-serif; }
main { max-width: 1600px; margin: 0 auto; padding: 24px 16px 64px; }
h1 { margin: 0 0 4px; font-size: 24px; } h2 { margin: 40px 0 8px; font-size: 20px; text-transform: capitalize; } h3 { margin: 0 0 4px; font-size: 16px; }
p { margin: 4px 0; } .lede { color: var(--muted); max-width: 70ch; }
table { border-collapse: collapse; margin: 16px 0; } th, td { text-align: left; padding: 4px 16px 4px 0; font-variant-numeric: tabular-nums; } th { color: var(--muted); font-weight: 500; }
nav { display:flex; flex-wrap:wrap; gap: 8px 16px; margin: 8px 0; } nav a { color: var(--accent); text-transform: capitalize; }
.filters { margin: 12px 0; display:flex; gap:16px; flex-wrap:wrap; align-items:center; } label { cursor:pointer; }
.shot { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 12px 16px 16px; margin: 12px 0; }
.status { font-size: 12px; font-weight: 600; padding: 1px 8px; border-radius: 999px; border: 1px solid currentColor; margin-left: 8px; }
.status[data-status="approved"], .status[data-status="passed"] { color: var(--ok); } .status[data-status="failed"] { color: var(--bad); } .status[data-status="missing"], .status[data-status="unchecked"] { color: var(--warn); }
.note { color: var(--muted); font-size: 13px; } .note[data-flag] { color: var(--warn); font-weight: 600; }
.pair { display:grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(0, 1fr)); align-items:start; margin-top: 8px; }
figure { margin:0; min-width:0; } figcaption { font-size: 13px; color: var(--muted); margin-bottom: 4px; } figcaption small { margin-left: 6px; }
img { display:block; width:100%; height:auto; border:1px solid var(--line); border-radius: 6px; background: var(--bg); }
.empty { border:1px dashed var(--line); border-radius:6px; padding: 24px 12px; color: var(--muted); font-size: 13px; text-align:center; }
@media (max-width: 760px) { .pair { grid-template-columns: 1fr; } }
`;

const SCRIPT = `
(() => {
  const a = document.getElementById('only-render'), b = document.getElementById('only-flag');
  const apply = () => document.querySelectorAll('.shot').forEach((el) => {
    el.hidden = (a.checked && el.dataset.render !== 'yes') || (b.checked && !el.dataset.flag && el.dataset.status !== 'failed');
  });
  a.addEventListener('change', apply); b.addEventListener('change', apply);
})();
`;

/** The self-contained reviewer report: every baseline beside the UX pack's render of the screen. */
export function buildReport(entries: readonly ReportEntry[], meta: ReportMeta): string {
  const s = reportSummary(entries);
  const modules = [...new Set(entries.map((e) => e.module))];
  const nav = modules.map((m) => `<a href="#module-${m}">${esc(m)}</a>`).join(' ');
  const sections = modules
    .map(
      (m) =>
        `<div class="module" id="module-${m}"><h2>${esc(m)}</h2>${entries
          .filter((e) => e.module === m)
          .map(row)
          .join('')}</div>`,
    )
    .join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Glidepath visual baselines</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<h1>Visual baselines (G11)</h1>
<p class="lede">Each screen as the app draws it (Baseline) beside the UX pack's render of the same screen (<code>docs/ux/screens/</code>). On first approval the reviewer reads the pairs here and decides. Later runs compare with the approved baseline at a colour tolerance of ${PIXEL_THRESHOLD} and at most ${MAX_DIFF_PIXELS} pixels differing.</p>
<table data-slot="summary">
<tr><th>Screens (11 modules × 2 themes × 2 screen sizes)</th><td data-count="total">${s.total}</td></tr>
<tr><th>With a UX pack render</th><td data-count="with-render">${s.withRender}</td></tr>
<tr><th>Without a render in the pack</th><td data-count="without-render">${s.withoutRender}</td></tr>
<tr><th>First approvals this run</th><td data-count="approved">${s.approved}</td></tr>
<tr><th>Matching their baseline</th><td data-count="passed">${s.passed}</td></tr>
<tr><th>Differing from their baseline</th><td data-count="failed">${s.failed}</td></tr>
<tr><th>No baseline</th><td data-count="missing">${s.missing}</td></tr>
<tr><th>Not captured this run</th><td data-count="unchecked">${s.unchecked}</td></tr>
<tr><th>Page height more than ${HEIGHT_FLAG_RATIO * PERCENT}% off the render</th><td data-count="flagged">${s.flagged}</td></tr>
<tr><th>Generated</th><td>${esc(meta.generated)}</td></tr>
<tr><th>Baselines</th><td><code>${esc(meta.baselineDir)}</code> (${esc(meta.platform)})</td></tr>
</table>
<nav aria-label="Modules">${nav}</nav>
<div class="filters" role="group" aria-label="Filter">
<label><input type="checkbox" id="only-render"> only screens with a render</label>
<label><input type="checkbox" id="only-flag"> only flagged or failed</label>
</div>
${sections}
</main>
<script>${SCRIPT}</script>
</body>
</html>
`;
}
