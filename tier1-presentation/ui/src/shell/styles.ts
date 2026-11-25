/**
 * Shell CSS (Rail, Scenario bar, Tenant button), generated from the token map. Matches
 * docs/ux/prototype/src/styles.css (`.rail`, `.tenant-btn`, `.seg`). Sizes that have no design token
 * (the prototype's control metrics) are written in rem, from one helper, so tier 1 carries no raw px.
 */
import { cssVar, defaultTheme, media, tokenValue, type TokenPath } from '../tokens';

const v = (p: TokenPath) => cssVar[p];
type ColorKey =
  | 'glass'
  | 'glass2'
  | 'glass3'
  | 'glassLine'
  | 'glassHi'
  | 'ink'
  | 'ink2'
  | 'ink3'
  | 'hair'
  | 'accent'
  | 'warn';
const c = (k: ColorKey) => cssVar[`themes.${defaultTheme}.color.${k}` as TokenPath];

/** Root font size the rem metrics are written against (browser default). */
const REM_BASE = 16;
export const rem = (units: number): string => `${units / REM_BASE}rem`;

/** Phone touch target (G12): 44 units. */
export const TOUCH_TARGET = rem(44);

const highlight = tokenValue['glass.highlight'].replace('glassHi', c('glassHi'));
const hairWidth = tokenValue['glass.border'].split(' ')[0]!;
const hairline = `${hairWidth} solid`;
const focusRing = `outline: ${rem(2)} solid ${c('accent')}; outline-offset: ${rem(2)};`;
const mono = v('type.families.mono');
const ui = v('type.families.ui');
const clip = `position: absolute; width: ${rem(1)}; height: ${rem(1)}; margin: ${rem(-1)}; padding: 0; overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap; border: 0;`;

