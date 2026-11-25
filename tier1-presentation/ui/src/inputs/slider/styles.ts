/**
 * Slider CSS, from docs/ux/prototype/src/styles.css (`.ctl`, `.ctl-h`, `.range`, `.ghost`,
 * `.range.est`, `.tip`). Colours are theme tokens; sizes derive from the token gap (18) the way
 * glass/styles.ts does, so 18 px thumb = 1 gap, 4 px track = 4/18 gap, and so on.
 * Mounted once by <Slider> through a React 19 hoisted <style href precedence>.
 */
import { transition } from '../../motion';
import { cssVar, defaultTheme, type TokenPath } from '../../tokens';

const v = (p: TokenPath) => cssVar[p];
type ColorKey =
  'accent' | 'accentGlow' | 'track' | 'ink' | 'ink2' | 'ink3' | 'glass3' | 'glassLine';
/** Theme vars are the same name in every theme; the default theme path names them. */
const c = (k: ColorKey) => cssVar[`themes.${defaultTheme}.color.${k}` as TokenPath];

const gap = v('space.gap');
/** A fraction of the token gap (18 at the default): `g(4)` is 4 px at the default gap. */
const g = (num: number) => `calc(${gap} * ${num} / 18)`;

const thumb = gap;
const track = g(4);
const height = g(22);
const ring = g(4);
/**
 * The thumb is white in both themes (levers-dark/light-1440): tokens.json has no white token
 * (accentInk is white only in Daylight), so the CSS keyword is used. The drop shadow likewise.
 */
const thumbFill = 'white';
const drop = `0 ${g(4)} ${g(10)} color-mix(in srgb, black 35%, transparent)`;
const thumbShadow = (ringColour: string) => `0 0 0 ${ring} ${ringColour}, ${drop}`;
/** The thumb grows on press with the toggle spring (motion/springs). */
const thumbTransition = transition('toggle', ['transform']);
const shadow = cssVar[`themes.${defaultTheme}.shadow` as TokenPath];

const fill = (colour: string) =>
  `linear-gradient(90deg, ${colour} 0 var(--p, 50%), ${c('track')} var(--p, 50%) 100%)`;

export const sliderCss = `
.gp-slider { display: flex; flex-direction: column; gap: ${g(8)}; min-width: 0; position: relative; }
.gp-slider-head { display: flex; justify-content: space-between; align-items: baseline; gap: ${g(8)}; position: relative; }
.gp-slider-label { font-family: ${v('type.families.ui')}; font-size: ${v('type.scale.s.size')}; color: ${c('ink2')}; min-width: 0; }
.gp-slider-lock { display: inline-flex; vertical-align: -0.1em; margin-left: ${ring}; color: ${c('ink3')}; }
.gp-slider-lock svg { width: 0.95em; height: 0.95em; stroke: currentColor; fill: none; stroke-width: 1.8; }
.gp-slider-value { font: 500 ${v('type.scale.m.size')}/1 ${v('type.families.num')}; font-variant-numeric: ${v('type.numerals')}; color: ${c('ink')}; white-space: nowrap; }
.gp-slider-tip { position: absolute; left: 0; bottom: calc(100% + ${g(6)}); z-index: 80; pointer-events: none; padding: ${g(8)} ${g(10)}; border-radius: ${v('radius.small')}; font-size: ${v('type.scale.s.size')}; color: ${c('ink')}; background: ${c('glass3')}; border: ${g(1)} solid ${c('glassLine')}; box-shadow: ${shadow}; opacity: 0; visibility: hidden; transition: opacity ${v('motion.value')} ${v('motion.ease')}; white-space: nowrap; }
.gp-slider-head:has(.gp-slider-lock:hover) .gp-slider-tip,
.gp-slider:has(input:focus-visible) .gp-slider-tip { opacity: 1; visibility: visible; }
.gp-slider-range { position: relative; height: ${height}; }
.gp-slider-range input { -webkit-appearance: none; appearance: none; width: 100%; height: ${height}; background: transparent; margin: 0; position: relative; z-index: 2; cursor: pointer; }
.gp-slider-range input:focus { outline: none; }
.gp-slider-range input:focus-visible { outline: ${g(2)} solid ${c('accent')}; outline-offset: ${g(4)}; border-radius: ${v('radius.small')}; }
.gp-slider-range input::-webkit-slider-runnable-track { height: ${track}; border-radius: ${track}; background: ${fill(c('accent'))}; }
.gp-slider-range input::-moz-range-track { height: ${track}; border-radius: ${track}; background: ${c('track')}; }
.gp-slider-range input::-moz-range-progress { height: ${track}; border-radius: ${track}; background: ${c('accent')}; }
.gp-slider-range input::-webkit-slider-thumb { -webkit-appearance: none; width: ${thumb}; height: ${thumb}; border-radius: 50%; margin-top: calc((${track} - ${thumb}) / 2); background: ${thumbFill}; border: 0; box-shadow: ${thumbShadow(c('accentGlow'))}; transition: ${thumbTransition}; }
.gp-slider-range input::-moz-range-thumb { width: ${thumb}; height: ${thumb}; border-radius: 50%; background: ${thumbFill}; border: 0; box-shadow: ${thumbShadow(c('accentGlow'))}; }
.gp-slider-range input:active::-webkit-slider-thumb { transform: scale(1.18); }
.gp-slider-ghost { position: absolute; top: ${g(4)}; width: ${g(2)}; height: ${g(14)}; border-radius: ${g(2)}; background: ${c('ink3')}; opacity: 0.7; z-index: 1; transform: translateX(-50%); pointer-events: none; }
.gp-slider-ghost b { position: absolute; top: ${g(-13)}; left: 50%; transform: translateX(-50%); font: 600 ${g(9)}/1 ${v('type.families.mono')}; color: ${c('ink3')}; }
.gp-slider.est .gp-slider-range input::-webkit-slider-runnable-track { background: ${fill(c('ink3'))}; }
.gp-slider.est .gp-slider-range input::-moz-range-progress { background: ${c('ink3')}; }
.gp-slider.est .gp-slider-range input::-webkit-slider-thumb { box-shadow: ${thumbShadow(c('glass3'))}; }
.gp-slider.est .gp-slider-range input::-moz-range-thumb { box-shadow: ${thumbShadow(c('glass3'))}; }
.gp-slider-sr { position: absolute; width: ${g(1)}; height: ${g(1)}; margin: ${g(-1)}; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
`;
