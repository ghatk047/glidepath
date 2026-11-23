/**
 * Ownership bar CSS, from docs/ux/prototype/src/styles.css (`.ownbar`, `.ownbar i`, `.hdl`).
 * Colours are theme tokens; sizes derive from the token gap (18) the way slider/styles.ts does:
 * 26 px bar = 26/18 gap, 14 px handle = 14/18 gap. Mounted once by <OwnershipBar> through a
 * React 19 hoisted <style href precedence>.
 */
import { transition } from '../../motion';
import { cssVar, defaultTheme, type TokenPath } from '../../tokens';

const v = (p: TokenPath) => cssVar[p];
type ColorKey = 'accent' | 'ground' | 'warn' | 'neg';
const c = (k: ColorKey) => cssVar[`themes.${defaultTheme}.color.${k}` as TokenPath];

const gap = v('space.gap');
const g = (num: number) => `calc(${gap} * ${num} / 18)`;

/** Segment text and the grip are white on the VP colours (prototype `.ownbar`); no white token. */
const onSeries = 'white';
const handleShadow = `0 0 ${g(6)} color-mix(in srgb, black 40%, transparent)`;
const widthMotion = transition('toggle', ['width']);

export const ownershipCss = `
.gp-own { position: relative; display: flex; flex-direction: column; gap: ${g(6)}; min-width: 0; }
.gp-own-bar { position: relative; display: flex; height: ${g(26)}; border-radius: ${v('radius.small')}; overflow: hidden; touch-action: none; }
.gp-own-seg { box-sizing: border-box; height: 100%; display: grid; place-items: center; min-width: 0; overflow: hidden; font: 600 ${g(10)}/1 ${v('type.families.mono')}; font-variant-numeric: ${v('type.numerals')}; color: ${onSeries}; transition: ${widthMotion}; }
.gp-own-seg + .gp-own-seg { border-left: ${g(2)} solid ${c('ground')}; }
.gp-own-seg[data-empty] { border-left: 0; }
.gp-own-bar[data-live] .gp-own-seg { transition: none; }
.gp-own-hdl { position: absolute; top: 0; bottom: 0; width: ${g(14)}; transform: translateX(-50%); cursor: ew-resize; z-index: 2; touch-action: none; outline: none; }
.gp-own-hdl::after { content: ""; position: absolute; left: calc(50% - ${g(1)}); top: ${g(5)}; bottom: ${g(5)}; width: ${g(2)}; border-radius: ${g(2)}; background: ${onSeries}; opacity: 0; box-shadow: ${handleShadow}; transition: opacity ${v('motion.value')} ${v('motion.ease')}; }
.gp-own-bar:hover .gp-own-hdl::after, .gp-own-hdl:focus-visible::after, .gp-own-hdl[data-active]::after { opacity: 0.9; }
.gp-own-hdl:focus-visible { outline: ${g(2)} solid ${c('accent')}; outline-offset: ${g(-2)}; border-radius: ${g(4)}; }
.gp-own-msgs { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: ${g(2)}; font-family: ${v('type.families.ui')}; font-size: ${v('type.scale.xs.size')}; }
.gp-own-msgs li { color: ${c('warn')}; }
.gp-own-msgs li[data-severity="error"] { color: ${c('neg')}; }
@media (prefers-reduced-motion: reduce) { .gp-own-seg, .gp-own-hdl::after { transition: none; } }
`;
