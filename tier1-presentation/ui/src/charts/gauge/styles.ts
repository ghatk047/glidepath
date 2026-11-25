/**
 * Gauge and ring CSS, generated from the token map so every colour, type size, space and motion
 * value comes from tokens.json. Matches docs/ux/prototype/src/styles.css (`svg.chart`,
 * `.chart text`, `.gauge-wrap`, `.gauge-center`, `.hero-num`, `.ring-row`). Lengths without a token
 * are derived from one with calc() or written in rem/em; no raw px, no hex.
 */
import { cssVar, defaultTheme, type TokenPath } from '../../tokens';
import { REDUCED_MOTION_QUERY } from '../../motion';

const v = (p: TokenPath) => cssVar[p];
type ColorKey = 'ink' | 'ink2' | 'ink3' | 'accentGlow';
/** Theme vars are the same name in every theme; the default theme path names them. */
const c = (k: ColorKey) => cssVar[`themes.${defaultTheme}.color.${k}` as TokenPath];
/** A token length scaled by num/den (the prototype's 10.5 / 12 / 16 px derive from tokens). */
const part = (p: TokenPath, num: number, den: number) => `calc(${v(p)} * ${num} / ${den})`;

const mono = `${v('type.families.mono')}, ui-monospace, monospace`;
const num = `${v('type.families.num')}, ui-sans-serif, system-ui, sans-serif`;

export const gaugeCss = [
  '/* @glidepath/ui charts/gauge: generated from tokens in src/charts/gauge/styles.ts */',
  // ---- shared chart text (svg.chart, .chart text, .chart .t-ink)
  `.gp-gauge-svg, .gp-ring { display: block; overflow: visible; }`,
  `.gp-gauge-svg { width: 100%; height: auto; }`,
  `.gp-gauge-svg text { fill: ${c('ink3')}; font: 500 ${part('type.scale.xs.size', 21, 22)} ${mono}; }`,
  `.gp-gauge-svg .gp-t-ink { fill: ${c('ink')}; }`,
  `.gp-gauge-hit { stroke: transparent; pointer-events: stroke; }`,
  `.gp-gauge-fill { filter: drop-shadow(0 0 ${part('space.gap', 5, 9)} ${c('accentGlow')}); }`,
  // ---- gauge wrap and centre slot (.gauge-wrap, .gauge-center)
  `.gp-gauge { position: relative; max-width: 25rem; margin: 0 auto; }`,
  `.gp-gauge-center { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: ${part('space.gap', 5, 9)}; padding-top: ${part('space.gap', 1, 3)}; text-align: center; pointer-events: none; }`,
  // The centre covers the arc; only its own content takes the pointer, so mark tooltips still work.
  `.gp-gauge-center > * { pointer-events: auto; }`,
  // ---- hero number for the centre slot (.hero-num inside .gauge-wrap)
  `.gp-gauge-hero { font: ${v('type.scale.hero.weight')} clamp(2.5rem, 4.2vw, 3.625rem)/.95 ${num}; letter-spacing: ${v('type.scale.hero.tracking')}; font-variant-numeric: ${v('type.numerals')}; color: ${c('ink')}; }`,
  `.gp-gauge-hero-unit { font-size: .42em; font-weight: 400; letter-spacing: 0; color: ${c('ink2')}; margin-left: 0.125rem; }`,
  // ---- ring tile (.ring-row, ring text)
  `.gp-ring { flex: none; }`,
  `.gp-ring-arc { transition: stroke-dasharray ${v('motion.roll')} ${v('motion.ease')}; }`,
  `.gp-ring-pct { fill: ${c('ink')}; font: 500 ${part('type.scale.s.size', 12, 13)} ${num}; font-variant-numeric: ${v('type.numerals')}; }`,
  `.gp-ring-row { display: flex; align-items: center; gap: ${part('space.gap', 8, 9)}; min-width: 0; }`,
  // ---- reduced motion: the ring stops transitioning (the gauge fill tween checks it in JS)
  `@media ${REDUCED_MOTION_QUERY} {\n  .gp-ring-arc { transition: none; }\n}`,
].join('\n');
