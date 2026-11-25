import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  allShots,
  buildReport,
  imageSize,
  uxRenderName,
  type ReportEntry,
  type ReportImage,
  type Shot,
  type ShotStatus,
} from './visual';

/**
 * The IO half of the G11 report (QA-06): finds each shot's approved baseline, the UX pack's render
 * of the same screen and what the last run recorded, copies the images next to the page (so the
 * report folder can be zipped and sent) and writes `index.html`.
 */

export const e2eRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const repoRootDir = resolve(e2eRoot, '..');

/** Per-platform baselines: fonts and rasterisation differ between a Linux container and a Mac. */
export const baselinePlatform = () => `chromium-${process.platform}`;
export const baselineRoot = join(e2eRoot, 'visual', 'baselines');
export const baselineDirFor = (platform = baselinePlatform()) => join(baselineRoot, platform);
export const uxScreensDir = join(repoRootDir, 'docs', 'ux', 'screens');
/** Generated, git-ignored. */
export const reportDir = join(e2eRoot, 'visual-report');
/** What each shot's test recorded in this run (status, failure artefacts). */
export const runDir = join(reportDir, 'run');

/** What the spec records per shot (`visual-report/run/<key>.json`). */
export interface RunRecord {
  key: string;
  status: Exclude<ShotStatus, 'unchecked'>;
  /** absolute paths of the failure artefacts Playwright wrote */
  actual?: string;
  diff?: string;
}

export const recordPath = (key: string, dir = runDir) => join(dir, `${key}.json`);

export function writeRecord(rec: RunRecord, dir = runDir): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(recordPath(rec.key, dir), JSON.stringify(rec));
}

function readRecord(key: string, dir: string): RunRecord | null {
  const p = recordPath(key, dir);
  return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as RunRecord) : null;
}

export interface ReportPaths {
  baselineDir: string;
  uxDir: string;
  reportDir: string;
  runDir: string;
  platform: string;
}

export const defaultPaths = (): ReportPaths => ({
  baselineDir: baselineDirFor(),
  uxDir: uxScreensDir,
  reportDir,
  runDir,
  platform: baselinePlatform(),
});

/** Copies `from` into `<report>/<group>/<name>` and describes it for the page, or null. */
function place(
  from: string | undefined,
  out: string,
  group: string,
  name: string,
): ReportImage | null {
  if (!from || !existsSync(from)) return null;
  const buf = readFileSync(from);
  const size = imageSize(buf);
  if (!size) return null;
  mkdirSync(join(out, group), { recursive: true });
  copyFileSync(from, join(out, group, name));
  return { href: `${group}/${name}`, size };
}

/** One report entry per shot of the matrix, whether or not it ran. */
export function collectEntries(paths: ReportPaths, shots: readonly Shot[] = allShots()): ReportEntry[] {
  return shots.map((shot) => {
    const rec = readRecord(shot.key, paths.runDir);
    const baseline = place(join(paths.baselineDir, `${shot.key}.png`), paths.reportDir, 'baselines', `${shot.key}.png`);
    const renderName = uxRenderName(shot);
    const render = place(join(paths.uxDir, renderName), paths.reportDir, 'ux-screens', renderName);
    let status: ShotStatus = rec ? rec.status : 'unchecked';
    if (!baseline) status = rec ? 'missing' : 'unchecked';
    return {
      ...shot,
      status,
      baseline,
      render,
      actual: place(rec?.actual, paths.reportDir, 'actual', `${shot.key}.png`),
      diff: place(rec?.diff, paths.reportDir, 'diff', `${shot.key}.png`),
    };
  });
}

/** Writes `<reportDir>/index.html` and returns its path with the entries it holds. */
export function writeReport(paths: ReportPaths = defaultPaths(), now = new Date()) {
  mkdirSync(paths.reportDir, { recursive: true });
  const entries = collectEntries(paths);
  const html = buildReport(entries, {
    generated: now.toISOString(),
    baselineDir: paths.baselineDir.startsWith(repoRootDir)
      ? paths.baselineDir.slice(repoRootDir.length + 1)
      : paths.baselineDir,
    platform: paths.platform,
  });
  const file = join(paths.reportDir, 'index.html');
  writeFileSync(file, html);
  return { file, entries, html };
}
