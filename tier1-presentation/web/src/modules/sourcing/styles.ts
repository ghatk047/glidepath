import { DESKTOP_QUERY, SHORT_DESKTOP_QUERY } from '@glidepath/ui/glass';
import { rem } from '@glidepath/ui/shell';

/**
 * Sourcing screen CSS (SRC-11), token CSS vars only; metrics with no token are rem. Bar, range and
 * timeline geometry is drawn by CSS `calc()` from the values tier 2 sent (custom properties), as the
 * VPs bullet is: tier 1 does no arithmetic on them.
 */
const mono = 'var(--font-mono), ui-monospace, monospace';
const num = 'var(--font-num), var(--font-ui), sans-serif';
const line = `${rem(1)} solid var(--glass-line)`;
const focus = `outline: ${rem(2)} solid var(--accent); outline-offset: ${rem(2)};`;
const ease = 'var(--motion-value) var(--motion-ease)';
/** Position of `--x` on the row's track from `--lo` to `--hi` (unitless numbers), as a percentage. */
const at = (x: string) => `calc((${x} - var(--lo)) / (var(--hi) - var(--lo)) * 100%)`;

export const sourcingCss = [
  '/* web modules/sourcing: generated from tokens in src/modules/sourcing/styles.ts */',
  `.gp-src { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); grid-auto-rows: minmax(${rem(260)}, auto); gap: var(--space-gap); min-width: 0; }`,
  `.gp-src > .gp-panel { display: flex; flex-direction: column; min-height: 0; min-width: 0; }`,
  `.gp-src > .gp-panel > .gp-body { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; }`,
  `.gp-src-body { display: flex; flex-direction: column; gap: ${rem(8)}; flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain; }`,
  `.gp-src-body .gp-src-body { overflow: visible; }`,
  `.gp-src-scroll { flex: 1 1 auto; min-height: ${rem(72)}; overflow-y: auto; overscroll-behavior: contain; margin-right: calc(-1 * ${rem(6)}); padding-right: ${rem(6)}; }`,
  `.gp-src-error { margin: 0; padding: ${rem(4)} ${rem(8)}; border-radius: var(--radius-small); border: ${line}; color: var(--neg); font-size: var(--type-s-size); }`,
  `.gp-src-note { margin: 0; color: var(--ink-3); font-size: var(--type-xs-size); }`,
  // KPI tiles
  `.gp-src-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(${rem(84)}, 1fr)); gap: ${rem(6)}; margin: 0; }`,
  `.gp-src-kpi { display: flex; flex-direction: column; gap: ${rem(2)}; min-width: 0; padding: ${rem(4)} ${rem(8)}; border-radius: var(--radius-small); background: var(--glass-2); border: ${line}; }`,
  `.gp-src-kpi dt { font: var(--type-xs-weight) var(--type-xs-size)/1.2 ${mono}; letter-spacing: var(--type-xs-tracking); text-transform: uppercase; color: var(--ink-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }`,
  `.gp-src-kpi dd { margin: 0; font: 600 var(--type-m-size)/1.15 ${num}; font-variant-numeric: var(--type-numerals); color: var(--ink); white-space: nowrap; }`,
  `.gp-src-kpi dd small { font-weight: 400; color: var(--ink-3); font-size: var(--type-xs-size); }`,
  // parameter strip
  `.gp-src-params { display: flex; flex-wrap: wrap; gap: ${rem(4)} ${rem(10)}; margin: 0; padding: 0; list-style: none; }`,
  `.gp-src-param { display: inline-flex; align-items: center; gap: ${rem(4)}; min-width: 0; }`,
  `.gp-src-param-label { max-width: ${rem(104)}; color: var(--ink-3); font-size: var(--type-xs-size); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }`,
  `.gp-src-param .gp-stepper { height: ${rem(26)}; }`,
  `.gp-src-param .gp-stepper button { width: ${rem(20)}; height: ${rem(24)}; font-size: var(--type-s-size); }`,
  `.gp-src-param .gp-stepper input { width: ${rem(48)}; font-size: var(--type-s-size); }`,
  `.gp-src-param[data-pending] .gp-stepper input { color: var(--accent); }`,
  // ranked list (vendors, moves, renewals, benchmarks)
  `.gp-src-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }`,
  `.gp-src-row { display: grid; align-items: center; gap: ${rem(8)}; padding: ${rem(3)} 0; border-bottom: ${line}; font-size: var(--type-s-size); color: var(--ink-2); min-width: 0; }`,
  `.gp-src-row:last-child { border-bottom: 0; }`,
  `.gp-src-row > * { min-width: 0; }`,
  `.gp-src-name { color: var(--ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }`,
  `.gp-src-num { text-align: right; font-variant-numeric: var(--type-numerals); white-space: nowrap; }`,
  `.gp-src-sub { color: var(--ink-3); font-size: var(--type-xs-size); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }`,
  `.gp-src-row[data-muted] { opacity: .6; }`,
  `.gp-src-row[data-muted] .gp-src-name { font-style: italic; color: var(--ink-2); }`,
  // vendors
  `.gp-src-vendor { grid-template-columns: ${rem(18)} minmax(0, 1.4fr) minmax(${rem(60)}, 1fr) ${rem(56)} ${rem(44)}; }`,
  `.gp-src-rank { color: var(--ink-3); font: var(--type-xs-weight) var(--type-xs-size)/1 ${mono}; text-align: right; }`,
  `.gp-src-bar { position: relative; height: ${rem(8)}; border-radius: var(--radius-pill); background: var(--track); overflow: hidden; }`,
  `.gp-src-bar > i { position: absolute; inset: 0 auto 0 0; border-radius: inherit; background: var(--accent); width: clamp(0%, calc(var(--share) / var(--top) * 100%), 100%); transition: width ${ease}; }`,
  `.gp-src-bar[data-preferred] > i { background: var(--pos); }`,
  `.gp-src-bar[data-muted] > i { background: var(--ink-3); }`,
  `.gp-src-tags { display: inline-flex; gap: ${rem(4)}; margin-left: ${rem(6)}; vertical-align: middle; }`,
  `.gp-src-tag { display: inline-flex; align-items: center; height: ${rem(16)}; padding: 0 ${rem(5)}; border-radius: var(--radius-pill); border: ${line}; background: var(--glass-2); color: var(--ink-3); font: 500 var(--type-xs-size)/1 ${mono}; font-style: normal; }`,
  `.gp-src-tag[data-tone="pos"] { color: var(--pos); }`,
  `.gp-src-tag[data-tone="warn"] { color: var(--warn); }`,
  `.gp-src-tag[data-tone="neg"] { color: var(--neg); }`,
  `.gp-src-tag[data-tone="accent"] { color: var(--accent); }`,
  `.gp-src-more { align-self: flex-start; border: 0; background: transparent; color: var(--accent); font: inherit; font-size: var(--type-xs-size); padding: ${rem(2)} 0; cursor: pointer; }`,
  `.gp-src-more:focus-visible { ${focus} }`,
  // renewals
  `.gp-src-timeline { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); align-items: end; gap: ${rem(2)}; height: ${rem(40)}; margin: 0; padding: 0 0 ${rem(12)}; list-style: none; position: relative; }`,
  `.gp-src-month { position: relative; height: 100%; display: flex; align-items: flex-end; }`,
  `.gp-src-month > i { display: block; width: 100%; min-height: ${rem(2)}; border-radius: ${rem(2)} ${rem(2)} 0 0; background: var(--track); height: clamp(0%, calc(var(--v) / var(--vmax) * 100%), 100%); transition: height ${ease}; }`,
  `.gp-src-month[data-has] > i { background: var(--accent); }`,
  `.gp-src-month > b { position: absolute; top: 100%; left: 0; font: 400 var(--type-xs-size)/1.4 ${mono}; color: var(--ink-3); white-space: nowrap; }`,
  `.gp-src-renewal { grid-template-columns: ${rem(64)} minmax(0, 1fr) ${rem(52)} ${rem(54)} ${rem(46)} ${rem(52)}; }`,
  `.gp-src-statuses { display: inline-flex; gap: ${rem(4)}; flex-wrap: wrap; }`,
  // benchmarks
  `.gp-src-bench { grid-template-columns: minmax(0, 1fr) minmax(${rem(80)}, 9rem) ${rem(64)} ${rem(54)} ${rem(54)}; }`,
  `.gp-src-range { --lo: min(var(--p25), var(--cost)); --hi: max(var(--p75), var(--cost)); position: relative; height: ${rem(12)}; border-radius: var(--radius-pill); background: var(--track); }`,
  `.gp-src-range > .band { position: absolute; top: ${rem(3)}; bottom: ${rem(3)}; left: ${at('var(--p25)')}; right: calc(100% - ${at('var(--p75)')}); border-radius: var(--radius-pill); background: var(--accent-glow); border: ${line}; }`,
  `.gp-src-range > .mid { position: absolute; top: ${rem(1)}; bottom: ${rem(1)}; width: ${rem(1)}; left: ${at('var(--median)')}; background: var(--ink-2); }`,
  `.gp-src-range > .cost { position: absolute; top: 50%; width: ${rem(8)}; height: ${rem(8)}; margin: calc(-1 * ${rem(4)}) 0 0 calc(-1 * ${rem(4)}); border-radius: 50%; left: ${at('var(--cost)')}; background: var(--ink); box-shadow: 0 0 0 ${rem(2)} var(--glass); }`,
  `.gp-src-range[data-over] > .cost { background: var(--warn); }`,
  `.gp-src-edit { font: inherit; color: inherit; cursor: pointer; }`,
  `button.gp-src-edit:not(.gp-src-range) { border: 0; padding: 0; background: transparent; text-decoration: underline dotted var(--ink-3); text-underline-offset: ${rem(3)}; font-variant-numeric: var(--type-numerals); }`,
  `button.gp-src-range { display: block; width: 100%; padding: 0; border: 0; }`,
  `.gp-src-edit:hover { color: var(--ink); }`,
  `.gp-src-edit:focus-visible { ${focus} }`,
  `.gp-src-edit[aria-expanded="true"] { color: var(--accent); }`,
  `.gp-src-editor { padding: ${rem(4)} 0 ${rem(6)} ${rem(8)}; border-bottom: ${line}; background: var(--glass-2); border-radius: var(--radius-small); }`,
  `.gp-src-headroom { margin: 0; font-size: var(--type-s-size); color: var(--ink-2); }`,
  `.gp-src-headroom strong { color: var(--ink); font-variant-numeric: var(--type-numerals); }`,
  `.gp-src-headroom[data-sign="beyond"] strong { color: var(--pos); }`,
  // consolidation
  `.gp-src-move { grid-template-columns: minmax(0, 1fr) ${rem(52)} ${rem(52)} ${rem(46)} ${rem(54)}; }`,
  `.gp-src-arrow { color: var(--ink-3); padding: 0 ${rem(4)}; }`,
  `.gp-src-head > * { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }`,
  `.gp-src-head { color: var(--ink-3); font: var(--type-xs-weight) var(--type-xs-size)/1.2 ${mono}; letter-spacing: var(--type-xs-tracking); text-transform: uppercase; border-bottom: ${line}; }`,
  `.gp-src-binding { display: flex; flex-wrap: wrap; gap: ${rem(4)}; align-items: center; margin: 0; padding: 0; list-style: none; }`,
  `.gp-src-compute { position: relative; display: inline-block; overflow: hidden; width: ${rem(56)}; height: ${rem(16)}; }`,
  `.gp-src-stale { opacity: .55; transition: opacity ${ease}; }`,
  `@media (prefers-reduced-motion: reduce) { .gp-src-bar > i, .gp-src-month > i, .gp-src-stale { transition: none; } }`,
  // desktop: the screen is a 2x2 grid that fits the viewport (1280x720, 1920x1080); lists scroll inside
  // their panels. The offset is the shell's top bar, its padding (14 top, 112 bottom for the flight strip,
  // global/shell/styles.ts, desktop) and the module's own padding; the short desktop has 10 on top.
  `@media ${DESKTOP_QUERY} {`,
  `  .gp-src { height: calc(100vh - ${rem(220)}); grid-template-rows: repeat(2, minmax(0, 1fr)); grid-auto-rows: auto; }`,
  `  .gp-src > .gp-panel { overflow: hidden; }`,
  `}`,
  // short desktop (1280x720): tighter tiles and rows so the lists keep room to scroll
  `@media ${SHORT_DESKTOP_QUERY} {`,
  `  .gp-src { height: calc(100vh - ${rem(205)}); }`,
  `  .gp-src-body { gap: ${rem(6)}; }`,
  `  .gp-src-kpis { grid-template-columns: repeat(auto-fit, minmax(${rem(68)}, 1fr)); gap: ${rem(4)}; }`,
  `  .gp-src-kpi { padding: ${rem(2)} ${rem(6)}; }`,
  `  .gp-src-kpi dd { font-size: var(--type-s-size); }`,
  `  .gp-src-timeline { height: ${rem(30)}; }`,
  `}`,
].join('\n');
