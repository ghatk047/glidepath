import { DESKTOP_QUERY } from '@glidepath/ui/glass';
import { rem, TOUCH_TARGET } from '@glidepath/ui/shell';
import { media } from '@glidepath/ui/tokens';

/**
 * Path CSS (prototype `vSolver`: `.radio-card`, `.li`, `.move`, `.btn`; solver-*-1440 renders),
 * written with token CSS vars. Metrics with no design token are rem (`rem()` from the ui shell),
 * so this file carries no hex and no raw px. Radio cards, toggles, move rows, chips and glass
 * panels bring their own CSS from `@glidepath/ui`.
 */

const line = `${rem(1)} solid var(--glass-line)`;
const hair = `${rem(1)} solid var(--hair)`;
const focus = `outline: ${rem(2)} solid var(--accent); outline-offset: ${rem(2)};`;
const mono = 'var(--font-mono), ui-monospace, monospace';
const num = 'var(--font-num), var(--font-ui), system-ui, sans-serif';
const label = `font: var(--type-xs-weight) var(--type-xs-size)/1.2 ${mono}; letter-spacing: var(--type-xs-tracking); text-transform: uppercase; color: var(--ink-3);`;
const figure = `font-family: ${num}; font-variant-numeric: var(--type-numerals); color: var(--ink);`;

