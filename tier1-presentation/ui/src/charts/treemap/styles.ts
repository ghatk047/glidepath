/**
 * Treemap CSS, generated from the token map. Matches docs/ux/prototype/src/views.js `treemap`
 * (cells by addressability on the sequential ramp, a ground outline per group, the selected group
 * in ink, label chips on a ground scrim) and styles.css (`.t-ink`, `.t-ink2`). Text sizes are CSS
 * lengths inside the SVG, so they scale with the viewBox. Stroke widths are SVG user units.
 */
import { cssVar, defaultTheme, type TokenPath } from '../../tokens';

const v = (p: TokenPath) => cssVar[p];
type ColorKey = 'ink' | 'ink2' | 'accent' | 'ground' | 'track';
/** Theme vars share one name in every theme; the default theme path names them. */
const c = (k: ColorKey) => cssVar[`themes.${defaultTheme}.color.${k}` as TokenPath];
const seq = (i: 0 | 1 | 2) => cssVar[`themes.${defaultTheme}.color.sequential.${i}` as TokenPath];
/** A token length scaled by num/den (prototype 12 derives from the s type size). */
const part = (p: TokenPath, num: number, den: number) => `calc(${v(p)} * ${num} / ${den})`;
const ui = `${v('type.families.ui')}, ui-sans-serif, system-ui, sans-serif`;
const numFont = `${v('type.families.num')}, ui-sans-serif, system-ui, sans-serif`;
const motion = `${v('motion.value')} ${v('motion.ease')}`;

/** Colour slots for `colourBy` categories, in category order (prototype ADDR: seq-1, seq-2, seq-3). */
export const TREEMAP_SLOTS = 3;

export const treemapCss = [
  '/* @glidepath/ui charts/treemap: generated from tokens in src/charts/treemap/styles.ts */',
  `.gp-treemap { display: block; width: 100%; height: auto; overflow: visible; font-variant-numeric: ${v('type.numerals')}; }`,
  // fit: the box sets both sides and the viewBox follows it (the Treemap fit prop)
  `.gp-treemap.gp-treemap-fit { height: 100%; min-height: 0; }`,
  `.gp-treemap text { pointer-events: none; }`,
  `.gp-treemap-group[role="button"] { cursor: pointer; outline: none; }`,
  `.gp-treemap-cell { transition: opacity ${motion}; }`,
  `.gp-treemap-cell[data-slot="0"] { fill: ${seq(0)}; }`,
  `.gp-treemap-cell[data-slot="1"] { fill: ${seq(1)}; }`,
  `.gp-treemap-cell[data-slot="2"] { fill: ${seq(2)}; }`,
  `.gp-treemap-cell[data-slot="none"] { fill: ${c('track')}; }`,
  `.gp-treemap-group[data-dim] .gp-treemap-cell { opacity: 0.55; }`,
  `.gp-treemap-outline { fill: none; stroke: ${c('ground')}; stroke-width: 1.5; pointer-events: none; }`,
  `.gp-treemap-group[data-selected] .gp-treemap-outline { stroke: ${c('ink')}; stroke-width: 2; }`,
  `.gp-treemap-group[role="button"]:focus-visible .gp-treemap-outline { stroke: ${c('accent')}; stroke-width: 2; }`,
  `.gp-treemap-scrim { fill: ${c('ground')}; opacity: 0.72; pointer-events: none; }`,
  `.gp-treemap text.gp-treemap-chip-label { fill: ${c('ink')}; font: 500 ${part('type.scale.s.size', 12, 13)} ${ui}; }`,
  `.gp-treemap text.gp-treemap-chip-value { fill: ${c('ink2')}; font: 500 ${v('type.scale.xs.size')} ${numFont}; }`,
  `@media (prefers-reduced-motion: reduce) {\n  .gp-treemap-cell { transition: none; }\n}`,
].join('\n');
