import { SHORT_DESKTOP_QUERY } from '@glidepath/ui/glass';
import { rem } from '@glidepath/ui/shell';

/**
 * Plan screen CSS (SRC-18), token CSS vars only; metrics with no token are rem. The screen reuses the Sourcing
 * grid, rows, tiles, tags and parameter strip (`sourcingCss`, `.gp-src-*`); these are the Plan-only parts. Bar
 * geometry is CSS `calc()` over the values tier 2 sent (custom properties): tier 1 does no arithmetic on them.
 */
const mono = 'var(--font-mono), ui-monospace, monospace';
const num = 'var(--font-num), var(--font-ui), sans-serif';
const line = `${rem(1)} solid var(--glass-line)`;
const focus = `outline: ${rem(2)} solid var(--accent); outline-offset: ${rem(2)};`;
const ease = 'var(--motion-value) var(--motion-ease)';
/** |x| and a share of a scale, as CSS (no tier-1 arithmetic). */
const abs = (x: string) => `max(${x}, calc(${x} * -1))`;
const share = (x: string, of: string) => `clamp(0%, calc(${x} / max(${of}, 0.000001) * 100%), 100%)`;

export const planCss = [
  '/* web modules/plan: generated from tokens in src/modules/plan/styles.ts */',
  `.gp-plan-error { display: flex; align-items: center; justify-content: space-between; gap: ${rem(8)}; }`,
  // breakeven, business case and wave rows
  `.gp-plan-be { grid-template-columns: minmax(0, 1fr) ${rem(52)} ${rem(72)} ${rem(80)} ${rem(112)}; }`,
  `.gp-plan-bc { grid-template-columns: minmax(0, 1fr) ${rem(54)} ${rem(54)} ${rem(58)} ${rem(46)} ${rem(46)} ${rem(46)}; }`,
  `.gp-plan-wmove { grid-template-columns: minmax(0, 1fr) ${rem(80)} ${rem(28)}; }`,
  // stress: shock chips and the diverging-bar table
  `.gp-plan-chips { display: flex; flex-wrap: wrap; gap: ${rem(4)}; margin: 0; padding: 0; list-style: none; }`,
  `.gp-plan-chip { height: ${rem(20)}; padding: 0 ${rem(8)}; border-radius: var(--radius-pill); border: ${line}; background: var(--glass-2); color: var(--ink-3); font: 500 var(--type-xs-size)/1 var(--font-ui), sans-serif; cursor: pointer; }`,
  `.gp-plan-chip[aria-pressed="true"] { color: var(--ink); border-color: var(--accent); background: var(--accent-glow); }`,
  `.gp-plan-chip:disabled { cursor: default; opacity: .6; }`,
  `.gp-plan-chip:focus-visible { ${focus} }`,
  `.gp-plan-stress { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: var(--type-s-size); color: var(--ink-2); }`,
  `.gp-plan-stress th, .gp-plan-stress td { padding: ${rem(4)} ${rem(4)}; border-bottom: ${line}; text-align: left; font-weight: 400; }`,
  `.gp-plan-stress thead th { color: var(--ink-3); font: var(--type-xs-weight) var(--type-xs-size)/1.2 ${mono}; letter-spacing: var(--type-xs-tracking); text-transform: uppercase; }`,
  `.gp-plan-stress thead th:first-child { width: 28%; }`,
  `.gp-plan-stress thead th.gp-plan-scale-col { width: ${rem(84)}; }`,
  `.gp-plan-scale .gp-stepper { height: ${rem(22)}; }`,
  `.gp-plan-scale .gp-stepper button { width: ${rem(18)}; height: ${rem(20)}; font-size: var(--type-xs-size); }`,
  `.gp-plan-scale .gp-stepper input { width: ${rem(40)}; font-size: var(--type-xs-size); }`,
  `.gp-plan-stress tr:last-child > * { border-bottom: 0; }`,
  `.gp-plan-div { --s: max(var(--hi), calc(var(--lo) * -1), 0.000001); position: relative; display: grid; grid-template-columns: minmax(0, 1fr); gap: ${rem(2)}; }`,
  `.gp-plan-div::before { content: ''; height: ${rem(8)}; border-radius: var(--radius-pill); background: var(--track); grid-area: 1 / 1; }`,
  `.gp-plan-div > i { grid-area: 1 / 1; height: ${rem(8)}; border-radius: var(--radius-pill); background: var(--ink-3); width: clamp(0%, calc(${abs('var(--d)')} / var(--s) * 50%), 50%); margin-left: 50%; transition: width ${ease}, margin ${ease}; }`,
  `.gp-plan-div[data-sign="neg"] > i { background: var(--neg); margin-left: calc(50% - clamp(0%, calc(${abs('var(--d)')} / var(--s) * 50%), 50%)); }`,
  `.gp-plan-div[data-sign="pos"] > i { background: var(--pos); }`,
  `.gp-plan-div > b { font: 500 var(--type-s-size)/1.2 ${num}; font-variant-numeric: var(--type-numerals); color: var(--ink); white-space: nowrap; }`,
  // wave planner: quarter bars against caps
  `.gp-plan-quarters { display: flex; flex-direction: column; gap: ${rem(3)}; margin: 0; padding: 0; list-style: none; }`,
  `.gp-plan-quarter { display: grid; grid-template-columns: ${rem(22)} minmax(0, 1fr) ${rem(92)} minmax(0, 0.6fr) ${rem(40)}; align-items: center; gap: ${rem(6)}; font-size: var(--type-s-size); color: var(--ink-2); }`,
  `.gp-plan-quarter > b { font: var(--type-xs-weight) var(--type-xs-size)/1 ${mono}; color: var(--ink-3); }`,
  `.gp-plan-qbar { position: relative; height: ${rem(10)}; border-radius: var(--radius-pill); background: var(--track); }`,
  `.gp-plan-qbar > i { position: absolute; inset: 0 auto 0 0; border-radius: inherit; background: var(--accent); width: ${share('var(--ot)', 'var(--ms)')}; transition: width ${ease}; }`,
  `.gp-plan-qbar > s { position: absolute; top: calc(-1 * ${rem(2)}); bottom: calc(-1 * ${rem(2)}); width: ${rem(2)}; background: var(--warn); left: ${share('var(--cap)', 'var(--ms)')}; display: none; }`,
  `.gp-plan-qbar[data-capped] > s { display: block; }`,
  `.gp-plan-qbar-launch > i { background: var(--pos); width: ${share('var(--ln)', 'var(--cs)')}; }`,
  `.gp-plan-qbar-launch > s { left: ${share('var(--lc)', 'var(--cs)')}; }`,
  `.gp-plan-open { height: ${rem(20)}; padding: 0 ${rem(8)}; border-radius: var(--radius-pill); border: ${line}; background: var(--accent-glow); color: var(--ink); font: 500 var(--type-xs-size)/1 var(--font-ui), sans-serif; cursor: pointer; white-space: nowrap; }`,
  `.gp-plan-open:disabled { cursor: default; opacity: .5; }`,
  `.gp-plan-open:focus-visible { ${focus} }`,
  `@media (prefers-reduced-motion: reduce) { .gp-plan-div > i, .gp-plan-qbar > i { transition: none; } }`,
  `@media ${SHORT_DESKTOP_QUERY} {`,
  `  .gp-plan-stress th, .gp-plan-stress td { padding: ${rem(2)} ${rem(4)}; }`,
  `  .gp-plan-qbar { height: ${rem(8)}; }`,
  `}`,
].join('\n');
