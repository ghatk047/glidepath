import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MODULE_IDS, PRELOADED_MODULES } from './modules';

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const BUILD_TIMEOUT_MS = 120_000;

interface ManifestChunk {
  file: string;
  src?: string;
  isEntry?: boolean;
  isDynamicEntry?: boolean;
  imports?: string[];
}

let outDir = '';
let manifest: Record<string, ManifestChunk> = {};

beforeAll(async () => {
  outDir = mkdtempSync(join(tmpdir(), 'glidepath-web-build-'));
  await build({ root: webRoot, logLevel: 'silent', build: { outDir, emptyOutDir: true } });
  manifest = JSON.parse(readFileSync(join(outDir, '.vite/manifest.json'), 'utf8'));
}, BUILD_TIMEOUT_MS);

afterAll(() => rmSync(outDir, { recursive: true, force: true }));

const moduleChunks = () =>
  Object.values(manifest).filter(
    (c) => c.isDynamicEntry && /\/modules\/[a-z]+\/index\.tsx$/.test(c.src ?? ''),
  );
const entryChunk = () => Object.values(manifest).find((c) => c.isEntry)!;
const base = (file: string) => file.split('/').pop()!;

describe('build manifest', () => {
  it('has one chunk per module: 9 distinct module chunks', () => {
    const chunks = moduleChunks();
    expect(chunks.map((c) => /\/modules\/([a-z]+)\//.exec(c.src!)![1]).sort()).toEqual(
      [...MODULE_IDS].sort(),
    );
    expect(chunks).toHaveLength(MODULE_IDS.length);
    expect(new Set(chunks.map((c) => c.file)).size).toBe(MODULE_IDS.length);
  });

  it('keeps module code out of the entry chunk', () => {
    const entry = entryChunk();
    for (const m of moduleChunks()) expect(m.file).not.toBe(entry.file);
    expect((entry.imports ?? []).filter((i) => i.includes('/modules/'))).toEqual([]);
  });

  it('preloads the cockpit, levers and path (and only those)', () => {
    expect([...PRELOADED_MODULES]).toEqual(['cockpit', 'levers', 'path']);
    // The registry points every module at a dynamic import, so the entry chunk can load any
    // of the nine; the three preloaded ones are requested after first paint.
    const text = readFileSync(join(outDir, entryChunk().file), 'utf8');
    for (const c of moduleChunks()) expect(text).toContain(base(c.file));
  });

  it('emits a standard dist with index.html and css', () => {
    expect(statSync(join(outDir, 'index.html')).isFile()).toBe(true);
    expect(readdirSync(join(outDir, 'assets')).some((f) => f.endsWith('.css'))).toBe(true);
  });

  it('build_self_hosts_geist_and_requests_no_font_cdn', () => {
    const files = readdirSync(join(outDir, 'assets'));
    expect(files.filter((f) => /^geist-sans-latin-\d+-normal.*\.woff2$/.test(f)).length).toBeGreaterThanOrEqual(4);
    expect(files.filter((f) => /^geist-mono-latin-\d+-normal.*\.woff2$/.test(f)).length).toBeGreaterThanOrEqual(3);
    const css = files.filter((f) => f.endsWith('.css')).map((f) => readFileSync(join(outDir, 'assets', f), 'utf8')).join('\n');
    expect(css).toMatch(/font-family:\s*"?Geist"?/);
    expect(css).toMatch(/font-family:\s*"?Geist Mono"?/);
    // no request for a font leaves the origin: not in the page, the css or any script
    const text = [readFileSync(join(outDir, 'index.html'), 'utf8'), css].concat(
      files.filter((f) => f.endsWith('.js')).map((f) => readFileSync(join(outDir, 'assets', f), 'utf8')),
    );
    for (const t of text) {
      expect(t).not.toMatch(/fonts\.googleapis\.com|fonts\.gstatic\.com/);
    }
  });
});
