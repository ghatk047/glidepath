/**
 * Tour CSS (spotlight + coachmark), generated from the token map. Sizes are rem / em / token
 * calc()s. The scrim is the palette recipe (ground at 55%) laid down as a spread box-shadow, so
 * the highlighted control stays clickable and no backdrop-filter is used.
 */
import { cssVar, defaultTheme, tokenValue, type TokenPath } from '../../tokens';
import { mediaQuery } from '../../tokens/media';

const v = (p: TokenPath) => cssVar[p];
const c = (k: string) => cssVar[`themes.${defaultTheme}.color.${k}` as TokenPath];
const gap = v('space.gap');
const hairline = tokenValue['glass.border'].split(' ')[0]!;
const ease = `${v('motion.value')} ${v('motion.ease')}`;

/** Spotlight sits below the palette scrim (95); the card is just above the spotlight. */
export const TOUR_Z = { spotlight: 93, card: 94 } as const;
/** Padding around the target, and the gap between target and card, in CSS pixels. */
export const SPOTLIGHT_PAD_PX = 8;
export const CARD_GAP_PX = 16;
/** Card width in rem (the placement measures the real element). */
export const CARD_WIDTH_REM = 20;

export const tourCss = [
  '/* @glidepath/ui overlays/tour: generated from tokens in src/overlays/tour/styles.ts */',
  `.gp-tour-spot { position: fixed; z-index: ${TOUR_Z.spotlight}; top: 0; left: 0; box-sizing: border-box; pointer-events: none; border-radius: ${v('radius.card')}; box-shadow: 0 0 0 0.125rem ${c('accent')}, 0 0 1.25rem ${c('accentGlow')}, 0 0 0 200vmax color-mix(in srgb, ${c('ground')} 55%, transparent); transition: transform ${ease}, width ${ease}, height ${ease}; }`,
  `.gp-panel.gp-tour-card { position: fixed; z-index: ${TOUR_Z.card}; box-sizing: border-box; width: min(${CARD_WIDTH_REM}rem, calc(100vw - 2 * ${gap})); border-radius: ${v('radius.card')}; display: grid; gap: 0.625rem; transition: transform ${ease}, opacity ${ease}; }`,
  `.gp-tour-head { display: flex; align-items: baseline; justify-content: space-between; gap: 0.75rem; }`,
  `.gp-tour-count { color: ${c('ink3')}; font: ${v('type.scale.xs.weight')} ${v('type.scale.xs.size')}/1 ${v('type.families.mono')}; font-variant-numeric: ${v('type.numerals')}; }`,
  `.gp-tour-dots { display: flex; gap: 0.25rem; }`,
  `.gp-tour-dot { width: 0.375rem; height: 0.375rem; border-radius: 50%; background: ${c('hair')}; }`,
  `.gp-tour-dot[data-on] { background: ${c('accent')}; }`,
  `.gp-tour-title { margin: 0; color: ${c('ink')}; font: 600 1rem/1.25 ${v('type.families.ui')}; }`,
  `.gp-tour-body { margin: 0; color: ${c('ink2')}; font: ${v('type.scale.s.weight')} ${v('type.scale.s.size')}/1.45 ${v('type.families.ui')}; overflow-wrap: anywhere; }`,
  `.gp-tour-actions { display: flex; align-items: center; gap: 0.5rem; border-top: ${hairline} solid ${c('hair')}; padding-top: 0.625rem; }`,
  `.gp-tour-actions .gp-btn { height: 2.25rem; padding: 0 0.875rem; }`,
  `.gp-tour-actions .gp-btn:disabled { opacity: 0.4; cursor: default; }`,
  `.gp-tour-actions .gp-btn:focus-visible { outline: 0.125rem solid ${c('accent')}; outline-offset: 0.125rem; }`,
  `.gp-tour-actions [data-tour-next] { margin-left: auto; }`,
  `.gp-tour-sr { position: absolute; width: 0.0625rem; height: 0.0625rem; margin: -0.0625rem; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }`,
  // phone: the card docks as a bottom sheet above the rail
  `${mediaQuery.phone} {\n  .gp-panel.gp-tour-card { top: auto; left: ${v('space.phoneGutter')}; right: ${v('space.phoneGutter')}; width: auto; bottom: calc(${v('space.railWidth')} + ${gap} + env(safe-area-inset-bottom, 0)); }\n}`,
  `@media (prefers-reduced-motion: reduce) {\n  .gp-tour-spot, .gp-panel.gp-tour-card { transition: none; }\n}`,
].join('\n');
