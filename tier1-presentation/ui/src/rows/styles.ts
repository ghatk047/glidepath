/**
 * Rows CSS (trace node #23, move row #24, diff row #25), generated from the token map. Matches
 * docs/ux/prototype/src/styles.css (`.trace`, `.tnode`, `.tlink`, `.move`, `.mv-track`, `.rank`,
 * `.tbl`, `.chip`). Lengths are rem / em / % or token calc()s: no raw px, no hex.
 */
import { cssVar, defaultTheme, tokenValue, type TokenPath } from '../tokens';

const v = (p: TokenPath) => cssVar[p];
type ColorKey =
  | 'ink'
  | 'ink2'
  | 'ink3'
  | 'hair'
  | 'accent'
  | 'accentGlow'
  | 'track'
  | 'neg'
  | 'warn'
  | 'glass'
  | 'glass2'
  | 'glassLine'
  | 'glassHi';
const c = (k: ColorKey) => cssVar[`themes.${defaultTheme}.color.${k}` as TokenPath];
const tint = (k: ColorKey, pct: number) => `color-mix(in srgb, ${c(k)} ${pct}%, transparent)`;
const gap = v('space.gap');
const hairline = tokenValue['glass.border'].split(' ')[0]!;
const border = `${hairline} solid ${c('glassLine')}`;
const highlight = tokenValue['glass.highlight'].replace('glassHi', c('glassHi'));
const mono = `${v('type.families.mono')}, ui-monospace, monospace`;
const numFont = `${v('type.families.num')}, ui-sans-serif, system-ui, sans-serif`;
const ease = `${v('motion.value')} ${v('motion.ease')}`;
const focus = `outline: 0.125rem solid ${c('accent')}; outline-offset: 0.125rem;`;
/** The prototype's --warn-bg / --neg-bg are ~13% of the status colour (same as the HUD chip). */
const TINT_PCT = 13;

