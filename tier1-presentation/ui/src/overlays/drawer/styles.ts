/**
 * Overlay CSS (trace drawer, tooltip), generated from the token map so every colour, radius,
 * type size, space and motion value comes from tokens.json. Matches
 * docs/ux/prototype/src/styles.css (`.drawer`, `.tip`). Lengths without a token are written in
 * rem or derived from a token with calc(); no raw px, no hex.
 */
import { cssVar, defaultTheme, tokenValue, type TokenPath } from '../../tokens';
import { springs } from '../../motion/springs';

const v = (p: TokenPath) => cssVar[p];
type ColorKey = 'ink' | 'ink2' | 'ink3' | 'hair' | 'accent' | 'glass' | 'glass2' | 'glassLine';
const c = (k: ColorKey) => cssVar[`themes.${defaultTheme}.color.${k}` as TokenPath];
/** A token length scaled by num/den (the prototype's 12 / 24 px sizes derive from the token scale). */
const part = (p: TokenPath, num: number, den: number) => `calc(${v(p)} * ${num} / ${den})`;

/** Drawer width from the UX pack (04 inventory, Overlays): 420 px, written as 26.25 rem. */
export const DRAWER_WIDTH_REM = 26.25;
export const DRAWER_WIDTH_PX = DRAWER_WIDTH_REM * 16;
/** Tooltip max width (prototype `.tip`): 260 px = 16.25 rem. */
export const TIP_MAX_WIDTH_REM = 16.25;

const px = (p: TokenPath) => parseFloat(tokenValue[p]);
/** Pointer offset (prototype 14 px) and viewport margin (12 px), derived from the token gap. */
export const TIP_POINTER_OFFSET = (px('space.gap') * 7) / 9;
export const TIP_VIEWPORT_MARGIN = (px('space.gap') * 2) / 3;

/** Drawer slide duration (springs.drawer) in ms. */
export const drawerMs = springs.drawer.durationMs;

const gap = v('space.gap');
const edge = part('space.gap', 2, 3);
const hairline = tokenValue['glass.border'].split(' ')[0]!;
const mono = `${v('type.families.mono')}, ui-monospace, monospace`;
const num = `${v('type.families.num')}, ui-sans-serif, system-ui, sans-serif`;
const label = `font: ${v('type.scale.xs.weight')} ${v('type.scale.xs.size')}/1.25 ${mono}; letter-spacing: ${v('type.scale.xs.tracking')}; text-transform: uppercase; color: ${c('ink3')};`;

export const overlayCss = [
  '/* @glidepath/ui overlays: generated from tokens in src/overlays/drawer/styles.ts */',
  // ---- trace drawer: right side, 420 px, glass level 3
  `.gp-drawer { position: fixed; z-index: 70; top: ${edge}; right: ${edge}; bottom: ${edge}; width: min(${DRAWER_WIDTH_REM}rem, calc(100vw - 2 * ${edge})); display: flex; }`,
  `.gp-drawer[data-state="open"] { animation: gp-drawer-in ${drawerMs}ms ${v('motion.spring')} both; }`,
  `.gp-drawer[data-state="closed"] { animation: gp-drawer-out ${drawerMs}ms ${v('motion.ease')} both; pointer-events: none; }`,
  `.gp-panel.gp-drawer-panel { flex: 1; min-width: 0; overflow: auto; border-radius: ${part('radius.panel', 12, 11)}; }`,
  `.gp-drawer-panel:focus { outline: none; }`,
  `.gp-drawer-h { display: flex; justify-content: space-between; align-items: center; gap: ${gap}; }`,
  `.gp-drawer-title { margin: 0; ${label} }`,
  `.gp-drawer-close { width: 2.25rem; height: 2.25rem; flex: none; border-radius: ${v('radius.control')}; border: ${hairline} solid ${c('glassLine')}; background: ${c('glass')}; color: ${c('ink2')}; display: grid; place-items: center; cursor: pointer; font: inherit; padding: 0; }`,
  `.gp-drawer-close:hover { color: ${c('ink')}; background: ${c('glass2')}; }`,
  `.gp-drawer-panel :focus-visible { outline: ${hairline} solid ${c('accent')}; outline-offset: ${hairline}; }`,
  `.gp-drawer-value { margin: ${part('space.gap', 7, 9)} 0 ${part('space.gap', 2, 9)}; font: ${v('type.scale.xl.weight')} ${v('type.scale.xl.size')}/1 ${num}; letter-spacing: ${v('type.scale.xl.tracking')}; font-variant-numeric: ${v('type.numerals')}; color: ${c('ink')}; }`,
  `.gp-drawer-id { margin: 0; font-family: ${mono}; font-size: ${v('type.scale.s.size')}; color: ${c('ink3')}; }`,
  `.gp-drawer-formula { margin: ${part('space.gap', 8, 9)} 0 0; font-size: ${v('type.scale.s.size')}; color: ${c('ink')}; }`,
  `.gp-drawer-h3 { margin: ${part('space.gap', 4, 3)} 0 ${part('space.gap', 5, 9)}; ${label} }`,
  `.gp-drawer-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }`,
  `.gp-drawer-chain { gap: ${part('space.gap', 4, 9)}; }`,
  `.gp-drawer-row { display: flex; justify-content: space-between; align-items: baseline; gap: ${part('space.gap', 5, 9)}; font-size: ${v('type.scale.s.size')}; min-width: 0; }`,
  `.gp-drawer-row > span:first-child { min-width: 0; overflow-wrap: anywhere; }`,
  `.gp-drawer-row > span:last-child { font-variant-numeric: ${v('type.numerals')}; white-space: nowrap; color: ${c('ink')}; }`,
  `.gp-drawer-chain .gp-drawer-row { padding: ${part('space.gap', 2, 3)} ${part('space.gap', 7, 9)}; background: ${c('glass')}; border: ${hairline} solid ${c('hair')}; border-radius: ${v('radius.card')}; }`,
  `.gp-drawer-chain .gp-drawer-row[aria-current="step"] { border-color: ${c('accent')}; }`,
  `.gp-drawer-drivers .gp-drawer-row { padding: ${part('space.gap', 1, 2)} ${part('space.gap', 5, 9)}; }`,
  `@keyframes gp-drawer-in { from { transform: translateX(110%); } to { transform: none; } }`,
  `@keyframes gp-drawer-out { from { transform: none; } to { transform: translateX(110%); } }`,
  // ---- tooltip: one shared instance, glass level 3, 12 px, follows the pointer
  `.gp-tip { position: fixed; z-index: 80; left: 0; top: 0; pointer-events: none; max-width: ${TIP_MAX_WIDTH_REM}rem; }`,
  `.gp-panel.gp-tip-body { padding: ${part('space.gap', 4, 9)} ${part('space.gap', 5, 9)}; border-radius: ${part('radius.panel', 5, 11)}; font-size: ${part('type.scale.s.size', 12, 13)}; line-height: 1.4; color: ${c('ink')}; animation: gp-tip-in ${v('motion.value')} ${v('motion.ease')} both; }`,
  `.gp-tip-body b { font-weight: 600; font-variant-numeric: ${v('type.numerals')}; }`,
  `@keyframes gp-tip-in { from { opacity: 0; } to { opacity: 1; } }`,
  `@media (prefers-reduced-motion: reduce) {\n  .gp-drawer[data-state] { animation: none; }\n  .gp-tip-body { animation: none; }\n}`,
].join('\n');
