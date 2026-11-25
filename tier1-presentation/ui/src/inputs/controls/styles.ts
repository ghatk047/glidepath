/**
 * Controls CSS (dial, toggle, stepper, segmented, radio card, prompt bar), generated from the
 * token map. Matches docs/ux/prototype/src/styles.css (`.knob`, `.tgl`, `.stepper`, `.seg`,
 * `.radio-card`, `.prompt`). Sizes are rem / em / % and token calc()s (no raw pixels, no hex).
 */
import { useInsertionEffect } from 'react';
import { cssVar, defaultTheme, tokenValue, type TokenPath } from '../../tokens';
import { springs } from '../../motion';

const v = (p: TokenPath) => cssVar[p];
const c = (k: string) => cssVar[`themes.${defaultTheme}.color.${k}` as TokenPath];
const gap = v('space.gap');
const highlight = tokenValue['glass.highlight'].replace('glassHi', c('glassHi'));
const hairline = tokenValue['glass.border'].split(' ')[0]!;
const border = `${hairline} solid ${c('glassLine')}`;
const toggleSpring = `${springs.toggle.durationMs}ms ${v('motion.spring')}`;
const ease = `${v('motion.value')} ${v('motion.ease')}`;
const focus = `outline: 0.125rem solid ${c('accent')}; outline-offset: 0.125rem;`;

