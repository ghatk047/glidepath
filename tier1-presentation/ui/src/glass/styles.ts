/**
 * Glass CSS, generated from the token map so every colour, radius, space, blur, motion and
 * breakpoint value comes from tokens.json. Matches docs/ux/prototype/src/styles.css
 * (`.sky`, `.glass`, `.grid`, `.panel-h`, `.label`). Mounted by <GlassProvider>.
 */
import { breakpoints, cssVar, defaultTheme, media, tokenValue, type TokenPath } from '../tokens';
import { GLASS_LEVELS, type GlassLevel } from './budget';
import { SPANS, spanAt } from './layout';
import { REDUCED_TRANSPARENCY_QUERY } from './quality';

const v = (p: TokenPath) => cssVar[p];
type ColorKey =
  | 'ground'
  | 'aurora1'
  | 'aurora2'
  | 'aurora3'
  | 'glass'
  | 'glass2'
  | 'glass3'
  | 'glassLine'
  | 'glassHi'
  | 'ink'
  | 'ink3';
/** Theme vars are the same name in every theme; the default theme path names them. */
const c = (k: ColorKey) => cssVar[`themes.${defaultTheme}.color.${k}` as TokenPath];
const t = (k: 'shadow' | 'noise') => cssVar[`themes.${defaultTheme}.${k}` as TokenPath];

const gap = v('space.gap');
/** Spacing inside panels derives from the token gap (18): 12, 14 and 16 px at the default. */
const gapPart = (num: number, den: number) => `calc(${gap} * ${num} / ${den})`;

/** glass.border is "1px glassLine": the width part. */
export const hairlineWidth = tokenValue['glass.border'].split(' ')[0]!;
/** glass.highlight is "inset 0 1px 0 glassHi". */
export const highlight = tokenValue['glass.highlight'].replace('glassHi', c('glassHi'));
const blur = v('glass.blur');
const saturate = v('glass.saturate');
export const backdrop = `blur(${blur}) saturate(${saturate})`;
/** The low-blur fallback keeps a quarter of the blur. */
export const backdropLow = `blur(calc(${blur} / 4)) saturate(${saturate})`;

/** motion.skyDrift is "46-60s": the three blobs drift at the low end, the middle and the high end. */
const [driftLo, driftHi] = tokenValue['motion.skyDrift']
  .replace('s', '')
  .split('-')
  .map(Number) as [number, number];
export const skyDriftSeconds = [driftLo, (driftLo + driftHi) / 2, driftHi] as const;

/** Loading skeletons render at 40% opacity (02_information_architecture §6). */
export const SKELETON_OPACITY = 0.4;
export const SKELETON_SIZES = {
  label: v('type.scale.xs.size'),
  text: v('type.scale.m.size'),
  mid: v('type.scale.l.size'),
  big: v('type.scale.xl.size'),
  hero: v('type.scale.hero.size'),
} as const;

const tint: Record<GlassLevel, string> = {
  1: `linear-gradient(180deg, ${c('glass2')}, ${c('glass')})`,
  2: `linear-gradient(180deg, ${c('glass3')}, ${c('glass2')})`,
  3: c('glass3'),
};
/** Low-blur fallback: one tint step more opaque, so content stays legible without the blur. */
const tintLow: Record<GlassLevel, string> = {
  1: tint[2],
  2: c('glass3'),
  3: `color-mix(in srgb, ${c('glass3')}, ${c('ground')} 60%)`,
};

/** A pre-blurred blob: the falloff of an 80px blur is baked into the gradient stops. */
const blob = (k: ColorKey, shape: 'circle' | 'ellipse') => {
  const col = c(k);
  const mix = (p: number) => `color-mix(in srgb, ${col} ${p}%, transparent)`;
  return `radial-gradient(${shape} closest-side, ${col} 0%, ${mix(90)} 20%, ${mix(70)} 40%, ${mix(44)} 60%, ${mix(20)} 78%, ${mix(6)} 92%, transparent 100%)`;
};
const noise =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

