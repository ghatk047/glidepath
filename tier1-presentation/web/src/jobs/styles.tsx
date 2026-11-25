/**
 * Job header and empty-state CSS, generated from the token map (same approach as the ui HUD):
 * every colour, size and motion value comes from tokens; lengths without a token are rem/em
 * or calc() of a token. No hex, no raw px.
 */
import { cssVar, defaultTheme, type TokenPath } from '@glidepath/ui/tokens';

const v = (p: TokenPath) => cssVar[p];
type ColorKey = 'ink' | 'ink2' | 'ink3' | 'accent' | 'track' | 'neg';
const c = (k: ColorKey) => cssVar[`themes.${defaultTheme}.color.${k}` as TokenPath];
const part = (p: TokenPath, num: number, den: number) => `calc(${v(p)} * ${num} / ${den})`;

export const jobsCss = [
  '/* web/src/jobs: generated from tokens in styles.tsx */',
  // ---- job header: inline in the panel header's status area
  `.gp-job { display: inline-flex; align-items: center; gap: ${part('space.gap', 2, 3)}; min-width: 0; position: relative; font-size: ${part('type.scale.s.size', 12, 13)}; color: ${c('ink2')}; }`,
  `.gp-job > .gp-compute, .gp-job-starting > .gp-compute { flex: none; }`,
  `.gp-job-starting { display: inline-flex; align-items: center; gap: ${part('space.gap', 2, 3)}; min-width: 0; font-size: ${part('type.scale.s.size', 12, 13)}; color: ${c('ink2')}; }`,
  `.gp-job-note { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }`,
  `.gp-job-bar { display: block; flex: none; width: 5rem; height: 0.25rem; border-radius: 0.25rem; background: ${c('track')}; overflow: hidden; }`,
  `.gp-job-bar i { display: block; height: 100%; border-radius: inherit; background: ${c('accent')}; transform-origin: left center; transform: scaleX(var(--gp-job-progress, 0)); transition: transform ${v('motion.value')} ${v('motion.ease')}; }`,
  `.gp-job-bar[data-indeterminate] i { transform: none; opacity: 0.4; }`,
  `.gp-job-cancel { flex: none; appearance: none; background: none; border: 0; padding: 0; font: inherit; color: ${c('accent')}; text-decoration: underline; cursor: pointer; }`,
  `.gp-job-cancel:focus-visible { outline: 0.125rem solid ${c('accent')}; outline-offset: 0.125rem; border-radius: 0.125rem; }`,
  `.gp-job-cancelling { flex: none; color: ${c('ink3')}; }`,
  `.gp-job-problem { color: ${c('neg')}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }`,
  `.gp-job-end { display: inline-flex; align-items: center; gap: ${part('space.gap', 1, 3)}; font-size: ${part('type.scale.s.size', 12, 13)}; color: ${c('ink2')}; white-space: nowrap; }`,
  `.gp-job-end[data-tone="neg"] { color: ${c('neg')}; }`,
  `.gp-job-sr { position: absolute; width: 0.0625rem; height: 0.0625rem; margin: -0.0625rem; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }`,
  // ---- empty state: one line, one action
  `.gp-empty { display: flex; flex-direction: column; align-items: flex-start; gap: ${v('space.gap')}; padding: ${v('space.gap')} 0; }`,
  `.gp-empty-line { margin: 0; font-size: ${v('type.scale.m.size')}; color: ${c('ink2')}; }`,
  `.gp-empty-action { appearance: none; font: inherit; font-weight: 500; color: ${c('ink')}; background: transparent; border: ${part('space.gap', 1, 9)} solid ${c('accent')}; border-radius: ${v('radius.pill')}; padding: ${part('space.gap', 1, 3)} ${v('space.gap')}; cursor: pointer; }`,
  `.gp-empty-action:disabled { opacity: 0.5; cursor: default; }`,
  `.gp-empty-action:focus-visible { outline: 0.125rem solid ${c('accent')}; outline-offset: 0.125rem; }`,
  `@media (prefers-reduced-motion: reduce) {\n  .gp-job-bar i { transition: none; }\n}`,
].join('\n');

/** Injects the CSS once (React 19 hoists and de-duplicates `<style href precedence>`). */
export function JobsStyles() {
  return (
    <style href="glidepath-jobs" precedence="glidepath">
      {jobsCss}
    </style>
  );
}
