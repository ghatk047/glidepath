import { DESKTOP_QUERY, SHORT_DESKTOP_QUERY } from '@glidepath/ui/glass';
import { rem } from '@glidepath/ui/shell';

/**
 * Levers module CSS (prototype `.lever-row`, `.lev-bar`, `.timing`), token CSS vars only. Metrics
 * with no token are rem. Bars are drawn by CSS from `--value` / `--max` (tier 2's numbers), so no
 * arithmetic happens in tier 1.
 */
const line = `${rem(1)} solid var(--glass-line)`;
const focus = `outline: ${rem(2)} solid var(--accent); outline-offset: ${rem(2)};`;
const mono = 'var(--font-mono), ui-monospace, monospace';
const num = 'var(--font-num), ui-monospace, monospace';

export const leversCss = [
  '/* web modules/levers: generated from tokens in src/modules/levers/styles.ts */',
  `.gp-lv-eyebrow { font: var(--type-xs-weight) var(--type-xs-size)/1.2 ${mono}; letter-spacing: var(--type-xs-tracking); text-transform: uppercase; color: var(--ink-3); margin: 0; }`,
  `.gp-lv-family { display: flex; justify-content: space-between; align-items: baseline; margin: ${rem(14)} 0 ${rem(4)}; }`,
  `.gp-lv-group:first-child .gp-lv-family { margin-top: 0; }`,
  `.gp-lv-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }`,
  `.gp-lv-row { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; column-gap: ${rem(12)}; align-items: center; padding: ${rem(6)} ${rem(8)}; border-radius: var(--radius-card); border: ${rem(1)} solid transparent; }`,
  `.gp-lv-row:hover { background: var(--glass); }`,
  `.gp-lv-row[aria-current="true"] { background: var(--glass-2); border-color: var(--glass-line); }`,
  `.gp-lv-name { display: block; width: 100%; text-align: left; border: 0; background: transparent; color: var(--ink); font: inherit; padding: 0; cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }`,
  `.gp-lv-name:focus-visible { ${focus} }`,
  `.gp-lv-main { min-width: 0; display: flex; flex-direction: column; gap: ${rem(4)}; }`,
  `.gp-lv-row[data-off="true"] .gp-lv-main, .gp-lv-row[data-off="true"] .gp-lv-iy { opacity: .45; }`,
  `.gp-lv-iy { font-family: ${num}; font-variant-numeric: tabular-nums; color: var(--ink); text-align: right; }`,
  `.gp-lv-bar { display: block; height: ${rem(3)}; border-radius: var(--radius-pill); background: var(--track); overflow: hidden; }`,
  `.gp-lv-bar > i { display: block; height: 100%; width: calc(100% * var(--value, 0) / var(--max, 1)); max-width: 100%; background: var(--accent); border-radius: inherit; transition: width var(--motion-value) var(--motion-ease); }`,
  `.gp-lv-chips { display: flex; gap: ${rem(8)}; flex-wrap: wrap; margin-bottom: ${rem(10)}; }`,
  `.gp-lv-chip { display: inline-flex; align-items: center; padding: ${rem(4)} ${rem(12)}; border-radius: var(--radius-pill); border: ${line}; background: var(--glass); color: var(--ink-2); font-size: var(--type-s-size); }`,
  `.gp-lv-chip[data-tone="accent"] { color: var(--accent-ink); background: var(--accent); border-color: var(--accent); }`,
  `.gp-lv-title { margin: 0 0 ${rem(16)}; font-size: var(--type-xl-size); font-weight: var(--type-xl-weight); letter-spacing: var(--type-xl-tracking); color: var(--ink); }`,
  `.gp-lv-kpis { display: grid; grid-template-columns: 1.3fr 1fr 1fr; gap: ${rem(12)}; margin-bottom: ${rem(20)}; }`,
  `.gp-lv-kpi { display: flex; flex-direction: column; gap: ${rem(6)}; padding: ${rem(14)} ${rem(16)}; border-radius: var(--radius-card); border: ${line}; background: var(--glass); min-width: 0; }`,
  `.gp-lv-kpi [data-value], .gp-lv-kpi .gp-value { font-family: ${num}; font-variant-numeric: tabular-nums; font-size: var(--type-l-size); color: var(--ink); }`,
  `.gp-lv-kpi[data-hero="true"] [data-value], .gp-lv-kpi[data-hero="true"] .gp-value { font-size: var(--type-xl-size); }`,
  `.gp-lv-sliders { display: flex; flex-direction: column; gap: ${rem(14)}; margin-bottom: ${rem(20)}; }`,
  `.gp-lv-conf { display: flex; align-items: center; gap: ${rem(12)}; margin-bottom: ${rem(16)}; }`,
  `.gp-lv-timing-head { display: flex; align-items: center; gap: ${rem(10)}; margin: ${rem(8)} 0; }`,
  `.gp-lv-timing-head .gp-lv-eyebrow { margin-right: auto; }`,
  `.gp-lv-select { height: ${rem(32)}; border-radius: var(--radius-control); border: ${line}; background: var(--glass); color: var(--ink); font: inherit; padding: 0 ${rem(8)}; }`,
  `.gp-lv-select:focus-visible { ${focus} }`,
  `.gp-lv-cells { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: ${rem(4)}; }`,
  `.gp-lv-cells li { display: flex; flex-direction: column; gap: ${rem(6)}; align-items: center; font: var(--type-xs-weight) var(--type-xs-size)/1 ${mono}; color: var(--ink-3); }`,
  `.gp-lv-cell { position: relative; display: block; width: 100%; height: ${rem(40)}; border-radius: var(--radius-small); background: var(--track); overflow: hidden; }`,
  `.gp-lv-cell > i { position: absolute; left: 0; right: 0; bottom: 0; height: calc(100% * var(--value, 0) / var(--max, 1)); max-height: 100%; background: var(--accent); opacity: .7; }`,
  `.gp-lv-hyp { margin: ${rem(18)} 0 0; color: var(--ink-3); font-size: var(--type-m-size); line-height: 1.5; }`,
  `.gp-lv-all-hero { display: block; font-family: ${num}; font-variant-numeric: tabular-nums; font-size: var(--type-hero-size); font-weight: var(--type-hero-weight); letter-spacing: var(--type-hero-tracking); color: var(--ink); }`,
  `.gp-lv-all-sub { margin: ${rem(4)} 0 ${rem(14)}; color: var(--ink-3); }`,
  `.gp-lv-all-pair { display: grid; grid-template-columns: 1fr 1fr; gap: ${rem(12)}; padding-top: ${rem(14)}; border-top: ${line}; }`,
  `.gp-lv-all-pair div { display: flex; flex-direction: column; gap: ${rem(4)}; }`,
  `.gp-lv-all-pair [data-value], .gp-lv-all-pair .gp-value { font-family: ${num}; font-size: var(--type-l-size); color: var(--ink); }`,
  `@media (prefers-reduced-motion: reduce) { .gp-lv-bar > i { transition: none; } }`,
  // desktop (UIX-01): the screen fits the viewport with no page scroll. One row of three columns as
  // tall as the screen allows: the 20 levers scroll inside their panel; the detail sets the
  // confidence dial beside the sliders (and scrolls inside its panel if a lever has many); the month
  // chart takes the rest of the right column. Display numbers are capped to fit their column at 1280 px.
  `@media ${DESKTOP_QUERY} {`,
  `  .gp-module[data-module="levers"] > .gp-grid { grid-template-rows: minmax(0, 1fr); }`,
  `  .gp-module[data-module="levers"] .gp-stack { min-height: 0; }`,
  `  .gp-module[data-module="levers"] .gp-panel { min-height: 0; display: flex; flex-direction: column; }`,
  `  .gp-module[data-module="levers"] .gp-panel > .gp-body { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }`,
  `  .gp-lv-month { flex: 1 1 0; }`,
  `  .gp-lv-month .gp-monthly { flex: 1 1 0; min-height: 0; height: 100%; }`,
  `  .gp-lv-list-wrap { flex: 1 1 0; min-height: 0; overflow-y: auto; overscroll-behavior: contain; margin-right: calc(-1 * ${rem(8)}); padding-right: ${rem(8)}; }`,
  `  .gp-module[data-module="levers"] .gp-lv-detail > .gp-body { display: grid; grid-template-columns: auto minmax(0, 1fr); column-gap: ${rem(18)}; align-content: start; overflow-y: auto; overscroll-behavior: contain; }`,
  `  .gp-lv-detail > .gp-body > * { grid-column: 1 / -1; }`,
  `  .gp-lv-detail > .gp-body > .gp-lv-conf { grid-column: 1; align-self: center; flex-direction: column; margin: 0; }`,
  `  .gp-lv-detail > .gp-body > .gp-lv-sliders { grid-column: 2; margin: 0; }`,
  `  .gp-lv-detail > .gp-body > .gp-lv-timing { margin-top: ${rem(10)}; }`,
  `  .gp-lv-family { margin: ${rem(10)} 0 ${rem(2)}; }`,
  `  .gp-lv-row { padding: ${rem(4)} ${rem(8)}; }`,
  `  .gp-lv-title { font-size: min(var(--type-xl-size), ${rem(30)}); margin-bottom: ${rem(10)}; }`,
  `  .gp-lv-kpis { gap: ${rem(8)}; margin-bottom: ${rem(12)}; }`,
  `  .gp-lv-kpi { padding: ${rem(10)} ${rem(12)}; }`,
  `  .gp-lv-kpi[data-hero="true"] [data-value], .gp-lv-kpi[data-hero="true"] .gp-value { font-size: min(var(--type-xl-size), ${rem(28)}); }`,
  `  .gp-lv-sliders { gap: ${rem(10)}; }`,
  `  .gp-lv-cell { height: ${rem(30)}; }`,
  `  .gp-lv-hyp { margin-top: ${rem(12)}; font-size: var(--type-s-size); }`,
  `  .gp-lv-all-hero { font-size: min(var(--type-hero-size), ${rem(46)}); white-space: nowrap; }`,
  `}`,
  // short desktop: smaller title and tiles, shorter month cells
  `@media ${SHORT_DESKTOP_QUERY} {`,
  `  .gp-lv-chips { margin-bottom: ${rem(6)}; }`,
  `  .gp-lv-title { font-size: var(--type-l-size); margin-bottom: ${rem(8)}; }`,
  `  .gp-lv-kpi { padding: ${rem(6)} ${rem(10)}; gap: ${rem(2)}; }`,
  `  .gp-lv-kpis { margin-bottom: ${rem(8)}; }`,
  `  .gp-lv-sliders { gap: ${rem(6)}; }`,
  `  .gp-lv-cell { height: ${rem(22)}; }`,
  `  .gp-lv-cells li { gap: ${rem(3)}; }`,
  `  .gp-lv-timing-head { margin: ${rem(4)} 0; }`,
  `  .gp-lv-hyp { margin-top: ${rem(8)}; }`,
  `  .gp-lv-all-hero { font-size: min(var(--type-hero-size), ${rem(40)}); }`,
  `  .gp-lv-all-sub { margin-bottom: ${rem(8)}; }`,
  `  .gp-lv-all-pair { padding-top: ${rem(8)}; }`,
  `}`,
].join('\n');