const lowRules = (prefix: string) =>
  [
    ...GLASS_LEVELS.map(
      (l) => `${prefix}.gp-panel[data-level="${l}"] { background: ${tintLow[l]}; }`,
    ),
    `${prefix}.gp-panel[data-blur="on"] { -webkit-backdrop-filter: ${backdropLow}; backdrop-filter: ${backdropLow}; }`,
  ].join('\n');

const font = (w: TokenPath, s: TokenPath, fam: TokenPath, fallback: string) =>
  `${v(w)} ${v(s)}/1.25 ${v(fam)}, ${fallback}`;

/**
 * Desktop density (UIX-01). The app is presented full screen on a laptop (1280x720) and on a
 * 1080p display, so above the tablet breakpoint the spacing and the two display sizes step down,
 * and step down again on short screens. Only the token custom properties are redefined (in rem,
 * relative to the token defaults), so every panel, grid and module follows; tablet and phone keep
 * the token values. `:root:root` outranks the generated token sheet whatever the mount order.
 */
// media queries cannot read custom properties, and em there is always the 16 px browser default
const MQ_EM = 16;
/** Wider than the token tablet breakpoint. */
export const DESKTOP_QUERY = `(min-width: ${(breakpoints.tablet + 1) / MQ_EM}em)`;
/** Desktop on a short screen (a 1280x720 laptop, a 1440x900 display). */
export const SHORT_DESKTOP_QUERY = `${DESKTOP_QUERY} and (max-height: ${900 / MQ_EM}em)`;
const desktopDensity = [
  `@media ${DESKTOP_QUERY} {`,
  `  :root:root { ${v('space.gap')}: 0.875rem; ${v('space.panelPad')}: 1.125rem 1.25rem; ${v('radius.panel')}: 1.125rem; ${v('type.scale.hero.size')}: clamp(2.75rem, 3.9vw, 4.5rem); ${v('type.scale.xl.size')}: clamp(1.625rem, 2.2vw, 2.25rem); }`,
  `}`,
  `@media ${SHORT_DESKTOP_QUERY} {`,
  `  :root:root { ${v('space.gap')}: 0.75rem; ${v('space.panelPad')}: 0.875rem 1.125rem; ${v('type.scale.hero.size')}: clamp(2.5rem, 3.4vw, 3.75rem); ${v('type.scale.xl.size')}: clamp(1.5rem, 2vw, 2rem); ${v('type.scale.l.size')}: 1.25rem; }`,
  `}`,
]
  .join('\n')
  // cssVar values are `var(--x)`: the declarations need the bare property name
  .replace(/var\((--[a-z0-9-]+)\):/g, '$1:');

