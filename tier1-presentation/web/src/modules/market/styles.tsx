import { rem, TOUCH_TARGET } from '@glidepath/ui/shell';
import { media } from '@glidepath/ui/tokens';

/**
 * Market CSS (docs/ux/screens/market-dark-1440.jpg; prototype `.trace`, `.dial`, `.bars`),
 * token CSS vars only; metrics with no design token are rem (`rem()` from the ui shell). The
 * trace chain, dials, segmented control, steppers and glass panels bring their own CSS from
 * `@glidepath/ui`. EPS bar geometry is drawn by CSS from the positions set as custom properties.
 */
const line = `${rem(1)} solid var(--glass-line)`;
const focus = `outline: ${rem(2)} solid var(--accent); outline-offset: ${rem(2)};`;
const mono = 'var(--font-mono), ui-monospace, monospace';
const num = 'var(--font-num), var(--font-ui), system-ui, sans-serif';
const eyebrow = `font: var(--type-xs-weight) var(--type-xs-size)/1.2 ${mono}; letter-spacing: var(--type-xs-tracking); text-transform: uppercase; color: var(--ink-3);`;
const button = `display: inline-flex; align-items: center; gap: ${rem(8)}; height: ${rem(34)}; padding: 0 ${rem(14)}; border-radius: var(--radius-control); border: ${line}; background: var(--glass); color: var(--ink); font: inherit; font-size: var(--type-s-size); cursor: pointer;`;