export const controlsCss = [
  '/* @glidepath/ui inputs/controls: generated from tokens in src/inputs/controls/styles.ts */',
  // dial (.knob)
  `.gp-dial { display: flex; flex-direction: column; align-items: center; gap: calc(${gap} / 3); text-align: center; touch-action: none; user-select: none; }`,
  `.gp-dial svg { width: 6rem; height: 6rem; cursor: grab; border-radius: 50%; }`,
  `.gp-dial svg:active { cursor: grabbing; }`,
  `.gp-dial svg:focus-visible { ${focus} }`,
  `.gp-dial-track { stroke: ${c('track')}; fill: none; stroke-width: 5; stroke-linecap: round; }`,
  `.gp-dial-arc { stroke: ${c('accent')}; fill: none; stroke-width: 5; stroke-linecap: round; }`,
  `.gp-dial-ghost { stroke: ${c('ink3')}; stroke-width: 2; }`,
  `.gp-dial-cap { fill: ${c('glass2')}; stroke: ${c('glassLine')}; }`,
  `.gp-dial-handle { fill: white; filter: drop-shadow(0 0 0.25rem ${c('accentGlow')}); }`,
  `.gp-dial-value { font: ${v('type.scale.m.weight')} ${v('type.scale.m.size')}/1 ${v('type.families.num')}; font-variant-numeric: ${v('type.numerals')}; }`,
  `.gp-dial-label { font: ${v('type.scale.xs.weight')} ${v('type.scale.xs.size')}/1.25 ${v('type.families.ui')}; color: ${c('ink3')}; }`,
  // toggle (.tgl)
  `.gp-toggle { position: relative; display: inline-block; width: 2.375rem; height: 1.375rem; flex: none; }`,
  `.gp-toggle input { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; margin: 0; cursor: pointer; z-index: 1; }`,
  `.gp-toggle-track { position: absolute; inset: 0; box-sizing: border-box; border-radius: ${v('radius.pill')}; background: ${c('track')}; border: ${border}; transition: background ${ease}; }`,
  `.gp-toggle-track::after { content: ""; position: absolute; top: 0.125rem; left: 0.125rem; width: 1rem; height: 1rem; border-radius: 50%; background: white; box-shadow: 0 0.125rem 0.375rem ${c('glassLine')}; transition: transform ${toggleSpring}; }`,
  `.gp-toggle input:checked + .gp-toggle-track { background: ${c('accent')}; border-color: transparent; }`,
  `.gp-toggle input:checked + .gp-toggle-track::after { transform: translateX(1rem); }`,
  `.gp-toggle input:focus-visible + .gp-toggle-track { ${focus} }`,
  `.gp-toggle input:disabled { cursor: not-allowed; }`,
  // stepper
  `.gp-stepper { display: inline-flex; align-items: center; box-sizing: border-box; height: 2.25rem; border-radius: ${v('radius.control')}; border: ${border}; background: ${c('glass')}; }`,
  `.gp-stepper button { width: 2rem; height: 2.125rem; border: 0; background: transparent; color: ${c('ink2')}; font-size: 1rem; cursor: pointer; border-radius: ${v('radius.control')}; }`,
  `.gp-stepper button:hover { color: ${c('ink')}; }`,
  `.gp-stepper button:disabled { opacity: .5; cursor: not-allowed; }`,
  `.gp-stepper button:focus-visible, .gp-stepper input:focus-visible { ${focus} }`,
  `.gp-stepper input { width: 4rem; border: 0; background: transparent; color: ${c('ink')}; text-align: center; font: 500 0.9375rem/1 ${v('type.families.num')}; font-variant-numeric: ${v('type.numerals')}; }`,
  // segmented (.seg)
  `.gp-seg { display: inline-flex; padding: 0.25rem; gap: 0.125rem; border-radius: ${v('radius.pill')}; background: ${c('glass')}; border: ${border}; box-shadow: ${highlight}; position: relative; }`,
  `.gp-seg button { border: 0; background: transparent; padding: 0.4375rem 0.875rem; border-radius: ${v('radius.pill')}; color: ${c('ink2')}; font: ${v('type.scale.s.weight')} ${v('type.scale.s.size')}/1.25 ${v('type.families.ui')}; white-space: nowrap; cursor: pointer; transition: color ${ease}, background ${ease}; }`,
  `.gp-seg button:hover { color: ${c('ink')}; }`,
  `.gp-seg button:focus-visible { ${focus} }`,
  `.gp-seg button[aria-pressed="true"] { background: ${c('glass3')}; color: ${c('ink')}; box-shadow: ${highlight}; }`,
  `.gp-seg[data-size="sm"] button { padding: 0.3125rem 0.6875rem; font-size: ${v('type.scale.xs.size')}; }`,
  // radio card
  `.gp-radio-card { display: flex; align-items: center; gap: 0.75rem; padding: 0.6875rem 0.75rem; border-radius: ${v('radius.control')}; border: ${hairline} solid transparent; cursor: pointer; font: ${v('type.scale.s.weight')} ${v('type.scale.s.size')}/1.25 ${v('type.families.ui')}; color: ${c('ink')}; }`,
  `.gp-radio-card:hover { background: ${c('glass')}; }`,
  `.gp-radio-card input { accent-color: ${c('accent')}; width: 1rem; height: 1rem; margin: 0; }`,
  `.gp-radio-card[data-checked] { background: ${c('glass2')}; border-color: ${c('glassLine')}; }`,
  `.gp-radio-card:has(input:focus-visible) { ${focus} }`,
  // prompt bar (.prompt)
  `.gp-prompt { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; padding: 0.375rem 0.375rem 0.375rem 0.875rem; border-radius: ${v('radius.control')}; border: ${border}; background: ${c('glass')}; }`,
  `.gp-prompt input { flex: 1; min-width: 0; border: 0; background: transparent; color: ${c('ink')}; height: 2.25rem; font: ${v('type.scale.s.weight')} ${v('type.scale.s.size')}/1.25 ${v('type.families.ui')}; }`,
  `.gp-prompt:focus-within { ${focus} }`,
  `.gp-prompt input:focus { outline: none; }`,
  `.gp-prompt button { display: inline-flex; align-items: center; height: 2.25rem; padding: 0 1.125rem; border: 0; border-radius: ${v('radius.control')}; background: ${c('accent')}; color: ${c('accentInk')}; font: 500 ${v('type.scale.s.size')}/1 ${v('type.families.ui')}; cursor: pointer; }`,
  `.gp-prompt button:disabled { opacity: .5; cursor: not-allowed; }`,
  `.gp-prompt-note { flex-basis: 100%; margin: 0; color: ${c('ink3')}; font: ${v('type.scale.xs.weight')} ${v('type.scale.xs.size')}/1.25 ${v('type.families.ui')}; }`,
  `@media (prefers-reduced-motion: reduce) {\n  .gp-toggle-track, .gp-toggle-track::after, .gp-seg button { transition: none; }\n}`,
].join('\n');

const STYLE_ATTR = 'data-glidepath-controls';

/** Mounts the controls CSS into <head> once (idempotent, safe without a DOM). */
export function useControlsStyles(): void {
  useInsertionEffect(() => {
    const doc = (globalThis as { document?: Document }).document;
    if (!doc || doc.head.querySelector(`style[${STYLE_ATTR}]`)) return;
    const el = doc.createElement('style');
    el.setAttribute(STYLE_ATTR, '');
    el.textContent = controlsCss;
    doc.head.appendChild(el);
  }, []);
}