export const glassCss = [
  '/* @glidepath/ui glass: generated from tokens in src/glass/styles.ts */',
  // aurora: pre-blurred sky, no live filter
  `.gp-aurora { position: fixed; inset: 0; z-index: -1; overflow: hidden; pointer-events: none; background: ${c('ground')}; }`,
  `.gp-aurora i { position: absolute; border-radius: 50%; opacity: .9; will-change: transform; }`,
  `.gp-aurora i:nth-child(1) { width: 62vw; height: 62vw; left: -12vw; top: -22vw; background: ${blob('aurora1', 'circle')}; animation: gp-drift1 ${skyDriftSeconds[0]}s ${v('motion.ease')} infinite alternate; }`,
  `.gp-aurora i:nth-child(2) { width: 52vw; height: 52vw; right: -14vw; top: 8vh; background: ${blob('aurora2', 'circle')}; animation: gp-drift2 ${skyDriftSeconds[1]}s ${v('motion.ease')} infinite alternate; }`,
  `.gp-aurora i:nth-child(3) { width: 70vw; height: 40vw; right: 4vw; bottom: -26vw; background: ${blob('aurora3', 'ellipse')}; animation: gp-drift3 ${skyDriftSeconds[2]}s ${v('motion.ease')} infinite alternate; }`,
  `.gp-aurora::after { content: ""; position: absolute; inset: 0; opacity: ${t('noise')}; mix-blend-mode: overlay; background-image: ${noise}; }`,
  `.gp-aurora[data-quality="low"] i { animation: none; }`,
  `@keyframes gp-drift1 { to { transform: translate(8vw, 6vh) scale(1.08); } }`,
  `@keyframes gp-drift2 { to { transform: translate(-6vw, 10vh) scale(.94); } }`,
  `@keyframes gp-drift3 { to { transform: translate(-10vw, -4vh) scale(1.05); } }`,
  // glass panel: tint, hairline, highlight + shadow; backdrop blur only with a budget slot
  `.gp-panel { position: relative; min-width: 0; box-sizing: border-box; color: ${c('ink')}; background: ${tint[1]}; border: ${hairlineWidth} solid ${c('glassLine')}; border-radius: ${v('radius.panel')}; box-shadow: ${highlight}, ${t('shadow')}; }`,
  ...GLASS_LEVELS.filter((l) => l !== 1).map(
    (l) => `.gp-panel[data-level="${l}"] { background: ${tint[l]}; }`,
  ),
  `.gp-panel[data-blur="on"] { -webkit-backdrop-filter: ${backdrop}; backdrop-filter: ${backdrop}; }`,
  `.gp-panel[data-pad="panel"] { padding: ${v('space.panelPad')}; }`,
  `.gp-panel[data-pad="tight"] { padding: ${gapPart(8, 9)} ${gap}; }`,
  `.gp-panel[data-pad="none"] { padding: 0; }`,
  `.gp-panel-h { display: flex; justify-content: space-between; align-items: center; gap: ${gapPart(2, 3)}; margin: 0 0 ${gapPart(7, 9)}; min-width: 0; }`,
  `.gp-label { margin: 0; min-width: 0; font: ${font('type.scale.xs.weight', 'type.scale.xs.size', 'type.families.mono', 'ui-monospace, monospace')}; letter-spacing: ${v('type.scale.xs.tracking')}; text-transform: uppercase; color: ${c('ink3')}; }`,
  `.gp-panel-status { display: flex; flex-wrap: wrap; justify-content: flex-end; align-items: center; gap: ${gapPart(2, 3)}; min-width: 0; margin-left: auto; }`,
  `.gp-body { min-width: 0; }`,
  `.gp-body[data-reveal] { animation: gp-fade ${v('motion.value')} ${v('motion.ease')} both; }`,
  `@keyframes gp-fade { from { opacity: 0; } }`,
  // low-blur fallback: by preference (CSS) or by the provider (data-quality)
  lowRules('[data-quality="low"]'),
  `@media ${REDUCED_TRANSPARENCY_QUERY} {\n${lowRules('')}\n}`,
  // skeleton
  `.gp-skel { display: block; height: 1em; max-width: 100%; border-radius: ${v('radius.small')}; background: ${c('ink3')}; opacity: ${SKELETON_OPACITY}; }`,
  ...Object.entries(SKELETON_SIZES).map(
    ([k, size]) => `.gp-skel[data-size="${k}"] { font-size: ${size}; }`,
  ),
  `.gp-skel[data-size="block"] { height: auto; aspect-ratio: var(--gp-skel-ratio, 2 / 1); border-radius: ${v('radius.card')}; }`,
  `.gp-skel + .gp-skel { margin-top: ${gapPart(2, 3)}; }`,
  // grid: 12 columns, token gap
  `.gp-grid { display: grid; grid-template-columns: repeat(${v('space.gridColumns')}, minmax(0, 1fr)); gap: ${gap}; }`,
  ...SPANS.map((s) => `.gp-span-${s} { grid-column: span ${s}; }`),
  `.gp-stack { display: flex; flex-direction: column; gap: ${gap}; min-width: 0; }`,
  `@media ${media.tablet} {\n${SPANS.map((s) => `  .gp-span-${s} { grid-column: span ${spanAt(s, 'tablet')}; }`).join('\n')}\n}`,
  `@media ${media.phone} {\n${SPANS.map((s) => `  .gp-span-${s} { grid-column: span ${spanAt(s, 'phone')}; }`).join('\n')}\n}`,
  `@media (prefers-reduced-motion: reduce) {\n  .gp-aurora i, .gp-body[data-reveal] { animation: none; }\n}`,
  desktopDensity,
].join('\n');
