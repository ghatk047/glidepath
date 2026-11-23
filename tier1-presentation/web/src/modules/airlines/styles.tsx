import { rem, TOUCH_TARGET } from '@glidepath/ui/shell';
import { media } from '@glidepath/ui/tokens';

/**
 * Airlines CSS (docs/ux/screens/airlines-dark-1440.jpg), token CSS vars only; metrics with no
 * token are rem. Panels, chips and the prompt bar bring their own CSS from `@glidepath/ui`.
 */
const line = `${rem(1)} solid var(--glass-line)`;
const focus = `outline: ${rem(2)} solid var(--accent); outline-offset: ${rem(2)};`;
const mono = 'var(--font-mono), ui-monospace, monospace';
const eyebrow = `font: var(--type-xs-weight) var(--type-xs-size)/1.2 ${mono}; letter-spacing: var(--type-xs-tracking); text-transform: uppercase; color: var(--ink-3);`;
const button = `display: inline-flex; align-items: center; justify-content: center; gap: ${rem(8)}; min-height: ${rem(40)}; padding: 0 ${rem(14)}; border-radius: var(--radius-control); border: ${line}; background: var(--glass-2); color: var(--ink); font: inherit; font-size: var(--type-m-size); cursor: pointer;`;

export const airlinesCss = [
  '/* web modules/airlines: generated from tokens in src/modules/airlines/styles.tsx */',
  `.gp-module.gp-airlines { min-width: 0; padding: 0; }`,
  `.gp-airlines-cell { display: flex; }`,
  `.gp-airlines-cell > .gp-airlines-tile { flex: 1; }`,
  `.gp-airlines-tile { display: flex; flex-direction: column; gap: ${rem(10)}; min-height: ${rem(250)}; }`,
  `.gp-airlines-tile[data-current] { border-color: var(--accent); }`,
  `.gp-airlines-add { border-style: dashed; }`,
  `.gp-airlines-top { display: flex; align-items: flex-start; justify-content: space-between; gap: ${rem(8)}; }`,
  `.gp-airlines-mono, .gp-airlines-plus { display: inline-flex; align-items: center; justify-content: center; width: ${rem(56)}; height: ${rem(56)}; border-radius: var(--radius-control); border: ${line}; background: var(--glass-2); color: var(--ink); font: 600 var(--type-l-size)/1 ${mono}; letter-spacing: .04em; }`,
  `.gp-airlines-plus { cursor: pointer; font-size: var(--type-xl-size); }`,
  `.gp-airlines-plus:focus-visible, .gp-airlines-action:focus-visible, .gp-airlines-primary:focus-visible { ${focus} }`,
  `.gp-airlines-mono-sm { font-family: ${mono}; color: var(--ink-2); }`,
  `.gp-airlines-tag[data-kind="live"] { color: var(--pos); }`,
  `.gp-airlines-tag[data-kind="draft"] { color: var(--warn); }`,
  `.gp-airlines-name { margin: ${rem(6)} 0 0; font-size: var(--type-l-size); font-weight: 500; color: var(--ink); }`,
  `.gp-airlines-sub { margin: 0; color: var(--ink-3); font-size: var(--type-m-size); }`,
  `.gp-airlines-facts { margin: auto 0 0; color: var(--ink-2); font-variant-numeric: var(--type-numerals); }`,
  `.gp-airlines-progress { width: 100%; height: ${rem(6)}; margin-top: auto; accent-color: var(--accent); }`,
  `.gp-airlines-action, .gp-airlines-primary { ${button} }`,
  `.gp-airlines-action:hover { background: var(--glass-3); }`,
  `.gp-airlines-primary { background: var(--accent); color: var(--bg); border-color: transparent; font-weight: 600; }`,
  `.gp-airlines-primary:disabled { opacity: .5; cursor: default; }`,
  `.gp-airlines-row { display: flex; flex-wrap: wrap; align-items: center; gap: ${rem(10)}; margin-top: ${rem(12)}; }`,
  `.gp-airlines-steps { list-style: none; margin: ${rem(18)} 0 0; padding: 0; display: flex; flex-wrap: wrap; gap: ${rem(8)}; }`,
  `.gp-airlines-steps li { padding: ${rem(6)} ${rem(12)}; border-radius: var(--radius-pill); border: ${line}; color: var(--ink-2); font-size: var(--type-s-size); }`,
  `.gp-airlines-steps li[data-state="active"] { color: var(--accent); border-color: var(--accent); }`,
  `.gp-airlines-steps li[data-state="done"] { color: var(--ink); }`,
  `.gp-airlines-job { display: flex; flex-direction: column; gap: ${rem(6)}; margin-top: ${rem(12)}; color: var(--ink-2); font-size: var(--type-s-size); }`,
  `.gp-airlines-job progress { width: 100%; height: ${rem(4)}; accent-color: var(--accent); }`,
  `.gp-airlines-estimate { margin-top: ${rem(12)}; padding: ${rem(12)}; border-radius: var(--radius-control); border: ${line}; color: var(--ink-2); font-size: var(--type-s-size); }`,
  `.gp-airlines-estimate p { margin: 0 0 ${rem(4)}; }`,
  `.gp-airlines-error { margin: ${rem(10)} 0 0; color: var(--neg); font-size: var(--type-s-size); }`,
  `.gp-airlines-applied { margin: ${rem(10)} 0 0; color: var(--pos); }`,
  `.gp-airlines-review { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: ${rem(14)}; margin-top: ${rem(16)}; padding-top: ${rem(14)}; border-top: ${line}; }`,
  `.gp-airlines-review > .gp-airlines-row, .gp-airlines-review > p { grid-column: 1 / -1; }`,
  `.gp-airlines-block { min-width: 0; font-size: var(--type-s-size); color: var(--ink-2); }`,
  `.gp-airlines-block h3 { margin: 0 0 ${rem(6)}; ${eyebrow} }`,
  `.gp-airlines-block ul { margin: 0; padding-left: ${rem(16)}; }`,
  `.gp-airlines-block table { width: 100%; border-collapse: collapse; }`,
  `.gp-airlines-block th, .gp-airlines-block td { text-align: left; padding: ${rem(3)} ${rem(6)} ${rem(3)} 0; font-weight: 400; }`,
  `.gp-airlines-block [data-ok="false"] { color: var(--neg); }`,
  `.gp-airlines-block [data-unsourced] { color: var(--warn); }`,
  `.gp-airlines-sections { display: block; color: var(--ink-3); }`,
  `.gp-airlines-scopes { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: ${rem(16)}; margin: ${rem(22)} 0 0; padding-top: ${rem(16)}; border-top: ${line}; }`,
  `.gp-airlines-scopes dt { ${eyebrow} }`,
  `.gp-airlines-scopes dd { margin: ${rem(6)} 0 0; color: var(--ink); font-size: var(--type-m-size); }`,
  `.gp-airlines-checklist { list-style: none; margin: 0; padding: 0; }`,
  `.gp-airlines-checklist li { display: grid; grid-template-columns: ${rem(24)} 1fr auto; align-items: center; gap: ${rem(12)}; padding: ${rem(10)} 0; border-bottom: ${line}; color: var(--ink); }`,
  `.gp-airlines-check { display: inline-flex; align-items: center; justify-content: center; width: ${rem(24)}; height: ${rem(24)}; border-radius: var(--radius-pill); border: ${line}; font-size: var(--type-xs-size); }`,
  `.gp-airlines-checklist li[data-state="done"] .gp-airlines-check { background: var(--pos); color: var(--bg); border-color: transparent; }`,
  `.gp-airlines-checklist li[data-state="review"] .gp-airlines-check { border-color: var(--accent); color: var(--accent); }`,
  `.gp-airlines-check-state { color: var(--ink-3); font-size: var(--type-s-size); }`,
  `.gp-airlines-note { margin: 0; color: var(--ink-3); font-size: var(--type-s-size); max-width: ${rem(640)}; }`,
  `@media ${media.tablet} {`,
  `  .gp-airlines-review { grid-template-columns: minmax(0, 1fr); }`,
  `}`,
  `@media ${media.phone} {`,
  `  .gp-airlines-scopes { grid-template-columns: minmax(0, 1fr); }`,
  `  .gp-airlines-action, .gp-airlines-primary, .gp-airlines-plus { min-height: ${TOUCH_TARGET}; }`,
  `}`,
].join('\n');

/** Injects the airlines CSS once (React 19 hoists and de-duplicates `<style href precedence>`). */
export function AirlinesStyles() {
  return (
    <style href="glidepath-airlines" precedence="glidepath">
      {airlinesCss}
    </style>
  );
}
