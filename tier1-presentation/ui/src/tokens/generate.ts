// Pure generator: docs/ux/tokens.json -> CSS custom properties + typed TS map.
// Run via `pnpm --filter @glidepath/ui build:tokens` (see build.ts).

export interface TokensJson {
  themes: Record<
    string,
    { mode: string; default?: boolean; color: Record<string, unknown>; [k: string]: unknown }
  >;
  type: {
    families: Record<string, string>;
    scale: Record<string, Record<string, string | number>>;
    numerals: string;
  };
  radius: Record<string, number>;
  space: Record<string, number | string>;
  glass: Record<string, string>;
  motion: Record<string, string>;
  breakpoints: Record<string, number>;
  [k: string]: unknown;
}

export const kebab = (s: string): string =>
  s
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/([a-zA-Z])(\d)/g, '$1-$2')
    .toLowerCase();

/** [dotted token path, css var name, css value] */
export type Decl = [path: string, name: string, value: string];

const px = (v: number | string): string => (typeof v === 'number' ? `${v}px` : v);

/** Theme-independent tokens. */
export function sharedDecls(t: TokensJson): Decl[] {
  const out: Decl[] = [];
  for (const [k, v] of Object.entries(t.type.families))
    out.push([`type.families.${k}`, `--font-${kebab(k)}`, String(v)]);
  for (const [step, props] of Object.entries(t.type.scale))
    for (const [k, v] of Object.entries(props))
      out.push([`type.scale.${step}.${k}`, `--type-${step}-${kebab(k)}`, String(v)]);
  out.push(['type.numerals', '--type-numerals', t.type.numerals]);
  for (const [k, v] of Object.entries(t.radius))
    out.push([`radius.${k}`, `--radius-${kebab(k)}`, px(v)]);
  for (const [k, v] of Object.entries(t.space))
    out.push([`space.${k}`, `--space-${kebab(k)}`, k === 'gridColumns' ? String(v) : px(v)]);
  for (const [k, v] of Object.entries(t.glass)) out.push([`glass.${k}`, `--glass-${kebab(k)}`, v]);
  for (const [k, v] of Object.entries(t.motion))
    out.push([`motion.${k}`, `--motion-${kebab(k)}`, v]);
  for (const [k, v] of Object.entries(t.breakpoints))
    out.push([`breakpoints.${k}`, `--breakpoint-${kebab(k)}`, px(v)]);
  return out;
}

/** Tokens that differ per theme. */
export function themeDecls(theme: TokensJson['themes'][string], name: string): Decl[] {
  const out: Decl[] = [];
  const p = `themes.${name}`;
  for (const [k, v] of Object.entries(theme.color)) {
    if (Array.isArray(v))
      v.forEach((c, i) => out.push([`${p}.color.${k}.${i}`, `--${kebab(k)}-${i + 1}`, String(c)]));
    else out.push([`${p}.color.${k}`, `--${kebab(k)}`, String(v)]);
  }
  out.push([`${p}.shadow`, '--shadow', String(theme.shadow)]);
  out.push([`${p}.noise`, '--noise', String(theme.noise)]);
  return out;
}

const block = (sel: string, scheme: string | null, decls: Decl[]): string =>
  `${sel} {\n${scheme ? `  color-scheme: ${scheme};\n` : ''}${decls.map(([, n, v]) => `  ${n}: ${v};`).join('\n')}\n}\n`;

export function allDecls(t: TokensJson): Decl[] {
  return [...sharedDecls(t), ...Object.entries(t.themes).flatMap(([n, th]) => themeDecls(th, n))];
}

const defaultThemeOf = (t: TokensJson): string => {
  const names = Object.keys(t.themes);
  return names.find((n) => t.themes[n]?.default) ?? names[0] ?? '';
};

/**
 * Generic fallbacks appended to the font tokens in the CSS only, so a face that has not loaded (or a
 * control that falls back) draws sans or mono and never the browser's default serif (WEB-11).
 */
const FONT_FALLBACK: Record<string, string> = {
  '--font-ui': 'system-ui, sans-serif',
  '--font-num': 'system-ui, sans-serif',
  '--font-mono': 'ui-monospace, monospace',
};

export function generateCss(t: TokensJson): string {
  const parts = ['/* GENERATED from docs/ux/tokens.json by src/tokens/build.ts. Do not edit. */\n'];
  parts.push(
    block(
      ':root',
      null,
      sharedDecls(t).map(([path, name, value]): Decl => {
        const fallback = FONT_FALLBACK[name];
        return [path, name, fallback ? `${value}, ${fallback}` : value];
      }),
    ),
  );
  const def = defaultThemeOf(t);
  for (const [n, th] of Object.entries(t.themes)) {
    const sel = n === def ? `:root,\n:root[data-theme="${n}"]` : `:root[data-theme="${n}"]`;
    parts.push(block(sel, th.mode, themeDecls(th, n)));
  }
  return parts.join('\n');
}

export function generateTs(t: TokensJson): string {
  const names = Object.keys(t.themes);
  const decls = allDecls(t);
  const vars = Object.fromEntries(decls.map(([path, name]) => [path, `var(${name})`]));
  const values = Object.fromEntries(decls.map(([path, , v]) => [path, v]));
  const modes = Object.fromEntries(names.map((n) => [n, t.themes[n]?.mode]));
  return `// GENERATED from docs/ux/tokens.json by src/tokens/build.ts. Do not edit.
export const themeNames = ${JSON.stringify(names)} as const;
export type ThemeName = (typeof themeNames)[number];
export const defaultTheme: ThemeName = ${JSON.stringify(defaultThemeOf(t))};
export const themeModes = ${JSON.stringify(modes)} as const;

/** Token path -> CSS var reference, e.g. cssVar['themes.cruise.color.ground'] === 'var(--ground)'. */
export const cssVar = ${JSON.stringify(vars, null, 2)} as const;
export type TokenPath = keyof typeof cssVar;

/** Token path -> literal value as written to CSS. */
export const tokenValue = ${JSON.stringify(values, null, 2)} as const;

/** Breakpoints in px (tokens.json breakpoints). */
export const breakpoints = ${JSON.stringify(t.breakpoints)} as const;
`;
}
