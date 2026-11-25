import { createElement, type ReactElement } from 'react';
import { rem } from '@glidepath/ui/shell';

/**
 * CSS of wizard steps 3 and 4 (`gp-wzr-*`), token CSS vars only; metrics with no token are rem.
 * Bar fills are drawn from tier 2's values by CSS custom properties, never computed here.
 */
const mono = 'var(--font-mono), ui-monospace, monospace';
const line = `${rem(1)} solid var(--glass-line)`;
const focus = `outline: ${rem(2)} solid var(--accent); outline-offset: ${rem(2)};`;

export const resultCss = [
  '/* web modules/wizard: generated from tokens in src/modules/wizard/resultStyles.ts */',
  `.gp-wzr-stack { display: flex; flex-direction: column; gap: ${rem(14)}; min-width: 0; }`,
  `.gp-wzr-row { display: flex; align-items: center; justify-content: space-between; gap: ${rem(12)}; color: var(--ink-2); font-size: var(--type-s-size); }`,
  `.gp-wzr-eyebrow { font: var(--type-xs-weight) var(--type-xs-size)/1.2 ${mono}; letter-spacing: var(--type-xs-tracking); text-transform: uppercase; color: var(--ink-3); margin: 0; }`,
  `.gp-wzr-faint { color: var(--ink-3); font-size: var(--type-s-size); }`,
  `.gp-wzr-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(${rem(96)}, 1fr)); gap: ${rem(10)}; margin: 0; }`,
  `.gp-wzr-stat { display: flex; flex-direction: column; gap: ${rem(2)}; min-width: 0; }`,
  `.gp-wzr-stat dt { font: var(--type-xs-weight) var(--type-xs-size)/1.2 ${mono}; letter-spacing: var(--type-xs-tracking); text-transform: uppercase; color: var(--ink-3); }`,
  `.gp-wzr-stat dd { margin: 0; color: var(--ink); font: var(--type-m-weight) var(--type-m-size)/1.2 var(--font-num), var(--font-ui), sans-serif; font-variant-numeric: var(--type-numerals); }`,
  `.gp-wzr-hero { font: var(--type-xl-weight) var(--type-xl-size)/1.1 var(--font-num), var(--font-ui), sans-serif; font-variant-numeric: var(--type-numerals); color: var(--ink); }`,
  `.gp-wzr-parts { margin: ${rem(8)} 0 0; color: var(--ink-2); font-variant-numeric: var(--type-numerals); text-align: center; }`,
  `.gp-wzr-parts [data-dim] { opacity: 0.55; }`,
  `.gp-wzr-timing { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: ${rem(8)}; }`,
  `.gp-wzr-timing-row { display: flex; align-items: center; flex-wrap: wrap; gap: ${rem(8)}; }`,
  `.gp-wzr-lever { flex: 1 1 100%; color: var(--ink); font-size: var(--type-s-size); }`,
  `.gp-wzr-select { background: var(--glass-2); color: var(--ink); border: ${line}; border-radius: var(--radius-pill); padding: ${rem(4)} ${rem(10)}; font: inherit; }`,
  `.gp-wzr-select:focus-visible { ${focus} }`,
  `.gp-wzr-own { display: flex; flex-direction: column; gap: var(--space-gap); margin-top: var(--space-gap); }`,
  `.gp-wzr-outlays { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: ${rem(8)}; }`,
  `.gp-wzr-outlays li { display: flex; justify-content: space-between; gap: ${rem(12)}; color: var(--ink-2); font-variant-numeric: var(--type-numerals); }`,
  `.gp-wzr-vps { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: ${rem(14)}; }`,
  `.gp-wzr-vp { display: flex; flex-direction: column; gap: ${rem(8)}; min-width: 0; }`,
  `.gp-wzr-vp-name { display: flex; align-items: center; gap: ${rem(8)}; color: var(--ink); font-size: var(--type-s-size); }`,
  `.gp-wzr-vp-net { color: var(--ink); font-variant-numeric: var(--type-numerals); }`,
  `.gp-wzr-swatch { width: ${rem(10)}; height: ${rem(10)}; border-radius: ${rem(3)}; background: var(--gp-vp-colour); flex: none; }`,
  `.gp-wzr-odds { display: flex; flex-direction: column; gap: ${rem(4)}; }`,
  `.gp-wzr-odds-big { font: var(--type-xl-weight) var(--type-xl-size)/1.1 var(--font-num), var(--font-ui), sans-serif; font-variant-numeric: var(--type-numerals); color: var(--ink); }`,
  `.gp-wzr-flow { position: relative; height: ${rem(64)}; }`,
  `.gp-wzr-found { display: flex; flex-direction: column; gap: ${rem(12)}; align-items: flex-start; }`,
  `.gp-wzr-moves { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: ${rem(8)}; align-self: stretch; }`,
  `.gp-wzr-actions { display: flex; gap: ${rem(10)}; flex-wrap: wrap; }`,
  `.gp-wzr-btn { border: ${line}; background: var(--glass-2); color: var(--ink); border-radius: var(--radius-pill); padding: ${rem(8)} ${rem(16)}; font: inherit; cursor: pointer; transition: background var(--motion-flash) var(--motion-ease); }`,
  `.gp-wzr-btn[data-primary] { background: var(--accent); color: var(--on-accent, var(--ground)); border-color: transparent; }`,
  `.gp-wzr-btn:disabled { opacity: 0.55; cursor: default; }`,
  `.gp-wzr-btn:focus-visible { ${focus} }`,
  `.gp-wzr-problem { margin: 0; color: var(--neg, var(--ink)); }`,
  `@media (prefers-reduced-motion: reduce) { .gp-wzr-btn { transition: none; } }`,
  `@media (max-width: ${rem(760)}) { .gp-wzr-vps { grid-template-columns: minmax(0, 1fr); } }`,
].join('\n');

/** Mounted by StepPolicy and StepResult; React 19 de-duplicates by `href`. */
export function ResultStyles(): ReactElement {
  return createElement('style', { href: 'glidepath-wizard-result', precedence: 'glidepath' }, resultCss);
}
