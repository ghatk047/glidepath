/**
 * HUD CSS (flight strip, status chip, toast), generated from the token map so every colour,
 * radius, type size, space and motion value comes from tokens.json. Matches
 * docs/ux/prototype/src/styles.css (`.hud`, `.chip`, `.toast`). Lengths without a token are
 * written in rem/em or derived from a token with calc(); no raw px, no hex.
 */
import { cssVar, defaultTheme, media, tokenValue, type TokenPath } from '../tokens';
import { springs } from '../motion/springs';

const v = (p: TokenPath) => cssVar[p];
type ColorKey =
  | 'ink'
  | 'ink2'
  | 'ink3'
  | 'hair'
  | 'accent'
  | 'track'
  | 'pos'
  | 'neg'
  | 'warn'
  | 'glass2'
  | 'glassLine';
const c = (k: ColorKey) => cssVar[`themes.${defaultTheme}.color.${k}` as TokenPath];
/** A token length scaled by num/den (the prototype's 12 / 18 px sizes derive from the type scale). */
const part = (p: TokenPath, num: number, den: number) => `calc(${v(p)} * ${num} / ${den})`;
const tint = (k: ColorKey, pct: number) => `color-mix(in srgb, ${c(k)} ${pct}%, transparent)`;

/** Status tints: the prototype's --pos-bg / --neg-bg / --warn-bg are ~13% of the status colour. */
const TINT_PCT = 13;
const TONES = ['pos', 'neg', 'warn'] as const;

const gap = v('space.gap');
const railWidth = v('space.railWidth');
const hairline = tokenValue['glass.border'].split(' ')[0]!;
const mono = `${v('type.families.mono')}, ui-monospace, monospace`;
const num = `${v('type.families.num')}, ui-sans-serif, system-ui, sans-serif`;
/** The phone bottom bar sits under the strip (prototype: 82 px = 5.125 rem). */
const phoneBarClearance = '5.125rem';

/** Toast spring-in / out duration (motion.spring, 300 ms) and hold (token motion.toast, 2400 ms). */
export const toastSpringMs = springs.toast.durationMs;
export const toastHoldMs = springs.toast.holdMs!;

