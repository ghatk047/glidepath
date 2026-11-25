import { rem, TOUCH_TARGET } from '@glidepath/ui/shell';
import { DESKTOP_QUERY, SHORT_DESKTOP_QUERY } from '@glidepath/ui/glass';
import { media } from '@glidepath/ui/tokens';

/**
 * Layout CSS of the global layer (prototype `.app`, `.main`, `.topbar`, `.iconbtn`, `.search`),
 * written with token CSS vars. Metrics with no design token are rem (`rem()` from ui shell),
 * so this file carries no hex and no raw px. The rail, scenario bar, tray, HUD and toast bring
 * their own CSS from `@glidepath/ui`.
 */

const line = `${rem(1)} solid var(--glass-line)`;
const focus = `outline: ${rem(2)} solid var(--accent); outline-offset: ${rem(2)};`;
const mono = 'var(--font-mono), ui-monospace, monospace';

export const layoutCss = [
  '/* web global/shell: generated from tokens in src/global/shell/styles.ts */',
  `.gp-app { position: relative; z-index: 1; display: grid; grid-template-columns: var(--space-rail-width) minmax(0, 1fr); min-height: 100vh; }`,
  `.gp-main { min-width: 0; padding: ${rem(18)} max(${rem(28)}, env(safe-area-inset-right, 0)) ${rem(140)} ${rem(32)}; }`,
  `.gp-topbar { display: flex; align-items: center; gap: ${rem(16)}; flex-wrap: wrap; margin-bottom: ${rem(22)}; }`,
  `.gp-topbar-title { display: flex; flex-direction: column; gap: ${rem(2)}; margin-right: auto; min-width: 0; }`,
  `.gp-eyebrow { font: var(--type-xs-weight) var(--type-xs-size)/1.2 ${mono}; letter-spacing: var(--type-xs-tracking); text-transform: uppercase; color: var(--ink-3); }`,
  `.gp-topbar h1 { margin: 0; font-size: var(--type-l-size); font-weight: var(--type-l-weight); color: var(--ink); }`,
  `.gp-tools { display: flex; gap: ${rem(8)}; align-items: center; flex-wrap: wrap; }`,
  `.gp-states { display: flex; gap: ${rem(6)}; align-items: center; flex-wrap: wrap; }`,
  `.gp-states:empty { display: none; }`,
  `.gp-iconbtn, .gp-search { box-sizing: border-box; height: ${rem(36)}; border-radius: var(--radius-control); border: ${line}; background: var(--glass); color: var(--ink-2); cursor: pointer; font: inherit; }`,
  `.gp-iconbtn { width: ${rem(36)}; display: grid; place-items: center; padding: 0; }`,
  `.gp-iconbtn:hover, .gp-search:hover { color: var(--ink); background: var(--glass-2); }`,
  `.gp-iconbtn svg { width: ${rem(18)}; height: ${rem(18)}; }`,
  `.gp-iconbtn:focus-visible, .gp-search:focus-visible { ${focus} }`,
  `.gp-search { display: flex; align-items: center; gap: ${rem(10)}; padding: 0 ${rem(10)} 0 ${rem(12)}; color: var(--ink-3); font-size: var(--type-s-size); }`,
  `.gp-search svg { width: ${rem(16)}; height: ${rem(16)}; }`,
  `.gp-kbd { font: 500 var(--type-xs-size)/1 ${mono}; padding: ${rem(3)} ${rem(6)}; border-radius: var(--radius-small); border: ${line}; color: var(--ink-3); }`,
  `.gp-edits-btn { min-height: ${rem(36)}; }`,
  `.gp-bar-skeleton { display: inline-flex; align-items: center; width: ${rem(420)}; max-width: 100%; height: ${rem(36)}; }`,
  `.gp-hud-loading { position: fixed; left: calc(var(--space-rail-width) + 50%); bottom: var(--space-gap); transform: translateX(calc(-50% - var(--space-rail-width) / 2)); z-index: 40; width: ${rem(560)}; max-width: calc(100% - ${rem(32)}); }`,
  `.gp-hud-loading[hidden] { display: none; }`,
  // stale values (session dropped) are dimmed until tier 2 pushes them again (IA §6)
  `[data-stale] { opacity: .55; transition: opacity var(--motion-value) var(--motion-ease); }`,
  `.gp-chip[data-state="stale"] { opacity: .8; }`,
  `.gp-chip-dismiss { border: 0; background: transparent; color: inherit; font: inherit; cursor: pointer; padding: 0 0 0 ${rem(4)}; }`,
  `.gp-chip-dismiss:focus-visible { ${focus} }`,
  `@media ${media.phone} {`,
  `  .gp-app { grid-template-columns: minmax(0, 1fr); }`,
  `  .gp-main { padding: ${rem(14)} max(var(--space-phone-gutter), env(safe-area-inset-right, 0)) ${rem(220)} max(var(--space-phone-gutter), env(safe-area-inset-left, 0)); }`,
  `  .gp-search span, .gp-search .gp-kbd { display: none; }`,
  `  .gp-iconbtn, .gp-search { min-width: ${TOUCH_TARGET}; min-height: ${TOUCH_TARGET}; justify-content: center; }`,
  `  .gp-hud-loading { left: 50%; transform: translateX(-50%); bottom: calc(${rem(82)} + env(safe-area-inset-bottom, 0)); }`,
  `}`,
  // desktop (UIX-01): title, scenarios and tools on one row; the search keeps its icon and ⌘K below
  // 1600 px (its label stays as the accessible name); less air above and below the content
  `@media ${DESKTOP_QUERY} {`,
  `  .gp-main { padding: ${rem(14)} max(${rem(24)}, env(safe-area-inset-right, 0)) ${rem(112)} ${rem(24)}; }`,
  `  .gp-topbar { flex-wrap: nowrap; gap: ${rem(12)}; margin-bottom: var(--space-gap); }`,
  `  .gp-topbar h1 { white-space: nowrap; }`,
  `  .gp-tools { flex-wrap: nowrap; gap: ${rem(6)}; }`,
  `}`,
  `@media ${DESKTOP_QUERY} and (max-width: 1600px) {`,
  `  .gp-search:not(.gp-tour-btn) > span:not(.gp-kbd) { position: absolute; width: ${rem(1)}; height: ${rem(1)}; overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap; }`,
  `  .gp-search { gap: ${rem(6)}; padding: 0 ${rem(8)}; }`,
  `  .gp-seg button { padding: ${rem(6)} ${rem(10)}; }`,
  `  .gp-seg-k { margin-right: ${rem(4)}; }`,
  `}`,
  `@media ${SHORT_DESKTOP_QUERY} {`,
  `  .gp-main { padding-top: ${rem(10)}; }`,
  `}`,
  `@media (prefers-reduced-motion: reduce) { [data-stale] { transition: none; } }`,
].join('\n');