export const rowsCss = [
  '/* @glidepath/ui rows: generated from tokens in src/rows/styles.ts */',
  // ---- trace chain (#23)
  `.gp-trace { display: flex; align-items: stretch; gap: 0; margin: 0; padding: 0.375rem 0.125rem 0.625rem; list-style: none; overflow-x: auto; }`,
  `.gp-trace-item { display: flex; flex: 1 0 auto; align-items: stretch; min-width: 0; }`,
  `.gp-trace-link { flex: 0 0 1.625rem; display: grid; place-items: center; color: ${c('ink3')}; }`,
  `.gp-trace-link svg { width: 1.125rem; height: 1.125rem; stroke: currentColor; fill: none; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }`,
  `.gp-tnode { flex: 1 0 8rem; display: flex; flex-direction: column; align-items: flex-start; gap: 0.5rem; box-sizing: border-box; padding: 0.875rem; border-radius: ${v('radius.card')}; background: ${c('glass')}; border: ${border}; box-shadow: ${highlight}; color: ${c('ink')}; text-align: left; font: inherit; cursor: pointer; transition: background ${ease}, box-shadow ${ease}; }`,
  `.gp-tnode:hover { background: ${c('glass2')}; }`,
  `.gp-tnode:focus-visible { ${focus} }`,
  `.gp-tnode[data-selected] { box-shadow: ${highlight}, 0 0 0 ${hairline} ${c('accent')}, 0 0 1.5rem -0.375rem ${c('accentGlow')}; }`,
  `.gp-tnode-label { font: ${v('type.scale.xs.weight')} ${v('type.scale.xs.size')}/1.25 ${mono}; letter-spacing: ${v('type.scale.xs.tracking')}; text-transform: uppercase; color: ${c('ink3')}; }`,
  `.gp-tnode-value { font: 400 ${v('type.scale.l.size')}/1.1 ${numFont}; letter-spacing: -0.02em; font-variant-numeric: ${v('type.numerals')}; }`,
  `.gp-tnode-note { font: ${v('type.scale.xs.weight')} ${v('type.scale.xs.size')}/1.25 ${v('type.families.ui')}; color: ${c('ink3')}; }`,
  // ---- move row (#24)
  `.gp-move { display: grid; grid-template-columns: 1.625rem minmax(0, 1fr) 9.375rem 7.5rem; gap: calc(${gap} * 7 / 6); align-items: center; padding: 0.625rem 0.375rem; border-bottom: ${hairline} solid ${c('hair')}; font-size: ${v('type.scale.s.size')}; }`,
  `.gp-move:last-child { border-bottom: 0; }`,
  `.gp-move-rank { font: 600 ${v('type.scale.xs.size')} ${mono}; color: ${c('ink3')}; }`,
  `.gp-move-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: ${c('ink')}; }`,
  `.gp-move-hit { display: flex; align-items: center; height: 1.25rem; }`,
  `.gp-move-track { position: relative; flex: 1; height: 0.25rem; border-radius: 0.25rem; background: ${c('track')}; }`,
  `.gp-move-span { position: absolute; top: 0; height: 0.25rem; border-radius: 0.25rem; background: ${c('accent')}; }`,
  `.gp-move-thumb { position: absolute; top: -0.25rem; width: 0.75rem; height: 0.75rem; border-radius: 50%; background: white; transform: translateX(-50%); box-shadow: 0 0 0 0.1875rem ${c('accentGlow')}; }`,
  `.gp-move-tick { position: absolute; top: -0.1875rem; width: 0.125rem; height: 0.625rem; background: ${c('ink3')}; transform: translateX(-50%); }`,
  `.gp-move-hit:focus-visible { ${focus} }`,
  `.gp-move-text { text-align: right; font-family: ${numFont}; font-variant-numeric: ${v('type.numerals')}; white-space: nowrap; }`,
  `.gp-move-from { color: ${c('ink3')}; }`,
  // ---- diff row (#25)
  `.gp-diff-wrap { overflow-x: auto; }`,
  `.gp-diff { width: 100%; border-collapse: collapse; font-size: ${v('type.scale.s.size')}; }`,
  `.gp-diff th { text-align: left; padding: 0 0.625rem 0.625rem; border-bottom: ${hairline} solid ${c('hair')}; font: 500 ${v('type.scale.xs.size')}/1.2 ${mono}; letter-spacing: 0.08em; text-transform: uppercase; color: ${c('ink3')}; white-space: nowrap; }`,
  `.gp-diff th[data-num], .gp-diff td[data-num] { text-align: right; font-variant-numeric: ${v('type.numerals')}; }`,
  `.gp-diff td { padding: 0.6875rem 0.625rem; border-bottom: ${hairline} solid ${c('hair')}; vertical-align: middle; }`,
  `.gp-diff tr:last-child td { border-bottom: 0; }`,
  `.gp-diff tbody tr:hover td { background: ${c('glass')}; }`,
  `.gp-diff td[data-col="sheet"] { color: ${c('ink2')}; }`,
  `.gp-diff td[data-col="exported"], .gp-diff td[data-col="appNow"] { color: ${c('ink3')}; }`,
  `.gp-diff td[data-col="file"] { color: ${c('accent')}; }`,
  `.gp-diff tr[data-status="conflict"] td[data-col="appNow"] { color: ${c('warn')}; }`,
  `.gp-diff tr[data-status="removed"] td[data-col="item"] del { text-decoration-thickness: 0.0625rem; color: ${c('ink2')}; }`,
  `.gp-diff tr[data-status="removed"] td[data-col="file"] { color: ${c('neg')}; }`,
  `.gp-diff tr[data-status="removed"] td:not([data-col="take"]) { opacity: 0.75; }`,
  `.gp-diff-take { display: inline-flex; align-items: center; gap: 0.5rem; }`,
  `.gp-diff-chip { display: inline-flex; align-items: center; gap: 0.375rem; height: 1.625rem; padding: 0 0.625rem; box-sizing: border-box; border-radius: ${v('radius.pill')}; font-size: ${v('type.scale.xs.size')}; font-weight: 500; line-height: 1; white-space: nowrap; background: ${c('glass2')}; color: ${c('accent')}; }`,
  `.gp-diff-chip[data-tone="neg"] { color: ${c('neg')}; background: ${tint('neg', TINT_PCT)}; }`,
  `.gp-diff-chip[data-tone="warn"] { color: ${c('warn')}; background: ${tint('warn', TINT_PCT)}; }`,
  `.gp-sr-only { position: absolute; width: 0.0625rem; height: 0.0625rem; margin: -0.0625rem; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }`,
  `@media (max-width: 40rem) {\n  .gp-move { grid-template-columns: 1.375rem minmax(0, 1fr) 5.25rem; }\n  .gp-move-hit { grid-column: 2 / -1; }\n}`,
  `@media (prefers-reduced-motion: reduce) {\n  .gp-tnode { transition: none; }\n}`,
].join('\n');
