import { defaultTheme, themeNames, type ThemeName } from './tokens.generated';

export const THEME_STORAGE_KEY = 'glidepath.theme';

export interface ThemeStorage {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}
export interface ThemeRoot {
  setAttribute(k: string, v: string): void;
}

const browserStorage = (): ThemeStorage | null => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};
const browserRoot = (): ThemeRoot | null =>
  (globalThis as unknown as { document?: { documentElement: ThemeRoot } }).document
    ?.documentElement ?? null;

export const isTheme = (v: unknown): v is ThemeName =>
  typeof v === 'string' && (themeNames as readonly string[]).includes(v);

export function getStoredTheme(storage: ThemeStorage | null = browserStorage()): ThemeName | null {
  try {
    const v = storage?.getItem(THEME_STORAGE_KEY);
    return isTheme(v) ? v : null;
  } catch {
    return null;
  }
}

/** Sets data-theme on <html> and remembers the choice for this viewer. */
export function setTheme(
  theme: ThemeName,
  root: ThemeRoot | null = browserRoot(),
  storage: ThemeStorage | null = browserStorage(),
): void {
  root?.setAttribute('data-theme', theme);
  try {
    storage?.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* storage unavailable: the theme still applies */
  }
}

/** Applies the remembered theme (or the default) at startup. */
export function initTheme(
  root: ThemeRoot | null = browserRoot(),
  storage: ThemeStorage | null = browserStorage(),
): ThemeName {
  const theme = getStoredTheme(storage) ?? defaultTheme;
  root?.setAttribute('data-theme', theme);
  return theme;
}
