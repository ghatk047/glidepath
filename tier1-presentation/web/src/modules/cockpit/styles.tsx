import { rem, TOUCH_TARGET } from '@glidepath/ui/shell';
import { DESKTOP_QUERY, SHORT_DESKTOP_QUERY } from '@glidepath/ui/glass';
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
  // Tiles (MOD-02): shared bits
  `.gp-cockpit-col { display: flex; flex-direction: column; gap: ${rem(6)}; min-width: 0; }`,
  `.gp-cockpit-spread { display: flex; align-items: flex-start; justify-content: space-between; gap: ${rem(12)}; }`,
  `.gp-cockpit-big { font: 300 var(--type-xl-size)/1 ${num}; letter-spacing: var(--type-xl-tracking); font-variant-numeric: var(--type-numerals); color: var(--ink); }`,
  `.gp-cockpit-big .gp-value { font: inherit; letter-spacing: inherit; color: inherit; }`,
  `.gp-cockpit-faint { color: var(--ink-3); }`,
  `.gp-cockpit-mid { font: 400 var(--type-l-size)/1.1 ${num}; font-variant-numeric: var(--type-numerals); color: var(--ink); }`,
  `.gp-cockpit-before { color: var(--ink-3); }`,
  `.gp-cockpit-arrow { color: var(--ink-3); }`,
  `.gp-cockpit-error { font-size: var(--type-xs-size); color: var(--neg); }`,
  `.gp-cockpit-go, .gp-cockpit-vp-name button { appearance: none; background: none; border: 0; padding: 0; font: inherit; color: inherit; cursor: pointer; }`,
  `.gp-cockpit-go { display: inline-flex; color: var(--ink-3); }`,
  `.gp-cockpit-go svg { width: ${rem(16)}; height: ${rem(16)}; }`,
  `.gp-cockpit-go:hover { color: var(--ink); }`,
  `.gp-cockpit-go:focus-visible, .gp-cockpit-vp-name button:focus-visible, .gp-cockpit-primary:focus-visible { ${focus} }`,
  // VP rings
  `.gp-cockpit-vp { display: flex; flex-direction: column; gap: ${rem(18)}; }`,
  `.gp-cockpit-vp-head { display: flex; align-items: baseline; justify-content: space-between; gap: ${rem(8)}; }`,
  `.gp-cockpit-vp-name { margin: 0; font: var(--type-m-weight) var(--type-m-size)/1.2 var(--font-ui), system-ui, sans-serif; color: var(--ink); min-width: 0; }`,
  `.gp-cockpit-vp-name button { display: inline-flex; align-items: center; gap: ${rem(8)}; }`,
  `.gp-cockpit-vp-name button:hover { color: var(--accent); }`,
  `.gp-cockpit-swatch { display: inline-block; width: ${rem(10)}; height: ${rem(10)}; border-radius: var(--radius-small); background: var(--gp-vp-colour, var(--accent)); }`,
  `.gp-cockpit-vp-outlay { font-size: var(--type-xs-size); color: var(--ink-3); font-variant-numeric: var(--type-numerals); }`,
  `.gp-cockpit-vp-num { display: flex; flex-direction: column; gap: ${rem(6)}; min-width: 0; }`,
  `.gp-cockpit-vp-num .gp-cockpit-of .gp-value { color: inherit; }`,
  // Shareholder view
  `.gp-cockpit-share-big { display: flex; flex-wrap: wrap; align-items: flex-end; gap: ${rem(28)}; margin: 0; }`,
  `.gp-cockpit-share-big div { display: flex; flex-direction: column; gap: ${rem(6)}; }`,
  `.gp-cockpit-share-big dt { font-size: var(--type-s-size); color: var(--ink-3); }`,
  `.gp-cockpit-share-big dd { margin: 0; font: 300 var(--type-xl-size)/1 ${num}; letter-spacing: var(--type-xl-tracking); font-variant-numeric: var(--type-numerals); color: var(--ink); }`,
  `.gp-cockpit-share-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); margin-top: ${rem(22)}; padding-top: ${rem(18)}; }`,
  `.gp-cockpit-share-stats dd.gp-cockpit-span { font-size: var(--type-s-size); }`,
  `.gp-cockpit-fuel { margin: ${rem(14)} 0 0; font-size: var(--type-s-size); color: var(--ink-3); }`,
  `.gp-cockpit-strong { font-weight: 600; color: var(--ink-2); }`,
  // Odds
  `.gp-cockpit-odds-body { display: flex; flex-direction: column; gap: ${rem(14)}; }`,
  `.gp-cockpit-hist { width: 100%; height: auto; }`,
  // Fastest path
  `.gp-cockpit-path { gap: ${rem(14)}; }`,
  `.gp-cockpit-moves { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }`,
  `.gp-cockpit-move { display: grid; grid-template-columns: ${rem(22)} minmax(0, 1fr) auto; align-items: baseline; gap: ${rem(10)}; padding: ${rem(7)} ${rem(4)}; font-size: var(--type-s-size); color: var(--ink); }`,
  `.gp-cockpit-rank { font: var(--type-xs-weight) var(--type-xs-size)/1 ${mono}; color: var(--ink-3); }`,
  `.gp-cockpit-move-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }`,
  `.gp-cockpit-move-value { font-family: ${num}; font-variant-numeric: var(--type-numerals); color: var(--ink-2); }`,
  `.gp-cockpit-primary { display: inline-flex; align-items: center; gap: ${rem(8)}; height: ${rem(40)}; padding: 0 ${rem(18)}; border: 0; border-radius: var(--radius-control); background: var(--accent); color: var(--accent-ink); font: inherit; font-weight: 600; cursor: pointer; box-shadow: 0 0 ${rem(18)} var(--accent-glow); }`,
  `.gp-cockpit-primary svg { width: ${rem(16)}; height: ${rem(16)}; }`,
  `@media ${media.tablet} {`,
  `  .gp-cockpit-inputs { grid-template-columns: repeat(2, minmax(0, 1fr)); }`,
  `}`,
  `@media ${media.phone} {`,
  `  .gp-cockpit-inputs { grid-template-columns: minmax(0, 1fr); gap: ${rem(18)}; }`,
  `  .gp-cockpit-stats { grid-template-columns: minmax(0, 1fr); gap: ${rem(14)}; }`,
  `  .gp-cockpit-stat, .gp-cockpit-stat:first-child { padding: 0; }`,
  `  .gp-cockpit-stat + .gp-cockpit-stat { border-left: 0; }`,
  `  .gp-cockpit-all, .gp-cockpit-bar, .gp-cockpit-primary, .gp-cockpit-go, .gp-cockpit-vp-name button { min-height: ${TOUCH_TARGET}; }`,
  `  .gp-cockpit-share-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }`,
  `}`,
  // desktop (UIX-01): the Cockpit fits the viewport with no page scroll. Three rows: Net savings,
  // the outlay bridge and Fastest path; the four VP rings; Your inputs, Shareholder view and Odds.
  // The bridge cell (bridge + inputs) dissolves so its two panels take their own places, every
  // panel body is a flex column, and the charts (gauge, bridge, histogram) scale to their panel.
  `@media ${DESKTOP_QUERY} {`,
  `  .gp-cockpit .gp-grid { grid-template-rows: minmax(0, 1fr) auto auto; }`,
  `  .gp-cockpit .gp-grid > .gp-stack { display: contents; }`,
  `  .gp-cockpit [data-testid="cockpit-net"] { grid-column: 1 / 5; grid-row: 1; }`,
  `  .gp-cockpit [data-testid="cockpit-bridge"] { grid-column: 5 / 10; grid-row: 1; }`,
  `  .gp-cockpit [data-testid="cockpit-path"] { grid-column: 10 / 13; grid-row: 1; }`,
  `  .gp-cockpit [data-testid="cockpit-vp"] { grid-row: 2; }`,
  `  .gp-cockpit [data-testid="cockpit-inputs"] { grid-column: 1 / 6; grid-row: 3; }`,
  `  .gp-cockpit [data-testid="cockpit-shareholder"] { grid-column: 6 / 10; grid-row: 3; }`,
  `  .gp-cockpit [data-testid="cockpit-odds"] { grid-column: 10 / 13; grid-row: 3; }`,
  `  .gp-cockpit .gp-grid .gp-panel { min-height: 0; display: flex; flex-direction: column; }`,
  `  .gp-cockpit .gp-grid .gp-panel > .gp-body { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }`,
  // the gauge is sized from the panel's height (a size container): the arc, hero and stats fit
  `  .gp-cockpit-net { container-type: size; }`,
  `  .gp-cockpit-net .gp-gauge { width: min(100%, calc((100cqh - ${rem(160)}) * 1.13)); }`,
  `  .gp-cockpit-net .gp-gauge-hero { font-size: clamp(${rem(28)}, calc((100cqh - ${rem(160)}) * 0.16), ${rem(56)}); }`,
  `  .gp-cockpit .gp-bridge { flex: 1 1 0; min-height: 0; width: 100%; height: 100%; }`,
  `  .gp-cockpit-odds-body { flex: 1 1 auto; min-height: 0; }`,
  `  .gp-cockpit-hist { flex: 1 1 0; min-height: 0; height: 100%; }`,
  // inputs: the two sliders share the first row, the steppers the second; the number field gives way
  // instead of the + spilling out
  `  .gp-cockpit-inputs { grid-template-columns: repeat(6, minmax(0, 1fr)); gap: ${rem(14)}; }`,
  `  .gp-cockpit-input { grid-column: span 3; }`,
  `  .gp-cockpit-input:has(.gp-stepper) { grid-column: span 2; }`,
  `  .gp-cockpit-input .gp-stepper input { flex: 1 1 auto; width: 0; min-width: 0; }`,
  `  .gp-cockpit-input .gp-stepper button { flex: none; width: ${rem(28)}; }`,
  `}`,
  // short desktop (1280x720): the first row takes more of the height, the Net savings stats stand
  // beside the gauge instead of under it, and the gauge's labels keep a readable size
  `@media ${SHORT_DESKTOP_QUERY} {`,
  `  .gp-cockpit .gp-grid { grid-template-rows: minmax(0, 1.5fr) auto minmax(0, 1fr); }`,
  `  .gp-cockpit .gp-grid .gp-cockpit-net > .gp-body { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: ${rem(12)}; }`,
  `  .gp-cockpit-net .gp-gauge { width: min(100%, calc((100cqh - ${rem(76)}) * 1.13)); }`,
  `  .gp-cockpit-net .gp-gauge-hero { font-size: clamp(${rem(28)}, calc((100cqh - ${rem(76)}) * 0.15), ${rem(40)}); }`,
  `  .gp-cockpit-net .gp-gauge-svg text { font-size: calc(var(--type-xs-size) * 1.45); }`,
  `  .gp-cockpit-net .gp-cockpit-stats { grid-template-columns: minmax(0, 1fr); gap: ${rem(14)}; margin: 0; padding: 0 0 0 ${rem(12)}; border-top: 0; border-left: ${line}; }`,
  `  .gp-cockpit-net .gp-cockpit-stat, .gp-cockpit-net .gp-cockpit-stat:first-child { padding: 0; border-left: 0; }`,
  `  .gp-cockpit-inputs { row-gap: ${rem(8)}; }`,
  `  .gp-cockpit-input { gap: ${rem(6)}; }`,
  `  .gp-cockpit-vp { gap: ${rem(8)}; }`,
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