export const shellCss = [
  '/* @glidepath/ui shell: generated from tokens in src/shell/styles.ts */',
  // ---- rail (#1)
  `.gp-rail { position: sticky; top: env(safe-area-inset-top, 0); box-sizing: border-box; width: ${v('space.railWidth')}; height: calc(100vh - env(safe-area-inset-top, 0)); display: flex; flex-direction: column; align-items: center; gap: ${rem(6)}; padding: ${rem(18)} 0; border-right: ${hairline} ${c('hair')}; background: linear-gradient(180deg, ${c('glass')}, transparent); z-index: 20; overflow-y: auto; font-family: ${ui}; }`,
  `.gp-rail-item { box-sizing: border-box; width: ${rem(60)}; padding: ${rem(9)} 0 ${rem(7)}; border-radius: ${v('radius.card')}; display: flex; flex-direction: column; align-items: center; gap: ${rem(4)}; color: ${c('ink3')}; text-decoration: none; font-size: ${rem(10)}; letter-spacing: .02em; transition: color ${v('motion.value')} ${v('motion.ease')}, background ${v('motion.value')} ${v('motion.ease')}; }`,
  `.gp-rail-icon { display: grid; place-items: center; width: ${rem(22)}; height: ${rem(22)}; }`,
  `.gp-rail-icon > svg { width: 100%; height: 100%; stroke: currentColor; fill: none; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }`,
  `.gp-rail-item:hover { color: ${c('ink')}; background: ${c('glass')}; }`,
  `.gp-rail-item[aria-current="page"] { color: ${c('ink')}; background: ${c('glass2')}; box-shadow: ${highlight}, 0 0 0 ${hairWidth} ${c('glassLine')}; }`,
  `.gp-rail-item[aria-current="page"] .gp-rail-icon { color: ${c('accent')}; }`,
  `.gp-rail-item:focus-visible, .gp-tenant-btn:focus-visible, .gp-seg button:focus-visible, .gp-menu button:focus-visible { ${focusRing} }`,
  `.gp-rail-sep { width: ${rem(32)}; height: ${hairWidth}; background: ${c('hair')}; margin: ${rem(10)} 0; flex: none; }`,
  // ---- tenant button (#6): a neutral monogram, never a logo
  `.gp-tenant-btn { position: relative; box-sizing: border-box; flex: none; width: ${rem(48)}; height: ${rem(48)}; margin-bottom: ${rem(14)}; border-radius: ${v('radius.card')}; border: ${hairline} ${c('glassLine')}; background: ${c('glass2')}; color: ${c('ink')}; box-shadow: ${highlight}; display: grid; place-items: center; font: 600 ${rem(14)}/1 ${mono}; letter-spacing: .04em; cursor: pointer; }`,
  `.gp-tenant-btn:hover { background: ${c('glass3')}; }`,
  `.gp-tenant-btn[data-status="switching"] { opacity: .6; }`,
  `.gp-tenant-btn[data-status="unavailable"]::after { content: ""; position: absolute; top: ${rem(5)}; right: ${rem(5)}; width: ${rem(7)}; height: ${rem(7)}; border-radius: ${v('radius.pill')}; background: ${c('warn')}; }`,
  // ---- scenario bar (#2)
  `.gp-seg-wrap { position: relative; display: inline-flex; max-width: 100%; font-family: ${ui}; }`,
  `.gp-seg { display: inline-flex; align-items: center; padding: ${rem(4)}; gap: ${rem(2)}; border-radius: ${v('radius.pill')}; background: ${c('glass')}; border: ${hairline} ${c('glassLine')}; box-shadow: ${highlight}; max-width: 100%; }`,
  `.gp-seg button { display: inline-flex; align-items: center; border: 0; background: transparent; padding: ${rem(7)} ${rem(14)}; border-radius: ${v('radius.pill')}; color: ${c('ink2')}; font: inherit; font-size: ${v('type.scale.s.size')}; white-space: nowrap; cursor: pointer; transition: color ${v('motion.value')} ${v('motion.ease')}, background ${v('motion.value')} ${v('motion.ease')}; }`,
  `.gp-seg button:hover { color: ${c('ink')}; }`,
  `.gp-seg button[aria-pressed="true"], .gp-seg button[data-active="true"] { background: ${c('glass3')}; color: ${c('ink')}; box-shadow: ${highlight}; }`,
  `.gp-seg-k { font-family: ${mono}; font-weight: 600; margin-right: ${rem(6)}; color: ${c('ink')}; }`,
  `.gp-seg-more-name { max-width: ${rem(160)}; overflow: hidden; text-overflow: ellipsis; margin-left: ${rem(6)}; }`,
  `.gp-menu-pop { position: absolute; top: calc(100% + ${rem(8)}); right: 0; z-index: 40; min-width: ${rem(220)}; }`,
  `.gp-menu { display: flex; flex-direction: column; gap: ${rem(2)}; }`,
  `.gp-menu-group { display: flex; flex-direction: column; gap: ${rem(2)}; }`,
  `.gp-menu-group + .gp-menu-group { margin-top: ${rem(8)}; padding-top: ${rem(8)}; border-top: ${hairline} ${c('hair')}; }`,
  `.gp-menu-label { padding: ${rem(4)} ${rem(10)}; font: ${v('type.scale.xs.weight')} ${v('type.scale.xs.size')}/1.2 ${mono}; letter-spacing: ${v('type.scale.xs.tracking')}; text-transform: uppercase; color: ${c('ink3')}; }`,
  `.gp-menu button { box-sizing: border-box; display: flex; align-items: center; justify-content: space-between; gap: ${rem(12)}; width: 100%; min-height: ${rem(36)}; padding: ${rem(6)} ${rem(10)}; border: 0; border-radius: ${v('radius.control')}; background: transparent; color: ${c('ink2')}; font: inherit; font-size: ${v('type.scale.s.size')}; text-align: left; cursor: pointer; }`,
  `.gp-menu button:hover { color: ${c('ink')}; background: ${c('glass2')}; }`,
  `.gp-menu button[aria-checked="true"] { color: ${c('ink')}; background: ${c('glass3')}; }`,
  // ---- phone: bottom bar scrolling inside itself; letters only; 44 touch targets
  `@media ${media.phone} {`,
  `  .gp-rail { position: fixed; top: auto; bottom: 0; left: 0; right: 0; width: auto; height: auto; flex-direction: row; justify-content: flex-start; align-items: center; overflow-x: auto; overflow-y: hidden; overscroll-behavior-x: contain; gap: ${rem(2)}; padding: ${rem(8)} max(${rem(10)}, env(safe-area-inset-right, 0)) calc(${rem(8)} + env(safe-area-inset-bottom, 0)) max(${rem(10)}, env(safe-area-inset-left, 0)); border-right: 0; border-top: ${hairline} ${c('hair')}; background: ${c('glass3')}; }`,
  `  .gp-rail-sep { display: none; }`,
  `  .gp-rail-item { flex: none; width: auto; min-width: ${rem(58)}; min-height: ${TOUCH_TARGET}; }`,
  `  .gp-tenant-btn { width: ${TOUCH_TARGET}; height: ${TOUCH_TARGET}; margin: 0 ${rem(6)} 0 0; }`,
  `  .gp-seg { overflow-x: auto; }`,
  `  .gp-seg button { min-height: ${TOUCH_TARGET}; min-width: ${TOUCH_TARGET}; justify-content: center; }`,
  `  .gp-seg-k { margin-right: 0; }`,
  `  .gp-seg-t, .gp-seg-more-name { ${clip} }`,
  `  .gp-menu button { min-height: ${TOUCH_TARGET}; }`,
  `}`,
  `@media (prefers-reduced-motion: reduce) {\n  .gp-rail-item, .gp-seg button { transition: none; }\n}`,
].join('\n');
