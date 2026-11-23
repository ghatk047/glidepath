/**
 * Command palette (#4) and Edits tray (#5) CSS, generated from the token map. Matches
 * docs/ux/prototype/src/styles.css (`.scrim`, `.palette`, `.edits`, `.dot`). Sizes are rem / em / %
 * and token calc()s (no raw pixel sizes, no hex). Buttons and chips reuse the `.gp-btn` and
 * `.gp-chip` rules of inputs/editable.
 */
import { useInsertionEffect } from 'react';
import { cssVar, defaultTheme, tokenValue, type TokenPath } from '../../tokens';
import { springs } from '../../motion';
import { useEditableStyles } from '../../inputs/editable';

const v = (p: TokenPath) => cssVar[p];
const c = (k: string) => cssVar[`themes.${defaultTheme}.color.${k}` as TokenPath];
const gap = v('space.gap');
const part = (num: number, den: number) => `calc(${gap} * ${num} / ${den})`;
const hairline = tokenValue['glass.border'].split(' ')[0]!;
const spring = `${springs.drawer.durationMs}ms ${v('motion.spring')}`;
const ease = `${v('motion.value')} ${v('motion.ease')}`;
const border = `${hairline} solid ${c('glassLine')}`;

/** Tray width (rem) and the gap under the Edits button. */
export const TRAY_WIDTH = '24rem';

