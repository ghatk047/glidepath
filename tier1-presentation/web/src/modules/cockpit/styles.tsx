import { rem, TOUCH_TARGET } from '@glidepath/ui/shell';
import { media } from '@glidepath/ui/tokens';

/**
 * Cockpit hero CSS (prototype `.gauge-wrap`, `.stats`, `.hero-inputs`; cockpit-*-1440 / -390
 * renders), written with token CSS vars. Metrics with no design token are rem (`rem()` from the
 * ui shell), so this file carries no hex and no raw px. Gauge, bridge, slider, stepper, chips and
 * the glass panels bring their own CSS from `@glidepath/ui`.
 */

const line = `${rem(1)} solid var(--glass-line)`;
const focus = `outline: ${rem(2)} solid var(--accent); outline-offset: ${rem(2)};`;
const mono = 'var(--font-mono), ui-monospace, monospace';
const num = 'var(--font-num), var(--font-ui), system-ui, sans-serif';
const label = `font: var(--type-xs-weight) var(--type-xs-size)/1.2 ${mono}; letter-spacing: var(--type-xs-tracking); text-transform: uppercase; color: var(--ink-3);`;

export const cockpitCss = [
  '/* web modules/cockpit: generated from tokens in src/modules/cockpit/styles.ts */',
  // the global layer (.gp-main) already pads the content: no scaffold padding around the grid
  `.gp-module.gp-cockpit { min-width: 0; padding: 0; }`,
  // Net savings
  `.gp-cockpit-net { display: flex; flex-direction: column; }`,
  `.gp-cockpit-scenario { color: var(--accent); background: color-mix(in srgb, var(--accent) 14%, transparent); border-color: transparent; }`,
  `.gp-cockpit-net .gp-gauge { width: min(100%, ${rem(460)}); margin: 0 auto; }`,
  `.gp-cockpit-hero { display: inline-flex; align-items: baseline; }`,
  `.gp-cockpit-hero .gp-value, .gp-cockpit-hero .gp-ed { font: inherit; letter-spacing: inherit; color: inherit; }`,
  // the roll reserves its width in ch; the number hugs its unit (render: "$119.3M")
  `.gp-cockpit-hero .gp-value { display: inline-block; text-align: right; }`,
  `.gp-cockpit-of { font-size: var(--type-s-size); color: var(--ink-3); }`,
  `.gp-cockpit-bar { font: inherit; font-family: ${num}; font-variant-numeric: var(--type-numerals); color: var(--ink-2); background: none; border: 0; padding: 0; cursor: pointer; text-decoration: underline dotted var(--ink-3); text-underline-offset: ${rem(3)}; }`,
  `.gp-cockpit-bar[data-changed] { text-decoration-style: solid; }`,
  `.gp-cockpit-bar:hover { color: var(--ink); }`,
  `.gp-cockpit-bar:focus-visible { ${focus} }`,
  `.gp-cockpit-stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); margin: auto 0 0; padding-top: ${rem(22)}; border-top: ${line}; }`,
  `.gp-cockpit-stat { display: flex; flex-direction: column; gap: ${rem(6)}; min-width: 0; padding: 0 ${rem(18)}; }`,
  `.gp-cockpit-stat:first-child { padding-left: 0; }`,
  `.gp-cockpit-stat + .gp-cockpit-stat { border-left: ${line}; }`,
  `.gp-cockpit-stat dt { ${label} }`,
  `.gp-cockpit-stat dd { margin: 0; font: 400 var(--type-l-size)/1.1 ${num}; font-variant-numeric: var(--type-numerals); color: var(--ink); }`,
  // Bridge
  `.gp-cockpit-axis { font-size: var(--type-xs-size); color: var(--ink-3); }`,
  // Your inputs
  `.gp-cockpit-all { display: inline-flex; align-items: center; gap: ${rem(8)}; height: ${rem(34)}; padding: 0 ${rem(14)}; border-radius: var(--radius-control); border: ${line}; background: var(--glass); color: var(--ink); font: inherit; font-size: var(--type-s-size); cursor: pointer; }`,
  `.gp-cockpit-all:hover { background: var(--glass-2); }`,
  `.gp-cockpit-all:focus-visible { ${focus} }`,
  `.gp-cockpit-all svg { width: ${rem(16)}; height: ${rem(16)}; }`,
  `.gp-cockpit-inputs { display: grid; grid-template-columns: repeat(var(--gp-hero-sliders, 2), minmax(0, 1.15fr)) repeat(var(--gp-hero-steppers, 3), minmax(0, 1fr)); gap: ${rem(22)}; align-items: end; }`,
  `.gp-cockpit-input { display: flex; flex-direction: column; gap: ${rem(10)}; min-width: 0; }`,
  `.gp-cockpit-input-label { font-size: var(--type-s-size); color: var(--ink-2); }`,
  `.gp-cockpit-input .gp-stepper { width: 100%; }`,
  `@media ${media.tablet} {`,
  `  .gp-cockpit-inputs { grid-template-columns: repeat(2, minmax(0, 1fr)); }`,
  `}`,
  `@media ${media.phone} {`,
  `  .gp-cockpit-inputs { grid-template-columns: minmax(0, 1fr); gap: ${rem(18)}; }`,
  `  .gp-cockpit-stats { grid-template-columns: minmax(0, 1fr); gap: ${rem(14)}; }`,
  `  .gp-cockpit-stat, .gp-cockpit-stat:first-child { padding: 0; }`,
  `  .gp-cockpit-stat + .gp-cockpit-stat { border-left: 0; }`,
  `  .gp-cockpit-all, .gp-cockpit-bar { min-height: ${TOUCH_TARGET}; }`,
  `}`,
].join('\n');

/** Injects the cockpit CSS once (React 19 hoists and de-duplicates `<style href precedence>`). */
export function CockpitStyles() {
  return (
    <style href="glidepath-cockpit" precedence="glidepath">
      {cockpitCss}
    </style>
  );
}
