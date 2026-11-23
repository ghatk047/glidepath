import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readTokens } from './build';
import { generateCss, generateTs } from './generate';
import { cssVar, breakpoints } from './tokens.generated';
import { media, mediaQuery } from './media';
import {
  THEME_STORAGE_KEY,
  getStoredTheme,
  initTheme,
  setTheme,
  type ThemeRoot,
  type ThemeStorage,
} from './theme';

const read = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8');

/** Leaf paths of tokens.json (arrays expand to index segments), excluding metadata. */
function leaves(o: unknown, path: string[] = []): string[] {
  if (o !== null && typeof o === 'object')
    return Object.entries(o).flatMap(([k, v]) => leaves(v, [...path, k]));
  return [path.join('.')];
}
const META = new Set(['name', 'version']);
const metaLeaf = (p: string) => META.has(p) || /^themes\.[^.]+\.(mode|default)$/.test(p);

const memStorage = (
  init: Record<string, string> = {},
): ThemeStorage & { data: Record<string, string> } => {
  const data = { ...init };
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => void (data[k] = v) };
};
const memRoot = (): ThemeRoot & { attrs: Record<string, string> } => {
  const attrs: Record<string, string> = {};
  return { attrs, setAttribute: (k, v) => void (attrs[k] = v) };
};

describe('UI-01 tokens build', () => {
  const tokens = readTokens();

  it('every token key in tokens.json appears in the CSS and TS output', () => {
    const css = generateCss(tokens);
    const paths = leaves(tokens).filter((p) => !metaLeaf(p));
    expect(paths.length).toBeGreaterThan(100);
    for (const p of paths) {
      expect(cssVar, p).toHaveProperty([p]);
      const name = /^var\((.+)\)$/.exec(cssVar[p as keyof typeof cssVar])![1];
      expect(css, p).toContain(`${name}:`);
    }
    // both themes are emitted, Cruise is default
    expect(css).toMatch(/:root,\s*:root\[data-theme="cruise"\]/);
    expect(css).toContain(':root[data-theme="daylight"]');
    expect(css).toContain('color-scheme: dark');
    expect(css).toContain('color-scheme: light');
  });

  it('committed generated files are up to date with tokens.json', () => {
    expect(read('./tokens.css')).toBe(generateCss(tokens));
    expect(read('./tokens.generated.ts')).toBe(generateTs(tokens));
  });
});

describe('UI-01 theme', () => {
  it('data-theme on <html> is set and remembered per viewer in localStorage', () => {
    const root = memRoot();
    const storage = memStorage();
    expect(initTheme(root, storage)).toBe('cruise');
    expect(root.attrs['data-theme']).toBe('cruise');
    setTheme('daylight', root, storage);
    expect(root.attrs['data-theme']).toBe('daylight');
    expect(storage.data[THEME_STORAGE_KEY]).toBe('daylight');

    const root2 = memRoot();
    expect(initTheme(root2, storage)).toBe('daylight');
    expect(root2.attrs['data-theme']).toBe('daylight');
  });

  it('ignores invalid or unavailable storage', () => {
    expect(getStoredTheme(memStorage({ [THEME_STORAGE_KEY]: 'neon' }))).toBeNull();
    const broken: ThemeStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    const root = memRoot();
    expect(initTheme(root, broken)).toBe('cruise');
    expect(() => setTheme('daylight', root, broken)).not.toThrow();
    expect(root.attrs['data-theme']).toBe('daylight');
  });
});

describe('UI-01 breakpoints', () => {
  it('exports 1180 px and 760 px as media helpers', () => {
    expect(breakpoints).toEqual({ tablet: 1180, phone: 760 });
    expect(media.tablet).toBe('(max-width: 1180px)');
    expect(media.phone).toBe('(max-width: 760px)');
    expect(mediaQuery.phone).toBe('@media (max-width: 760px)');
  });
});