export const marketCss = [
  '/* web modules/market: generated from tokens in src/modules/market/styles.tsx */',
  `.gp-module.gp-market { min-width: 0; padding: 0; }`,
  `.gp-market-formulas, .gp-market-reset, .gp-market-more-toggle { ${button} }`,
  `.gp-market-formulas:hover, .gp-market-reset:hover, .gp-market-more-toggle:hover { background: var(--glass-2); }`,
  `.gp-market-formulas:focus-visible, .gp-market-reset:focus-visible, .gp-market-more-toggle:focus-visible { ${focus} }`,
  `.gp-market-formulas svg, .gp-market-reset svg { width: ${rem(16)}; height: ${rem(16)}; }`,
  `.gp-market-unit { color: var(--ink-3); font-size: var(--type-s-size); }`,
  // Drivers
  `.gp-market-dials { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: ${rem(18)} ${rem(12)}; }`,
  `.gp-market-dial { display: flex; flex-direction: column; align-items: center; gap: ${rem(8)}; min-width: 0; }`,
  `.gp-market-group { max-width: 100%; height: ${rem(28)}; border-radius: var(--radius-control); border: ${line}; background: var(--glass); color: var(--ink-2); font: inherit; font-size: var(--type-xs-size); }`,
  `.gp-market-group:focus-visible { ${focus} }`,
  `.gp-market-valuation { display: flex; align-items: center; gap: ${rem(14)}; flex-wrap: wrap; margin-top: ${rem(20)}; padding-top: ${rem(18)}; border-top: ${line}; }`,
  `.gp-market-valuation-label { margin-right: auto; color: var(--ink); }`,
  `.gp-market-valuation-value { font: 400 var(--type-l-size)/1.1 ${num}; font-variant-numeric: var(--type-numerals); color: var(--ink); }`,
  // Adjusted EPS
  // the tick gutter holds a negative label (−$0.5) on one line; grid lines start after it
  `.gp-market-eps { position: relative; height: ${rem(300)}; padding-left: ${rem(48)}; }`,
  `.gp-market-eps-grid { list-style: none; margin: 0; padding: 0; position: absolute; inset: 0 0 ${rem(26)} 0; }`,
  `.gp-market-eps-grid li { position: absolute; left: ${rem(48)}; right: 0; top: var(--top); border-top: ${line}; }`,
  `.gp-market-eps-grid li span { position: absolute; left: -${rem(48)}; top: -${rem(8)}; width: ${rem(42)}; text-align: right; white-space: nowrap; ${eyebrow} letter-spacing: normal; }`,
  `.gp-market-eps-bars { list-style: none; margin: 0; padding: 0; position: absolute; inset: 0 0 0 ${rem(48)}; display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: ${rem(14)}; }`,
  `.gp-market-eps-bars > li { position: relative; min-width: 0; }`,
  `.gp-market-eps-bar { position: absolute; left: 18%; right: 18%; top: calc((100% - ${rem(26)}) * var(--bar-top) / 100); height: calc((100% - ${rem(26)}) * (var(--bar-end) - var(--bar-top)) / 100); background: var(--accent-2); opacity: .55; border-radius: var(--radius-small) var(--radius-small) 0 0; transition: top var(--motion-value) var(--motion-ease), height var(--motion-value) var(--motion-ease); }`,
  `.gp-market-eps-bars > li[data-negative] .gp-market-eps-bar { border-radius: 0 0 var(--radius-small) var(--radius-small); }`,
  `.gp-market-eps-bars > li[data-it] .gp-market-eps-bar { background: var(--accent); opacity: 1; }`,
  `.gp-market-eps-value { position: absolute; left: 0; right: 0; text-align: center; top: calc((100% - ${rem(26)}) * var(--bar-top) / 100 - ${rem(24)}); font-size: var(--type-s-size); color: var(--ink); font-variant-numeric: var(--type-numerals); }`,
  `.gp-market-eps-bars > li[data-negative] .gp-market-eps-value { top: calc((100% - ${rem(26)}) * var(--bar-end) / 100 + ${rem(4)}); }`,
  `.gp-market-eps-cat { position: absolute; left: 0; right: 0; bottom: 0; text-align: center; ${eyebrow} }`,
  // Share price
  `.gp-market-price { margin: 0; display: flex; flex-direction: column; gap: ${rem(14)}; }`,
  `.gp-market-price dt { color: var(--ink-2); font-size: var(--type-m-size); }`,
  `.gp-market-price dd { margin: ${rem(4)} 0 0; font: 400 var(--type-xl-size)/1.05 ${num}; font-variant-numeric: var(--type-numerals); color: var(--ink); }`,
  `.gp-market-price [data-with-it] dd { color: var(--accent); }`,
  `.gp-market-price .gp-value, .gp-market-price .gp-ed { font: inherit; letter-spacing: inherit; color: inherit; }`,
  `.gp-market-fuel { margin: ${rem(20)} 0 0; padding-top: ${rem(18)}; border-top: ${line}; color: var(--ink-2); line-height: 1.5; }`,
  `.gp-market-fuel strong { color: var(--ink); font-weight: 600; }`,
  `.gp-market-note { margin: 0; color: var(--ink-3); font-size: var(--type-s-size); max-width: ${rem(640)}; }`,
  // More drivers
  `.gp-market-group-section { margin-top: ${rem(18)}; }`,
  `.gp-market-group-title { margin: 0 0 ${rem(8)}; ${eyebrow} }`,
  `.gp-market-group-title span { margin-left: ${rem(6)}; color: var(--ink-2); }`,
  `.gp-market-drivers { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }`,
  `.gp-market-driver { display: grid; grid-template-columns: minmax(0, 20rem) minmax(0, 1fr); gap: ${rem(12)}; align-items: center; padding: ${rem(8)} 0; border-bottom: ${line}; }`,
  `.gp-market-driver:last-child { border-bottom: 0; }`,
  `.gp-market-driver-name { display: flex; flex-direction: column; gap: ${rem(2)}; color: var(--ink); font-size: var(--type-m-size); }`,
  `.gp-market-driver-name code { color: var(--ink-3); font-family: ${mono}; font-size: var(--type-xs-size); }`,
  `.gp-market-driver-cells { display: flex; flex-wrap: wrap; gap: ${rem(10)} ${rem(16)}; }`,
  `.gp-market-cell { display: flex; flex-direction: column; gap: ${rem(4)}; min-width: ${rem(120)}; }`,
  `.gp-market-cell-member { color: var(--ink-3); font-size: var(--type-xs-size); }`,
  `.gp-market-cell-static { color: var(--ink-2); }`,
  `@media ${media.tablet} {`,
  `  .gp-market-driver { grid-template-columns: minmax(0, 1fr); }`,
  `}`,
  `@media ${media.phone} {`,
  `  .gp-market-dials { grid-template-columns: repeat(2, minmax(0, 1fr)); }`,
  `  .gp-market-formulas, .gp-market-reset, .gp-market-more-toggle { min-height: ${TOUCH_TARGET}; }`,
  `}`,
  `@media (prefers-reduced-motion: reduce) { .gp-market-eps-bar { transition: none; } }`,
].join('\n');

/** Injects the market CSS once (React 19 hoists and de-duplicates `<style href precedence>`). */
export function MarketStyles() {
  return (
    <style href="glidepath-market" precedence="glidepath">
      {marketCss}
    </style>
  );
}
