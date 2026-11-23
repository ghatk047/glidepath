/**
 * Monthly curve CSS, generated from the token map. Matches docs/ux/prototype/src/styles.css
 * (`svg.chart`, `.chart text`, `.t-ink`, `.grid-l`) and the `areaChart` marks in views.js. Text
 * sizes are CSS lengths inside the SVG, so they scale with the viewBox. Stroke widths are SVG user
 * units, not CSS px.
 */
import { cssVar, defaultTheme, type TokenPath } from '../../tokens';

const v = (p: TokenPath) => cssVar[p];
type ColorKey = 'ink' | 'ink3' | 'accent' | 'ground' | 'chartGrid';
/** Theme vars share one name in every theme; the default theme path names them. */
const c = (k: ColorKey) => cssVar[`themes.${defaultTheme}.color.${k}` as TokenPath];
const seq = (i: 0 | 1 | 2) => cssVar[`themes.${defaultTheme}.color.sequential.${i}` as TokenPath];
/** A token length scaled by num/den (prototype 10.5 derives from the xs type size). */
const part = (p: TokenPath, num: number, den: number) => `calc(${v(p)} * ${num} / ${den})`;
const mono = `${v('type.families.mono')}, ui-monospace, monospace`;
const ui = `${v('type.families.ui')}, ui-sans-serif, system-ui, sans-serif`;
const motion = `${v('motion.value')} ${v('motion.ease')}`;

export const monthlyCss = [
  '/* @glidepath/ui charts/monthly: generated from tokens in src/charts/monthly/styles.ts */',
  `.gp-monthly { display: block; width: 100%; height: auto; overflow: visible; font-variant-numeric: ${v('type.numerals')}; }`,
  `.gp-monthly text { fill: ${c('ink3')}; font: 500 ${part('type.scale.xs.size', 21, 22)} ${mono}; }`,
  `.gp-monthly text.gp-monthly-family-label { fill: ${c('ink')}; font: 500 ${part('type.scale.xs.size', 21, 22)} ${ui}; pointer-events: none; }`,
  `.gp-monthly-grid { stroke: ${c('chartGrid')}; stroke-width: 1; }`,
  `.gp-monthly-area { stroke: ${c('ground')}; stroke-width: 1.5; opacity: 0.8; transition: d ${motion}; outline: none; }`,
  `.gp-monthly-area[data-slot="0"] { fill: ${seq(2)}; }`,
  `.gp-monthly-area[data-slot="1"] { fill: ${seq(1)}; }`,
  `.gp-monthly-area[data-slot="2"] { fill: ${c('accent')}; opacity: 0.55; }`,
  `.gp-monthly-area:focus-visible { stroke: ${c('accent')}; stroke-width: 2; }`,
  `.gp-monthly-line { fill: none; stroke: ${c('ink')}; stroke-width: 2; transition: d ${motion}; }`,
  `.gp-monthly-end { fill: ${c('ink')}; stroke: ${c('ground')}; stroke-width: 2; transition: cx ${motion}, cy ${motion}; }`,
  `@media (prefers-reduced-motion: reduce) {\n  .gp-monthly-area, .gp-monthly-line, .gp-monthly-end { transition: none; }\n}`,
].join('\n');
