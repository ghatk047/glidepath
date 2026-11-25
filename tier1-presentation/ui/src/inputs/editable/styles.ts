/**
 * Editable number + Edit popover CSS, generated from the token map. Matches
 * docs/ux/prototype/src/styles.css (`.ed`, `.pop`, `.chip`, `.btn`, `.range`, `input.numin`).
 * Sizes are rem / em / % and token calc()s (no raw pixel sizes, no hex).
 */
import { useInsertionEffect } from 'react';
import { cssVar, defaultTheme, tokenValue, type TokenPath } from '../../tokens';
import { springs } from '../../motion';

const v = (p: TokenPath) => cssVar[p];
const c = (k: string) => cssVar[`themes.${defaultTheme}.color.${k}` as TokenPath];
const gap = v('space.gap');
const part = (num: number, den: number) => `calc(${gap} * ${num} / ${den})`;
const font = (w: TokenPath, s: TokenPath, fam: TokenPath) => `${v(w)} ${v(s)}/1.25 ${v(fam)}`;
const highlight = tokenValue['glass.highlight'].replace('glassHi', c('glassHi'));
/** glass.border is "<width> glassLine": the width part. */
const hairline = tokenValue['glass.border'].split(' ')[0]!;

/** Popover width (prototype .pop, 18.75rem) and the height reserved when clamping. */
export const POPOVER_WIDTH = '18.75rem';
const POPOVER_HEIGHT = '22rem';

const spring = `${springs.drawer.durationMs}ms ${v('motion.spring')}`;
const ease = `${v('motion.value')} ${v('motion.ease')}`;
const thumb = '1.125rem';
const track = '0.25rem';
const border = `${hairline} solid ${c('glassLine')}`;

