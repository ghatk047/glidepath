/**
 * Histogram and tornado CSS, generated from the token map (colours, type). Matches
 * docs/ux/prototype/src/styles.css (`svg.chart`, `.chart text`, `.chart .ref`). Chart geometry is
 * in viewBox units (the svg scales to its panel), so no raw px and no hex appear here.
 */
import { cssVar, defaultTheme, type TokenPath } from '../../tokens';

type ColorKey = 'ink' | 'ink2' | 'ink3' | 'accent' | 'pos' | 'warn';
const color = (k: ColorKey) => cssVar[`themes.${defaultTheme}.color.${k}` as TokenPath];
/** Levers are blue: the third step of the sequential ramp (prototype `--seq-3`). */
const lever = cssVar[`themes.${defaultTheme}.color.sequential.2` as TokenPath];

const mono = `${cssVar['type.families.mono']}, ui-monospace, monospace`;
const ui = `${cssVar['type.families.ui']}, ui-sans-serif, system-ui, sans-serif`;
const xs = cssVar['type.scale.xs.size'];
const xsWeight = cssVar['type.scale.xs.weight'];

export const chartsDistCss = [
  '/* @glidepath/ui charts/distribution: generated from tokens in src/charts/distribution/styles.ts */',
  `.gp-chart { display: block; width: 100%; height: auto; overflow: visible; }`,
  `.gp-chart text { fill: ${color('ink3')}; font: ${xsWeight} ${xs} ${mono}; font-variant-numeric: ${cssVar['type.numerals']}; }`,
  `.gp-chart .gp-chart-ink2 { fill: ${color('ink2')}; }`,
  `.gp-chart .gp-chart-ref { stroke: ${color('ink')}; stroke-width: 1.2; stroke-dasharray: 4 4; opacity: 0.75; }`,
  // ---- histogram: bins past the bar are status green
  `.gp-hist-bin { fill: ${color('accent')}; opacity: 0.85; }`,
  `.gp-hist-bin[data-tone="pos"] { fill: ${color('pos')}; }`,
  // ---- tornado: amber for policy and timing inputs, blue for levers
  `.gp-chart .gp-tornado-label { fill: ${color('ink2')}; font: 500 ${xs} ${ui}; }`,
  `.gp-tornado-bar { fill: ${lever}; opacity: 0.9; }`,
  `.gp-tornado-bar[data-category="policy"], .gp-tornado-bar[data-category="timing"] { fill: ${color('warn')}; }`,
].join('\n');
