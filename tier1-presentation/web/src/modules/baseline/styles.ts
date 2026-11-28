import { rem } from '@glidepath/ui/shell';
import { DESKTOP_QUERY, SHORT_DESKTOP_QUERY } from '@glidepath/ui/glass';
import { media } from '@glidepath/ui/tokens';

/**
 * Layout CSS of the Baseline screen (prototype `.kpis`, `.tmwrap`, `.tbl`), token vars and rem
 * only: no hex, no raw px. Panels, chips, buttons and the treemap bring their own CSS.
 */
const line = `${rem(1)} solid var(--glass-line)`;
const mono = 'var(--font-mono), ui-monospace, monospace';
const focus = `outline: ${rem(2)} solid var(--accent); outline-offset: ${rem(2)};`;

export const baselineCss = [
  '/* web modules/baseline: generated from tokens in src/modules/baseline/styles.ts */',
  `.gp-baseline { display: flex; flex-direction: column; gap: var(--space-gap); }`,
  `.gp-bl-strip { display: flex; align-items: flex-end; flex-wrap: wrap; gap: ${rem(28)}; }`,
  `.gp-bl-kpi { display: flex; flex-direction: column; gap: ${rem(4)}; }`,
  `.gp-bl-kpi strong { font-size: var(--type-xl-size); font-weight: var(--type-xl-weight); color: var(--ink); font-variant-numeric: tabular-nums; }`,
  `.gp-bl-kpi[data-hero] strong { font-size: var(--type-hero-size, var(--type-xl-size)); }`,
  `.gp-bl-kpi small { font-size: var(--type-s-size); font-weight: 400; color: var(--ink-3); }`,
  `.gp-bl-groupby { margin-left: auto; }`,
  `.gp-bl-main { display: grid; grid-template-columns: minmax(0, 8fr) minmax(0, 4fr); gap: var(--space-gap); }`,
  `.gp-bl-legend { display: inline-flex; gap: ${rem(14)}; font-size: var(--type-s-size); color: var(--ink-2); }`,
  `.gp-bl-legend span { display: inline-flex; align-items: center; gap: ${rem(6)}; }`,
  `.gp-bl-legend i { width: ${rem(10)}; height: ${rem(10)}; border-radius: var(--radius-small); background: var(--track); }`,
  `.gp-bl-legend i[data-slot="0"] { background: var(--sequential-1); }`,
  `.gp-bl-legend i[data-slot="1"] { background: var(--sequential-2); }`,
  `.gp-bl-legend i[data-slot="2"] { background: var(--sequential-3); }`,
  `.gp-bl-name { margin: 0 0 ${rem(8)}; font-size: var(--type-l-size); font-weight: var(--type-l-weight); color: var(--ink); }`,
  `.gp-bl-total { display: flex; align-items: baseline; gap: ${rem(12)}; font-size: var(--type-xl-size); color: var(--ink); font-variant-numeric: tabular-nums; }`,
  `.gp-bl-growth { font-size: var(--type-s-size); color: var(--ink-3); }`,
  `.gp-bl-split { margin: ${rem(14)} 0; }`,
  `.gp-bl-meter { width: 100%; height: ${rem(10)}; }`,
  `.gp-bl-split-labels { display: flex; gap: ${rem(14)}; margin-top: ${rem(6)}; font-size: var(--type-s-size); color: var(--ink-2); }`,
  `.gp-bl-top { list-style: none; margin: ${rem(14)} 0 0; padding: 0; display: flex; flex-direction: column; gap: ${rem(10)}; }`,
  `.gp-bl-top li { display: flex; justify-content: space-between; align-items: baseline; gap: ${rem(12)}; }`,
  `.gp-bl-line-name { display: flex; flex-direction: column; min-width: 0; }`,
  `.gp-bl-line-name > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--ink); }`,
  `.gp-bl-line-name small { color: var(--ink-3); font-size: var(--type-xs-size); }`,
  `.gp-bl-hint { display: inline-flex; align-items: center; gap: ${rem(14)}; font-size: var(--type-s-size); color: var(--ink-3); }`,
  `.gp-bl-table-wrap { overflow-x: auto; }`,
  `.gp-bl-table { width: 100%; border-collapse: collapse; font-size: var(--type-m-size); }`,
  `.gp-bl-table th, .gp-bl-table td { text-align: left; padding: ${rem(12)} ${rem(10)}; border-bottom: ${line}; font-weight: 400; color: var(--ink); }`,
  `.gp-bl-table thead th { font: 500 var(--type-xs-size)/1.2 ${mono}; letter-spacing: var(--type-xs-tracking); text-transform: uppercase; color: var(--ink-3); }`,
  `.gp-bl-table [data-num] { text-align: right; font-variant-numeric: tabular-nums; }`,
  `.gp-bl-addr::before { content: ""; display: inline-block; width: ${rem(10)}; height: ${rem(10)}; margin-right: ${rem(8)}; border-radius: var(--radius-small); background: var(--track); }`,
  `.gp-bl-addr[data-addr="partly"]::before { background: var(--sequential-2); }`,
  `.gp-bl-addr[data-addr="addressable"]::before { background: var(--sequential-3); }`,
  `.gp-bl-addr[data-addr="locked"]::before { background: var(--sequential-1); }`,
  `.gp-baseline button:focus-visible { ${focus} }`,
  `@media ${media.tablet} { .gp-bl-main { grid-template-columns: minmax(0, 1fr); } }`,
  // desktop (UIX-01): the screen fits the viewport with no page scroll. The KPI strip on top; the
  // treemap and the group detail share the next row; the line items take the bottom row and their
  // 70-odd rows scroll inside the panel under a sticky header, one line per row (long names end in
  // an ellipsis; the cell's title has the full text). The treemap re-tiles to its panel's shape.
  `@media ${DESKTOP_QUERY} {`,
  `  .gp-module.gp-baseline { display: grid; grid-template-columns: minmax(0, 8fr) minmax(0, 4fr); grid-template-rows: auto minmax(0, 1.15fr) minmax(0, 1fr); }`,
  `  .gp-bl-strip { grid-column: 1 / -1; gap: ${rem(22)}; }`,
  `  .gp-bl-main { display: contents; }`,
  `  .gp-bl-lines { grid-column: 1 / -1; }`,
  `  .gp-baseline > .gp-panel, .gp-bl-main > .gp-panel { min-height: 0; display: flex; flex-direction: column; }`,
  `  .gp-baseline .gp-panel > .gp-body { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }`,
  `  .gp-bl-map .gp-treemap { flex: 1 1 0; }`,
  `  .gp-bl-top { flex: 1 1 0; min-height: 0; overflow-y: auto; overscroll-behavior: contain; gap: ${rem(6)}; margin-top: ${rem(10)}; }`,
  `  .gp-bl-split { margin: ${rem(10)} 0; }`,
  `  .gp-bl-table-wrap { flex: 1 1 0; min-height: 0; overflow: auto; overscroll-behavior: contain; }`,
  `  .gp-bl-table { font-size: var(--type-s-size); table-layout: fixed; }`,
  `  .gp-bl-table th, .gp-bl-table td { padding: ${rem(7)} ${rem(8)}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }`,
  `  .gp-bl-table thead th { position: sticky; top: 0; z-index: 1; background: color-mix(in srgb, var(--ground) 88%, transparent); }`,
  `  .gp-bl-table thead th:nth-child(1) { width: 30%; }`,
  `  .gp-bl-table thead th:nth-child(2) { width: 12%; }`,
  `  .gp-bl-table thead th:nth-child(3) { width: 18%; }`,
  `  .gp-bl-table thead th:nth-child(4) { width: 14%; }`,
  `  .gp-bl-table thead th:nth-child(5) { width: 6%; }`,
  `  .gp-bl-table thead th:nth-child(6) { width: 6%; }`,
  `  .gp-bl-table thead th:nth-child(7) { width: 14%; }`,
  `}`,
  // short desktop: tighter rows and a smaller headline so the table keeps several rows in view
  `@media ${SHORT_DESKTOP_QUERY} {`,
  `  .gp-module.gp-baseline { grid-template-rows: auto minmax(0, 1fr) minmax(0, 1fr); }`,
  `  .gp-bl-strip { gap: ${rem(18)}; }`,
  `  .gp-bl-kpi[data-hero] strong { font-size: clamp(${rem(32)}, 2.8vw, ${rem(40)}); }`,
  `  .gp-bl-name { margin-bottom: ${rem(4)}; }`,
  `  .gp-bl-total { font-size: var(--type-l-size); }`,
  `  .gp-bl-table th, .gp-bl-table td { padding: ${rem(5)} ${rem(8)}; }`,
  `}`,
].join('\n');