export const pathCss = [
  '/* web modules/path: generated from tokens in src/modules/path/styles.ts */',
  `.gp-module.gp-path { min-width: 0; padding: 0; }`,
  `.gp-path-eyebrow { ${label} margin: ${rem(22)} 0 ${rem(8)}; }`,
  `.gp-path-faint { font-size: var(--type-xs-size); color: var(--ink-3); }`,
  `.gp-path-icon { width: ${rem(16)}; height: ${rem(16)}; flex: none; stroke-width: 1.8; }`,
  `.gp-path-lock { width: ${rem(13)}; height: ${rem(13)}; color: var(--ink-3); vertical-align: -0.1em; }`,
  `.gp-path-sr { position: absolute; width: ${rem(1)}; height: ${rem(1)}; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }`,
  // Goal
  `.gp-path-goal-row { display: flex; align-items: flex-end; gap: ${rem(10)}; flex-wrap: wrap; }`,
  `.gp-path-goal-value { ${figure} font-size: var(--type-xl-size); font-weight: var(--type-xl-weight); letter-spacing: var(--type-xl-tracking); line-height: 1; background: none; border: 0; padding: 0; cursor: pointer; text-decoration: underline dotted var(--ink-3); text-decoration-thickness: ${rem(1)}; text-underline-offset: ${rem(6)}; }`,
  `.gp-path-goal-value[data-changed] { text-decoration-style: solid; }`,
  `.gp-path-goal-value:focus-visible { ${focus} }`,
  `.gp-path-goal-value:disabled { cursor: default; }`,
  `.gp-path-goal-note { font-size: var(--type-s-size); color: var(--ink-3); padding-bottom: ${rem(4)}; }`,
  `.gp-path-goal [role="radiogroup"] { display: flex; flex-direction: column; gap: ${rem(2)}; }`,
  `.gp-path-hold { list-style: none; margin: 0; padding: 0; }`,
  `.gp-path-hold-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: ${rem(12)}; padding: ${rem(11)} ${rem(12)}; border-bottom: ${hair}; font-size: var(--type-s-size); color: var(--ink); }`,
  `.gp-path-hold-row:last-child { border-bottom: 0; }`,
  `.gp-path-hold-label { min-width: 0; }`,
  `.gp-path-hold-input { ${figure} font-size: inherit; background: transparent; border: 0; border-bottom: ${rem(1)} dotted var(--ink-3); border-radius: 0; padding: 0; min-width: 2ch; max-width: 9ch; }`,
  `.gp-path-hold-input:focus-visible { ${focus} }`,
  `.gp-path-hold-input[aria-invalid="true"] { border-bottom-color: var(--neg); }`,
  // Actions (prototype .btn / .btn.primary)
  `.gp-path-actions { display: flex; flex-wrap: wrap; gap: ${rem(12)}; margin-top: ${rem(20)}; }`,
  `.gp-path-btn { display: inline-flex; align-items: center; gap: ${rem(8)}; min-height: ${rem(40)}; padding: 0 ${rem(18)}; border-radius: var(--radius-control); border: ${line}; background: var(--glass-2); color: var(--ink); font: inherit; font-size: var(--type-s-size); cursor: pointer; }`,
  `.gp-path-btn:hover { background: var(--glass-3); }`,
  `.gp-path-btn[data-primary] { background: var(--accent); color: var(--accent-ink); border-color: transparent; box-shadow: 0 ${rem(10)} ${rem(30)} ${rem(-12)} var(--accent-glow); }`,
  `.gp-path-btn[aria-pressed="true"] { background: var(--glass-3); border-color: var(--accent); }`,
  `.gp-path-btn:disabled { opacity: .55; cursor: default; }`,
  `.gp-path-btn:focus-visible { ${focus} }`,
  // Result
  `.gp-path-head { display: flex; flex-wrap: wrap; align-items: flex-end; gap: ${rem(34)}; }`,
  `.gp-path-hero-wrap { display: flex; flex-direction: column; align-items: flex-start; gap: ${rem(6)}; }`,
  `.gp-path-hero { ${figure} font-size: calc(var(--type-hero-size) * 0.75); font-weight: var(--type-hero-weight); letter-spacing: var(--type-hero-tracking); line-height: 1; }`,
  `.gp-path-hero-unit { font-size: 0.45em; color: var(--ink-2); margin-left: ${rem(2)}; }`,
  `.gp-path-stats { display: flex; flex-wrap: wrap; align-items: flex-end; column-gap: ${rem(30)}; row-gap: ${rem(14)}; margin: 0; }`,
  `.gp-path-stat { display: flex; flex-direction: column; gap: ${rem(4)}; min-width: 0; }`,
  `.gp-path-stat dt { ${label} }`,
  `.gp-path-stat dd { margin: 0; display: flex; flex-direction: column; gap: ${rem(4)}; }`,
  `.gp-path-stat-value { ${figure} font-size: var(--type-l-size); font-weight: var(--type-l-weight); line-height: 1.1; }`,
  `.gp-path-stat-note { font-size: var(--type-xs-size); color: var(--ink-3); }`,
  `.gp-path-lambda { margin: ${rem(16)} 0 0; font-size: var(--type-s-size); color: var(--ink-2); }`,
  `.gp-path-moves-head { display: flex; justify-content: space-between; align-items: baseline; gap: ${rem(12)}; margin: ${rem(24)} 0 ${rem(6)}; }`,
  `.gp-path-moves-head .gp-path-eyebrow { margin: 0; }`,
  `.gp-path-moves { list-style: none; margin: 0; padding: 0; }`,
  `.gp-path-moves > li { animation: gp-path-land var(--motion-value) var(--motion-ease) both; }`,
  `@keyframes gp-path-land { from { opacity: 0; transform: translateY(${rem(6)}); } to { opacity: 1; transform: none; } }`,
  `.gp-path-problem { margin: ${rem(10)} 0 0; font-size: var(--type-s-size); color: var(--neg); }`,
  `.gp-path-compare { width: 100%; margin-top: ${rem(18)}; border-collapse: collapse; font-size: var(--type-s-size); }`,
  `.gp-path-compare th, .gp-path-compare td { padding: ${rem(8)} ${rem(10)}; border-bottom: ${hair}; text-align: right; }`,
  `.gp-path-compare th[scope="row"], .gp-path-compare thead th:first-child { text-align: left; color: var(--ink-2); font-weight: 400; }`,
  `.gp-path-compare thead th { ${label} }`,
  `.gp-path-compare td { ${figure} }`,
  // Path II analysis panels (Savings vs risk, Odds, What moves net most)
  `.gp-path-chart-note { margin: ${rem(8)} 0 0; }`,
  // Savings vs risk scatter
  `.gp-path-scatter { width: 100%; height: auto; margin-top: ${rem(6)}; overflow: visible; }`,
  `.gp-path-scatter text { font: var(--type-xs-weight) ${rem(11)}/1 ${num}; fill: var(--ink-3); font-variant-numeric: var(--type-numerals); }`,
  `.gp-path-axis { stroke: var(--hair); stroke-width: ${rem(1)}; }`,
  `.gp-path-frontier { fill: none; stroke: var(--accent); stroke-width: ${rem(2)}; stroke-dasharray: ${rem(5)} ${rem(4)}; opacity: .55; }`,
  `.gp-path-bar-line { stroke: var(--ink-3); stroke-width: ${rem(1)}; stroke-dasharray: ${rem(4)} ${rem(3)}; }`,
  `.gp-path-bar-label { fill: var(--ink-2); }`,
  `.gp-path-dot { fill: var(--ink-3); stroke: var(--ground); stroke-width: ${rem(2)}; }`,
  `.gp-path-dot[data-path] { fill: var(--accent); }`,
  `.gp-path-dot-label { fill: var(--ink); }`,
  // Odds
  `.gp-path-odds { display: flex; flex-direction: column; gap: ${rem(10)}; }`,
  `.gp-path-odds-row { display: flex; flex-wrap: wrap; gap: ${rem(28)}; }`,
  `.gp-path-odds-col { display: flex; flex-direction: column; gap: ${rem(4)}; align-items: flex-start; }`,
  `.gp-path-odds-big { ${figure} font-size: var(--type-xl-size); font-weight: var(--type-xl-weight); letter-spacing: var(--type-xl-tracking); line-height: 1; }`,
  `.gp-path-hist, .gp-path-tornado-chart { width: 100%; height: auto; margin-top: ${rem(6)}; }`,
  `@media ${media.phone} {`,
  `  .gp-path-head, .gp-path-stats { gap: ${rem(18)}; }`,
  `  .gp-path-btn, .gp-path-goal-value { min-height: ${TOUCH_TARGET}; }`,
  `}`,
  // desktop (UIX-01): the goal panel's options and holds lose some air so the goal and the path
  // panel fit a 1280x720 screen above the analysis row
  `@media ${DESKTOP_QUERY} {`,
  `  .gp-path-goal .gp-radio-card { padding: ${rem(6)} ${rem(10)}; }`,
  `  .gp-path-hold-row { padding: ${rem(6)} ${rem(12)}; }`,
  `}`,
].join('\n');

/** Injects the Path CSS once (React 19 hoists and de-duplicates `<style href precedence>`). */
export function PathStyles() {
  return (
    <style href="glidepath-path" precedence="glidepath">
      {pathCss}
    </style>
  );
}
