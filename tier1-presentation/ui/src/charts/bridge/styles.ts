/**
 * Bridge CSS, generated from the token map. Matches docs/ux/prototype/src/styles.css
 * (`svg.chart`, `.chart text`, `.t-ink`, `.t-ink2`, `.grid-l`, `.ref`) and the `waterfall` marks
 * in core.js. Text sizes are CSS lengths inside the SVG, so they scale with the viewBox like the
 * prototype. Stroke widths and dash patterns are SVG user units, not CSS px.
 */
import { cssVar, defaultTheme, type TokenPath } from '../../tokens';

const v = (p: TokenPath) => cssVar[p];
type ColorKey =
  'ink' | 'ink2' | 'ink3' | 'accent' | 'neg' | 'warn' | 'total' | 'chartGrid' | 'glassLine';
/** Theme vars share one name in every theme; the default theme path names them. */
const c = (k: ColorKey) => cssVar[`themes.${defaultTheme}.color.${k}` as TokenPath];
/** A token length scaled by num/den (prototype 10.5 and 12 derive from the xs / s type sizes). */
const part = (p: TokenPath, num: number, den: number) => `calc(${v(p)} * ${num} / ${den})`;
const mono = `${v('type.families.mono')}, ui-monospace, monospace`;
const numFont = `${v('type.families.num')}, ui-sans-serif, system-ui, sans-serif`;
const motion = `${v('motion.value')} ${v('motion.ease')}`;

export const bridgeCss = [
  '/* @glidepath/ui charts/bridge: generated from tokens in src/charts/bridge/styles.ts */',
  `.gp-bridge { display: block; width: 100%; height: auto; overflow: visible; font-variant-numeric: ${v('type.numerals')}; }`,
  `.gp-bridge text { fill: ${c('ink3')}; font: 500 ${part('type.scale.xs.size', 21, 22)} ${mono}; }`,
  `.gp-bridge text.gp-bridge-value { fill: ${c('ink')}; font: 500 ${part('type.scale.s.size', 12, 13)} ${numFont}; }`,
  `.gp-bridge text.gp-bridge-target-label { fill: ${c('ink2')}; }`,
  `.gp-bridge-grid { stroke: ${c('chartGrid')}; stroke-width: 1; }`,
  `.gp-bridge-bar { transition: y ${motion}, height ${motion}; }`,
  `.gp-bridge-bar[data-step="base"], .gp-bridge-bar[data-step="outlay"] { fill: ${c('total')}; stroke: ${c('glassLine')}; }`,
  `.gp-bridge-bar[data-step="growth"] { fill: ${c('neg')}; opacity: 0.92; }`,
  `.gp-bridge-bar[data-step="savings"] { fill: ${c('accent')}; opacity: 0.92; }`,
  `.gp-bridge-bar[data-step="oneTime"] { fill: ${c('warn')}; opacity: 0.92; }`,
  `.gp-bridge-connector { stroke: ${c('ink3')}; stroke-dasharray: 2 3; opacity: 0.6; }`,
  `.gp-bridge-target { stroke: ${c('ink')}; stroke-width: 1.2; stroke-dasharray: 4 4; opacity: 0.75; }`,
  `.gp-bridge-gap { stroke: ${c('neg')}; fill: none; stroke-width: 1.4; }`,
  `.gp-bridge-break { stroke: ${c('ink3')}; fill: none; }`,
  `.gp-bridge-step:has(> [role="button"]) { cursor: pointer; }`,
  `.gp-bridge-bar[role="button"] { outline: none; }`,
  `.gp-bridge-bar[role="button"]:focus-visible { stroke: ${c('accent')}; stroke-width: 2; }`,
  `@media (prefers-reduced-motion: reduce) {\n  .gp-bridge-bar { transition: none; }\n}`,
].join('\n');