export const editableCss = [
  '/* @glidepath/ui inputs/editable: generated from tokens in src/inputs/editable/styles.ts */',
  // .ed: dotted underline on hover, solid once changed
  `.gp-ed-wrap { display: inline-flex; align-items: baseline; gap: 0.25em; }`,
  `.gp-ed { appearance: none; border: 0; background: transparent; color: inherit; font: inherit; font-variant-numeric: ${v('type.numerals')}; cursor: text; border-radius: ${v('radius.small')}; padding: 0 0.125em; margin: 0 -0.125em; text-decoration: underline dotted transparent; text-underline-offset: 0.3em; text-decoration-thickness: 0.0625em; transition: text-decoration-color ${ease}, background ${ease}; }`,
  `.gp-ed[data-mode="output"] { cursor: pointer; }`,
  `.gp-ed:hover { text-decoration-color: ${c('accent')}; background: ${c('glass')}; }`,
  `.gp-ed[data-changed] { text-decoration-color: ${c('accent')}; text-decoration-style: solid; }`,
  `.gp-ed:focus-visible, .gp-ed-pin:focus-visible { outline: 0.125rem solid ${c('accent')}; outline-offset: 0.125rem; }`,
  `.gp-ed-pin { appearance: none; display: inline-flex; align-items: center; border: 0; background: transparent; padding: 0; color: ${c('ink3')}; cursor: pointer; border-radius: ${v('radius.small')}; opacity: 0; transition: opacity ${ease}; }`,
  `.gp-ed-wrap:hover .gp-ed-pin, .gp-ed-pin:focus-visible, .gp-ed-pin[data-pinned] { opacity: 1; }`,
  `.gp-ed-pin[data-pinned] { color: ${c('accent')}; }`,
  `.gp-ed-pin svg { width: 0.75em; height: 0.75em; stroke: currentColor; fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }`,
  // popover: positioned from the anchor rect, clamped to the viewport by CSS
  `.gp-panel.gp-pop { position: fixed; z-index: 90; box-sizing: border-box; width: ${POPOVER_WIDTH}; max-width: calc(100vw - 2 * ${gap}); max-height: calc(100vh - 2 * ${gap}); overflow: auto; border-radius: ${v('radius.card')}; left: clamp(${gap}, var(--gp-pop-x, ${gap}), calc(100vw - ${POPOVER_WIDTH} - ${gap})); top: max(${gap}, min(var(--gp-pop-y, ${gap}), calc(100vh - ${POPOVER_HEIGHT}))); animation: gp-popin ${spring}; }`,
  `@keyframes gp-popin { from { opacity: 0; transform: translateY(${part(1, 3)}) scale(.97); } }`,
  `.gp-pop-h { display: flex; justify-content: space-between; align-items: center; gap: ${part(2, 3)}; }`,
  `.gp-pop-label { margin: 0; font: ${font('type.scale.xs.weight', 'type.scale.xs.size', 'type.families.mono')}; letter-spacing: ${v('type.scale.xs.tracking')}; text-transform: uppercase; color: ${c('ink3')}; }`,
  // chips
  `.gp-chip { display: inline-flex; align-items: center; gap: 0.375rem; height: 1.625rem; padding: 0 0.625rem; box-sizing: border-box; border-radius: ${v('radius.pill')}; font: ${v('type.scale.xs.weight')} 0.75rem/1 ${v('type.families.ui')}; background: ${c('glass2')}; border: ${border}; color: ${c('ink2')}; white-space: nowrap; font-variant-numeric: ${v('type.numerals')}; }`,
  `.gp-pop-meta { display: flex; flex-wrap: wrap; gap: 0.375rem; margin-top: ${part(2, 3)}; }`,
  // number field
  `.gp-numin { box-sizing: border-box; width: 100%; height: 2.75rem; border-radius: ${v('radius.control')}; border: ${border}; background: ${c('glass')}; color: ${c('ink')}; padding: 0 0.75rem; margin: 0.625rem 0 0.75rem; font: ${v('type.scale.l.weight')} ${v('type.scale.l.size')}/1 ${v('type.families.num')}; font-variant-numeric: ${v('type.numerals')}; }`,
  `.gp-numin:focus-visible, .gp-reason:focus-visible { outline: 0.125rem solid ${c('accent')}; outline-offset: 0.0625rem; }`,
  `.gp-reason { box-sizing: border-box; width: 100%; margin-top: ${part(2, 3)}; border-radius: ${v('radius.control')}; border: ${border}; background: ${c('glass')}; color: ${c('ink')}; padding: 0.625rem 0.75rem; font: ${v('type.scale.s.weight')} ${v('type.scale.s.size')}/1.25 ${v('type.families.ui')}; resize: vertical; }`,
  // slider (matches .range)
  `.gp-range { position: relative; height: 1.375rem; }`,
  `.gp-range input { -webkit-appearance: none; appearance: none; width: 100%; height: 1.375rem; margin: 0; background: transparent; }`,
  `.gp-range input::-webkit-slider-runnable-track { height: ${track}; border-radius: ${track}; background: linear-gradient(90deg, ${c('accent')} 0 var(--gp-p, 50%), ${c('track')} var(--gp-p, 50%) 100%); }`,
  `.gp-range input::-moz-range-track { height: ${track}; border-radius: ${track}; background: ${c('track')}; }`,
  `.gp-range input::-moz-range-progress { height: ${track}; border-radius: ${track}; background: ${c('accent')}; }`,
  `.gp-range input::-webkit-slider-thumb { -webkit-appearance: none; width: ${thumb}; height: ${thumb}; border-radius: 50%; margin-top: calc((${track} - ${thumb}) / 2); background: white; border: 0; box-shadow: 0 0 0 0.25rem ${c('accentGlow')}; transition: transform ${spring}; }`,
  `.gp-range input::-moz-range-thumb { width: ${thumb}; height: ${thumb}; border-radius: 50%; background: white; border: 0; box-shadow: 0 0 0 0.25rem ${c('accentGlow')}; }`,
  `.gp-range input:active::-webkit-slider-thumb { transform: scale(1.18); }`,
  `.gp-range input:focus-visible { outline: 0.125rem solid ${c('accent')}; outline-offset: 0.125rem; border-radius: ${v('radius.small')}; }`,
  // warnings: tier 2's words, with a glyph so colour is never the only cue
  `.gp-pop-warn { list-style: none; margin: ${part(2, 3)} 0 0; padding: 0; display: grid; gap: 0.375rem; color: ${c('warn')}; font: ${v('type.scale.s.weight')} ${v('type.scale.s.size')}/1.3 ${v('type.families.ui')}; }`,
  `.gp-pop-warn li::before { content: "\\25B2\\00a0"; }`,
  // buttons (matches .btn / .btn.primary / .btn.ghost)
  `.gp-pop-actions { display: flex; justify-content: flex-end; gap: ${part(4, 9)}; margin-top: ${part(7, 9)}; }`,
  `.gp-btn { display: inline-flex; align-items: center; justify-content: center; gap: 0.5rem; height: 2.5rem; padding: 0 1.125rem; box-sizing: border-box; border-radius: ${v('radius.control')}; border: ${border}; background: ${c('glass2')}; color: ${c('ink')}; font: 500 ${v('type.scale.s.size')}/1 ${v('type.families.ui')}; box-shadow: ${highlight}; cursor: pointer; transition: background ${ease}; }`,
  `.gp-btn:hover { background: ${c('glass3')}; }`,
  `.gp-btn:focus-visible { outline: 0.125rem solid ${c('accent')}; outline-offset: 0.125rem; }`,
  `.gp-btn[data-variant="primary"] { background: ${c('accent')}; color: ${c('accentInk')}; border-color: transparent; box-shadow: 0 0.625rem 1.875rem -0.625rem ${c('accentGlow')}; }`,
  `.gp-btn[data-variant="ghost"] { background: transparent; box-shadow: none; }`,
  `.gp-btn:disabled { opacity: .5; cursor: not-allowed; }`,
  `@media (prefers-reduced-motion: reduce) {\n  .gp-pop, .gp-ed, .gp-btn, .gp-ed-pin, .gp-range input::-webkit-slider-thumb { animation: none; transition: none; }\n}`,
].join('\n');

const STYLE_ATTR = 'data-glidepath-editable';

/** Mounts the editable CSS into <head> once (idempotent, safe without a DOM). */
export function useEditableStyles(): void {
  useInsertionEffect(() => {
    const doc = (globalThis as { document?: Document }).document;
    if (!doc || doc.head.querySelector(`style[${STYLE_ATTR}]`)) return;
    const el = doc.createElement('style');
    el.setAttribute(STYLE_ATTR, '');
    el.textContent = editableCss;
    doc.head.appendChild(el);
  }, []);
}