export const hudCss = [
  '/* @glidepath/ui hud: generated from tokens in src/hud/styles.ts */',
  // ---- status chip
  `.gp-chip { display: inline-flex; align-items: center; gap: ${part('space.gap', 1, 3)}; height: 2.15em; padding: 0 ${part('space.gap', 5, 9)}; box-sizing: border-box; border-radius: ${v('radius.pill')}; font-size: ${part('type.scale.s.size', 12, 13)}; font-weight: 500; line-height: 1; background: ${c('glass2')}; border: ${hairline} solid ${c('glassLine')}; color: ${c('ink2')}; white-space: nowrap; font-variant-numeric: ${v('type.numerals')}; }`,
  `.gp-chip-icon { font-size: 0.85em; line-height: 1; }`,
  ...TONES.map(
    (t) =>
      `.gp-chip[data-tone="${t}"] { color: ${c(t)}; background: ${tint(t, TINT_PCT)}; border-color: transparent; }`,
  ),
  // ---- flight strip
  `.gp-panel.gp-hud { position: fixed; left: calc(${railWidth} + 50%); bottom: max(${gap}, env(safe-area-inset-bottom, 0)); transform: translateX(calc(-50% - ${railWidth} / 2)); z-index: 40; border-radius: ${part('radius.panel', 10, 11)}; }`,
  `.gp-panel.gp-hud[hidden] { display: none; }`,
  `.gp-hud .gp-body { display: flex; align-items: center; padding: ${part('space.gap', 4, 9)}; }`,
  `.gp-hud-cells { display: flex; align-items: center; margin: 0; padding: 0; }`,
  `.gp-hud-cell { display: flex; flex-direction: column; gap: ${part('space.gap', 1, 6)}; padding: ${part('space.gap', 1, 3)} ${gap}; border-left: ${hairline} solid ${c('hair')}; min-width: 0; margin: 0; }`,
  `.gp-hud-cell:first-child { border-left: 0; }`,
  `.gp-hud-label { margin: 0; white-space: nowrap; font: ${v('type.scale.xs.weight')} ${v('type.scale.xs.size')}/1.25 ${mono}; letter-spacing: ${v('type.scale.xs.tracking')}; text-transform: uppercase; color: ${c('ink3')}; }`,
  `.gp-hud-value { margin: 0; display: flex; flex-direction: column; align-items: flex-start; justify-content: center; min-height: ${part('type.scale.l.size', 9, 11)}; font: 500 ${part('type.scale.l.size', 9, 11)}/1 ${num}; letter-spacing: -0.01em; font-variant-numeric: ${v('type.numerals')}; white-space: nowrap; color: ${c('ink')}; }`,
  `.gp-hud-prog { display: block; width: 7.5rem; height: 0.25rem; border-radius: 0.25rem; background: ${c('track')}; position: relative; margin-top: 0.25rem; }`,
  `.gp-hud-prog i { position: absolute; inset: 0 auto 0 0; border-radius: 0.25rem; background: ${c('accent')}; transition: width ${v('motion.value')} ${v('motion.ease')}; }`,
  `.gp-hud-prog b { position: absolute; top: -0.1875rem; width: 0.125rem; height: 0.625rem; background: ${c('ink')}; border-radius: 0.125rem; }`,
  // phone: net, bar and gap only (the track and the other cells hide)
  `@media ${media.phone} {\n  .gp-panel.gp-hud { left: 50%; transform: translateX(-50%); bottom: calc(${phoneBarClearance} + env(safe-area-inset-bottom, 0)); width: calc(100% - 2 * ${v('space.phoneGutter')}); }\n  .gp-hud .gp-body { padding: ${part('space.gap', 1, 3)}; }\n  .gp-hud-cells { width: 100%; justify-content: space-between; }\n  .gp-hud-cell { padding: ${part('space.gap', 2, 9)} ${part('space.gap', 4, 9)}; }\n  .gp-hud-value { font-size: ${part('type.scale.l.size', 15, 22)}; min-height: ${part('type.scale.l.size', 15, 22)}; }\n  .gp-hud-prog, .gp-hud-cell[data-phone="hide"] { display: none; }\n}`,
  // ---- toast: top centre, springs in, leaves after the hold
  `.gp-toast-region { position: fixed; z-index: 96; top: max(${gap}, env(safe-area-inset-top, 0)); left: 50%; transform: translateX(-50%); display: flex; justify-content: center; pointer-events: none; max-width: calc(100% - 2 * ${v('space.phoneGutter')}); }`,
  `.gp-panel.gp-toast { display: flex; align-items: center; gap: ${part('space.gap', 5, 9)}; padding: ${part('space.gap', 5, 9)} ${part('space.gap', 8, 9)}; border-radius: ${v('radius.card')}; font-size: ${v('type.scale.s.size')}; color: ${c('ink')}; }`,
  `.gp-toast[data-state="open"] { animation: gp-toast-in ${toastSpringMs}ms ${v('motion.spring')} both; }`,
  `.gp-toast[data-state="closing"] { animation: gp-toast-out ${toastSpringMs}ms ${v('motion.ease')} both; }`,
  `.gp-toast-icon { display: inline-flex; align-items: center; }`,
  `@keyframes gp-toast-in { from { opacity: 0; transform: translateY(-1.25rem); } to { opacity: 1; transform: none; } }`,
  `@keyframes gp-toast-out { from { opacity: 1; transform: none; } to { opacity: 0; transform: translateY(-1.25rem); } }`,
  `@media (prefers-reduced-motion: reduce) {\n  .gp-hud-prog i { transition: none; }\n  .gp-toast[data-state] { animation: none; }\n}`,
].join('\n');