export const paletteCss = [
  '/* @glidepath/ui overlays/palette: generated from tokens in src/overlays/palette/styles.ts */',
  // scrim: the ground colour at 55%, so it follows the theme
  `.gp-scrim { position: fixed; inset: 0; z-index: 95; display: flex; align-items: flex-start; justify-content: center; box-sizing: border-box; padding: 12vh ${v('space.phoneGutter')} 0; background: color-mix(in srgb, ${c('ground')} 55%, transparent); }`,
  `.gp-panel.gp-palette { width: min(38.75rem, 100%); box-sizing: border-box; padding: 0.625rem; border-radius: ${v('radius.panel')}; animation: gp-popin-pal ${spring}; }`,
  `@keyframes gp-popin-pal { from { opacity: 0; transform: translateY(${part(1, 3)}) scale(.97); } }`,
  `.gp-pal-q { box-sizing: border-box; width: 100%; height: 3.125rem; border: 0; background: transparent; color: ${c('ink')}; padding: 0 0.75rem; font: ${v('type.scale.m.weight')} 1.125rem/1 ${v('type.families.ui')}; }`,
  `.gp-pal-q::placeholder { color: ${c('ink3')}; }`,
  `.gp-pal-q:focus { outline: none; }`,
  `.gp-pal-q:focus-visible { outline: none; }`,
  `.gp-palette:focus-within .gp-pal-q { box-shadow: inset 0 -0.125rem 0 ${c('accent')}; }`,
  `.gp-pal-res { max-height: 46vh; overflow: auto; border-top: ${hairline} solid ${c('hair')}; padding-top: 0.375rem; margin: 0; padding-inline: 0; list-style: none; }`,
  `.gp-pal-opt { display: flex; justify-content: space-between; align-items: baseline; gap: 0.75rem; width: 100%; box-sizing: border-box; text-align: left; border-radius: ${v('radius.control')}; padding: 0.625rem 0.75rem; font: ${v('type.scale.m.weight')} 0.875rem/1.25 ${v('type.families.ui')}; color: ${c('ink')}; cursor: pointer; }`,
  `.gp-pal-opt[aria-selected="true"] { background: ${c('glass2')}; box-shadow: inset 0 0 0 0.0625rem ${c('accent')}; }`,
  `.gp-pal-opt:hover { background: ${c('glass2')}; }`,
  `.gp-pal-name { min-width: 0; overflow-wrap: anywhere; }`,
  `.gp-pal-kind { flex: none; color: ${c('ink3')}; font: ${v('type.scale.xs.weight')} ${v('type.scale.xs.size')}/1.25 ${v('type.families.mono')}; white-space: nowrap; }`,
  `.gp-pal-empty { margin: 0; padding: 0.75rem; color: ${c('ink3')}; font: ${v('type.scale.s.weight')} ${v('type.scale.s.size')}/1.5 ${v('type.families.ui')}; }`,
  `.gp-pal-sug { appearance: none; border: 0; background: transparent; padding: 0 0.125rem; margin: 0; cursor: pointer; color: ${c('accent')}; font: inherit; text-decoration: underline; text-underline-offset: 0.2em; border-radius: ${v('radius.small')}; }`,
  `.gp-pal-sug:focus-visible { outline: 0.125rem solid ${c('accent')}; outline-offset: 0.125rem; }`,
  `.gp-sr { position: absolute; width: 0.0625rem; height: 0.0625rem; margin: -0.0625rem; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }`,
  // Edits counter (.edits) and its dot (.dot)
  `.gp-edits { display: inline-block; position: relative; }`,
  `.gp-edits-btn { appearance: none; display: inline-flex; align-items: center; gap: 0.5rem; height: 2.25rem; padding: 0 0.75rem; box-sizing: border-box; border-radius: ${v('radius.control')}; border: ${border}; background: ${c('glass')}; color: ${c('ink2')}; font: ${v('type.scale.s.weight')} ${v('type.scale.s.size')}/1 ${v('type.families.ui')}; cursor: pointer; transition: background ${ease}; }`,
  `.gp-edits-btn:hover, .gp-edits-btn[aria-expanded="true"] { background: ${c('glass2')}; }`,
  `.gp-edits-btn:focus-visible { outline: 0.125rem solid ${c('accent')}; outline-offset: 0.125rem; }`,
  `.gp-edits-btn b { font-weight: 600; color: ${c('ink')}; font-variant-numeric: ${v('type.numerals')}; }`,
  `.gp-edits-dot { display: inline-block; width: 0.4375rem; height: 0.4375rem; border-radius: 50%; background: ${c('accent')}; box-shadow: 0 0 0.625rem ${c('accentGlow')}; }`,
  // tray: fixed under the button, right edge aligned to it
  `.gp-panel.gp-tray { position: fixed; z-index: 90; box-sizing: border-box; width: ${TRAY_WIDTH}; max-width: calc(100vw - 2 * ${gap}); max-height: calc(100vh - 2 * ${gap}); overflow: auto; border-radius: ${v('radius.card')}; top: var(--gp-tray-y, ${gap}); right: max(${gap}, calc(100vw - var(--gp-tray-x, 100vw))); animation: gp-popin-pal ${spring}; }`,
  `.gp-tray-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.375rem; max-height: 50vh; overflow: auto; }`,
  `.gp-tray-list:focus-visible { outline: 0.125rem solid ${c('accent')}; outline-offset: 0.125rem; }`,
  `.gp-tray-item { display: grid; gap: 0.25rem; padding: 0.625rem 0.75rem; border-radius: ${v('radius.control')}; background: ${c('glass')}; border: ${border}; }`,
  `.gp-tray-who { color: ${c('ink3')}; font: ${v('type.scale.xs.weight')} ${v('type.scale.xs.size')}/1.25 ${v('type.families.mono')}; letter-spacing: ${v('type.scale.xs.tracking')}; text-transform: uppercase; }`,
  `.gp-tray-what { color: ${c('ink')}; font: ${v('type.scale.s.weight')} ${v('type.scale.s.size')}/1.3 ${v('type.families.ui')}; overflow-wrap: anywhere; }`,
  `.gp-tray-change { color: ${c('ink2')}; font: ${v('type.scale.s.weight')} ${v('type.scale.s.size')}/1.3 ${v('type.families.num')}; font-variant-numeric: ${v('type.numerals')}; }`,
  `.gp-tray-change b { font-weight: 600; color: ${c('ink')}; }`,
  `.gp-tray-empty { margin: 0; color: ${c('ink3')}; font: ${v('type.scale.s.weight')} ${v('type.scale.s.size')}/1.5 ${v('type.families.ui')}; }`,
  `.gp-tray-actions { display: flex; flex-wrap: wrap; gap: ${part(4, 9)}; margin-top: ${part(7, 9)}; }`,
  `.gp-tray-actions .gp-btn[data-variant="primary"] { margin-left: auto; }`,
  `@media (prefers-reduced-motion: reduce) {\n  .gp-palette, .gp-tray, .gp-edits-btn { animation: none; transition: none; }\n}`,
].join('\n');

const STYLE_ATTR = 'data-glidepath-palette';

/** Mounts the palette CSS (and the shared button / chip CSS) into <head> once. */
export function usePaletteStyles(): void {
  useEditableStyles();
  useInsertionEffect(() => {
    const doc = (globalThis as { document?: Document }).document;
    if (!doc || doc.head.querySelector(`style[${STYLE_ATTR}]`)) return;
    const el = doc.createElement('style');
    el.setAttribute(STYLE_ATTR, '');
    el.textContent = paletteCss;
    doc.head.appendChild(el);
  }, []);
}
