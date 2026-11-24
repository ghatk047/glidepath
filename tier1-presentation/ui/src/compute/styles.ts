/**
 * ComputeFlow CSS, built from the token map. Only transform and opacity animate (compositor
 * only). Durations and delays are calc() of motion tokens. No filter, backdrop-filter or
 * box-shadow; colours are accent and ink tokens only. Lengths are rem or derived with calc().
 */
import { cssVar, defaultTheme, type TokenPath } from '../tokens';

const v = (p: TokenPath) => cssVar[p];
const c = (k: 'accent' | 'accent2' | 'ink3' | 'accentGlow') =>
  cssVar[`themes.${defaultTheme}.color.${k}` as TokenPath];

const mono = `${v('type.families.mono')}, ui-monospace, monospace`;
const flash = v('motion.flash');
const roll = v('motion.roll');
const stagger = v('motion.stagger');
const value = v('motion.value');

const ON = `.gp-compute[data-motion="on"]`;
const LIVE = `${ON}[data-visible="true"]`;

export const computeCss = [
  '/* @glidepath/ui compute: generated from tokens in src/compute/styles.ts */',
  `@keyframes gp-compute-flow { from { transform: translate3d(0, 0, 0); } to { transform: translate3d(-50%, 0, 0); } }`,
  // The counter-flow is its own keyframe (no animation-direction keyword): tier-check flags the
  // bare word as a tier-2 symbol name in the bundle.
  `@keyframes gp-compute-counter { from { transform: translate3d(-50%, 0, 0); } to { transform: translate3d(0, 0, 0); } }`,
  `@keyframes gp-compute-rise { 0% { transform: translate3d(0, var(--gp-rise), 0) scale(0.8); opacity: 0; } 25% { opacity: 0.8; } 60% { transform: translate3d(0, 0, 0) scale(1); opacity: 0.8; } 100% { transform: translate3d(0, calc(var(--gp-rise) * -1), 0) scale(0.8); opacity: 0; } }`,
  `@keyframes gp-compute-in { from { opacity: 0; } to { opacity: 1; } }`,
  // ---- root
  `.gp-compute { position: relative; display: block; overflow: hidden; contain: strict; pointer-events: none; color: ${c('accent')}; font-family: ${mono}; }`,
  `.gp-compute[data-variant="inline"] { width: 6rem; height: 1.25rem; --gp-rise: 0.9rem; font-size: ${v('type.scale.xs.size')}; }`,
  `.gp-compute[data-variant="field"] { width: 100%; height: 7.5rem; --gp-rise: 2.6rem; font-size: ${v('type.scale.l.size')}; }`,
  `.gp-compute[data-variant="field"]::before { content: ""; position: absolute; inset: 0; background: radial-gradient(ellipse at 50% 50%, ${c('accentGlow')}, transparent 70%); }`,
  `${ON} { animation: gp-compute-in ${value} ${v('motion.ease')} ${value} both; }`,
  // ---- waves
  `.gp-compute-wave { position: absolute; left: 0; top: 0; width: 200%; height: 100%; display: block; }`,
  `.gp-compute-wave > svg { display: block; width: 100%; height: 100%; overflow: visible; }`,
  `.gp-compute-wave path { fill: none; stroke: ${c('accent')}; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; vector-effect: non-scaling-stroke; }`,
  `.gp-compute-wave[data-tone="b"] path { stroke: ${c('accent2')}; }`,
  `.gp-compute-wave[data-tone="c"] path { stroke: ${c('ink3')}; }`,
  `.gp-compute-wave[data-tone="a"] path { stroke-opacity: 0.8; }`,
  `.gp-compute-wave[data-tone="b"] path { stroke-opacity: 0.6; }`,
  `.gp-compute-wave[data-tone="c"] path { stroke-opacity: 0.35; }`,
  `${ON} .gp-compute-wave { animation: gp-compute-flow linear infinite; animation-duration: calc(${flash} * var(--w)); }`,
  `${ON} .gp-compute-wave[data-dir="r"] { animation-name: gp-compute-counter; }`,
  // ---- glyphs
  `.gp-compute-glyphs { position: absolute; inset: 0; display: block; opacity: calc(0.6 + 0.4 * var(--gp-p, 0.5)); }`,
  `.gp-compute-glyphs > b { position: absolute; top: 50%; margin-top: -0.5em; line-height: 1; font-weight: 500; color: ${c('accent')}; opacity: 0; }`,
  `${ON} .gp-compute-glyphs > b { animation: gp-compute-rise calc(${roll} * 5) ${v('motion.ease')} infinite; animation-delay: calc(${stagger} * var(--i) * 4); }`,
  // ---- still rendering: one wave, three glyphs at rest, nothing moving
  `.gp-compute[data-motion="still"] .gp-compute-wave:not([data-still]) { display: none; }`,
  `.gp-compute[data-motion="still"] .gp-compute-glyphs > b { display: none; opacity: 0.7; }`,
  `.gp-compute[data-motion="still"] .gp-compute-glyphs > b[data-still] { display: block; }`,
  // ---- off-screen pause and compositor hints
  `.gp-compute[data-visible="false"] *, .gp-compute[data-visible="false"] { animation-play-state: paused; }`,
  `${LIVE} .gp-compute-wave { will-change: transform; }`,
  `${LIVE} .gp-compute-glyphs > b { will-change: transform, opacity; }`,
].join('\n');
