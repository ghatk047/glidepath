import { rem } from '@glidepath/ui/shell';

/**
 * Excel screen CSS (docs/ux/screens/data-dark-1440.jpg): token CSS vars only; lengths with no
 * token are rem.
 */
const mono = 'var(--font-mono), ui-monospace, monospace';
const line = `${rem(1)} solid var(--glass-line)`;
const focus = `outline: ${rem(2)} solid var(--accent); outline-offset: ${rem(2)};`;

export const excelCss = [
  '/* web modules/excel: generated from tokens in src/modules/excel/styles.ts */',
  `.gp-xl-eyebrow { font: var(--type-xs-weight) var(--type-xs-size)/1.2 ${mono}; letter-spacing: var(--type-xs-tracking); text-transform: uppercase; color: var(--ink-3); margin: 0 0 ${rem(12)}; }`,
  `.gp-xl-section + .gp-xl-section { margin-top: ${rem(22)}; }`,
  `.gp-xl-chips { display: flex; flex-wrap: wrap; gap: ${rem(10)}; }`,
  `.gp-xl-chip { cursor: pointer; font: inherit; }`,
  `.gp-xl-chip[aria-pressed="true"] { background: var(--glass-3); color: var(--ink); border-color: var(--accent); }`,
  `.gp-xl-chip:focus-visible { ${focus} }`,
  `.gp-xl-head-chips { display: flex; gap: ${rem(10)}; flex-wrap: wrap; }`,
  `.gp-xl-file { display: flex; align-items: center; gap: ${rem(16)}; padding: ${rem(16)} ${rem(22)}; border-radius: var(--radius-card); border: ${line}; background: var(--glass-2); }`,
  `.gp-xl-file[data-drop] { border-style: dashed; }`,
  `.gp-xl-file[data-over="true"] { border-color: var(--accent); background: var(--glass-3); }`,
  `.gp-xl-file-icon { display: grid; place-items: center; width: ${rem(44)}; height: ${rem(44)}; border-radius: var(--radius-control); background: var(--glass-3); color: var(--ink); flex: none; }`,
  `.gp-xl-file-text { display: flex; flex-direction: column; gap: ${rem(4)}; min-width: 0; flex: 1; }`,
  `.gp-xl-file-name { margin: 0; color: var(--ink); font-size: var(--type-m-size); overflow-wrap: anywhere; }`,
  `.gp-xl-file-sub { color: var(--ink-3); font-size: var(--type-s-size); }`,
  `.gp-xl-primary { width: 100%; margin-top: ${rem(22)}; height: ${rem(48)}; }`,
  `.gp-xl-review { margin-top: ${rem(16)}; }`,
  `.gp-xl-foot { display: flex; align-items: center; gap: ${rem(12)}; flex-wrap: wrap; margin-top: ${rem(22)}; color: var(--ink-3); font-size: var(--type-m-size); }`,
  `.gp-xl-foot-actions { margin-left: auto; display: flex; gap: ${rem(12)}; }`,
  `.gp-xl-note { margin: ${rem(12)} 0 0; color: var(--ink-2); font-size: var(--type-s-size); }`,
  `.gp-xl-error { margin: ${rem(12)} 0 0; color: var(--neg); font-size: var(--type-s-size); }`,
  `.gp-xl-list { margin: ${rem(12)} 0 0; padding-left: ${rem(18)}; color: var(--ink-2); font-size: var(--type-s-size); }`,
  `.gp-xl-impact { margin: ${rem(16)} 0 0; padding: 0; list-style: none; display: grid; gap: ${rem(8)}; }`,
  `.gp-xl-impact li { display: flex; justify-content: space-between; gap: ${rem(12)}; color: var(--ink-2); font-size: var(--type-m-size); }`,
  `.gp-xl-impact strong { color: var(--ink); font-weight: 600; font-variant-numeric: var(--type-numerals); }`,
  `.gp-xl-hidden { position: absolute; width: ${rem(1)}; height: ${rem(1)}; overflow: hidden; clip-path: inset(50%); }`,
].join('\n');
