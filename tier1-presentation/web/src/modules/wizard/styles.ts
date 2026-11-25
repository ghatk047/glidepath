import { DESKTOP_QUERY } from '@glidepath/ui/glass';
import { rem, TOUCH_TARGET } from '@glidepath/ui/shell';
import { media } from '@glidepath/ui/tokens';

/**
 * Wizard frame, stepper, tape and steps 1-2 (WIZ-05). Token CSS vars only; metrics with no token
 * are rem. Bars and meters are drawn by CSS from `--value` / `--max` (tier 2's numbers): no
 * arithmetic happens in tier 1. Animation touches transform and opacity only, and is off under
 * reduced motion.
 */
const line = `${rem(1)} solid var(--glass-line)`;
const focus = `outline: ${rem(2)} solid var(--accent); outline-offset: ${rem(2)};`;
const mono = 'var(--font-mono), ui-monospace, monospace';
const num = 'var(--font-num), var(--font-ui), system-ui, sans-serif';
const eyebrow = `font: var(--type-xs-weight) var(--type-xs-size)/1.2 ${mono}; letter-spacing: var(--type-xs-tracking); text-transform: uppercase; color: var(--ink-3); margin: 0;`;
const ease = 'var(--motion-value) var(--motion-ease)';

export const wizardCss = [
  '/* web modules/wizard: generated from tokens in src/modules/wizard/styles.ts */',
  `.gp-module.gp-wizard { min-width: 0; padding: 0; display: flex; flex-direction: column; gap: ${rem(14)}; }`,
  `.gp-wz-eyebrow { ${eyebrow} }`,
  // ---- stepper
  `.gp-wz-stepper { display: flex; align-items: center; justify-content: space-between; gap: ${rem(12)}; flex-wrap: wrap; }`,
  `.gp-wz-steps { list-style: none; margin: 0; padding: 0; display: flex; align-items: center; gap: ${rem(4)}; min-width: 0; }`,
  `.gp-wz-steps li { display: flex; align-items: center; }`,
  `.gp-wz-steps li + li::before { content: ""; display: block; width: ${rem(20)}; height: ${rem(1)}; margin: 0 ${rem(4)}; background: var(--glass-line); }`,
  `.gp-wz-step { display: inline-flex; align-items: center; gap: ${rem(8)}; min-height: ${rem(40)}; padding: 0 ${rem(14)} 0 ${rem(6)}; border-radius: var(--radius-pill); border: ${rem(1)} solid transparent; background: transparent; color: var(--ink-3); font: 500 var(--type-s-size)/1 var(--font-ui), system-ui, sans-serif; cursor: pointer; transition: background ${ease}, color ${ease}, border-color ${ease}; }`,
  `.gp-wz-step:hover { color: var(--ink); background: var(--glass); }`,
  `.gp-wz-step:focus-visible { ${focus} }`,
  `.gp-wz-step[aria-current="step"] { color: var(--ink); background: var(--glass-2); border-color: var(--glass-line); }`,
  `.gp-wz-dot { display: inline-grid; place-items: center; width: ${rem(26)}; height: ${rem(26)}; border-radius: var(--radius-pill); border: ${line}; font: var(--type-xs-weight) var(--type-xs-size)/1 ${mono}; color: var(--ink-2); transition: background ${ease}, color ${ease}, transform ${ease}; }`,
  `.gp-wz-step[aria-current="step"] .gp-wz-dot { background: var(--accent); color: var(--accent-ink); border-color: transparent; transform: scale(1.08); }`,
  `.gp-wz-navbtns { display: flex; gap: ${rem(8)}; }`,
  `.gp-wz-btn { display: inline-flex; align-items: center; justify-content: center; gap: ${rem(8)}; min-height: ${rem(40)}; padding: 0 ${rem(18)}; border-radius: var(--radius-control); border: ${line}; background: var(--glass-2); color: var(--ink); font: 500 var(--type-s-size)/1 var(--font-ui), system-ui, sans-serif; cursor: pointer; transition: background ${ease}, transform ${ease}, opacity ${ease}; }`,
  `.gp-wz-btn:hover:not(:disabled) { background: var(--glass-3); }`,
  `.gp-wz-btn:active:not(:disabled) { transform: scale(.98); }`,
  `.gp-wz-btn:focus-visible { ${focus} }`,
  `.gp-wz-btn:disabled { opacity: .4; cursor: default; }`,
  `.gp-wz-btn[data-variant="primary"] { background: var(--accent); color: var(--accent-ink); border-color: transparent; box-shadow: 0 ${rem(10)} ${rem(30)} ${rem(-10)} var(--accent-glow); }`,
  // ---- tape
  `.gp-panel.gp-wz-tape[data-pad] { position: sticky; top: 0; z-index: 5; padding: ${rem(12)} ${rem(18)}; }`,
  // GlassPanel wraps its children in `.gp-body`: that is the tape's row.
  `.gp-wz-tape > .gp-body { display: flex; align-items: center; gap: ${rem(14)}; flex-wrap: wrap; }`,
  `.gp-wz-term { display: flex; flex-direction: column; gap: ${rem(2)}; min-width: 0; }`,
  `.gp-wz-term .gp-value, .gp-wz-term [data-value] { font-family: ${num}; font-variant-numeric: tabular-nums; font-size: var(--type-l-size); color: var(--ink); }`,
  `.gp-wz-term[data-term="net"] .gp-value { font-size: var(--type-xl-size); font-weight: var(--type-xl-weight); }`,
  `.gp-wz-term[data-term="bar"] .gp-value { color: var(--ink-2); }`,
  `.gp-wz-op { font-family: ${num}; color: var(--ink-3); font-size: var(--type-l-size); align-self: flex-end; padding-bottom: ${rem(2)}; }`,
  `.gp-wz-meter { flex: 1 1 ${rem(120)}; min-width: ${rem(80)}; height: ${rem(6)}; border-radius: var(--radius-pill); background: var(--track); overflow: hidden; }`,
  `.gp-wz-meter > i { display: block; height: 100%; width: calc(100% * var(--value, 0) / var(--max, 1)); max-width: 100%; border-radius: inherit; background: var(--accent); transition: width ${ease}; }`,
  `.gp-wz-tape-act { display: flex; align-items: center; gap: ${rem(10)}; margin-left: auto; min-width: 0; }`,
  `.gp-wz-tape-act .gp-wz-btn { min-width: ${rem(120)}; }`,
  `.gp-wz-tape[data-busy="true"] .gp-wz-btn[data-wizard-optimize] { opacity: .75; }`,
  // ---- step stage
  `.gp-wz-stage { min-width: 0; }`,
  `.gp-wz-stage > [data-wizard-step] { animation: gp-wz-in var(--motion-value) var(--motion-ease) both; }`,
  `@keyframes gp-wz-in { from { opacity: 0; transform: translateY(${rem(8)}); } to { opacity: 1; transform: none; } }`,
  // ---- step 1
  `.gp-wz-family { display: flex; justify-content: space-between; align-items: baseline; margin: ${rem(14)} 0 ${rem(4)}; }`,
  `.gp-wz-group:first-child .gp-wz-family { margin-top: 0; }`,
  `.gp-wz-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }`,
  `.gp-wz-row { display: grid; grid-template-columns: auto minmax(0, 1fr) auto auto; column-gap: ${rem(12)}; align-items: center; padding: ${rem(6)} ${rem(8)}; border-radius: var(--radius-card); border: ${rem(1)} solid transparent; transition: background ${ease}; }`,
  `.gp-wz-row:hover { background: var(--glass); }`,
  `.gp-wz-main { min-width: 0; display: flex; flex-direction: column; gap: ${rem(4)}; transition: opacity ${ease}; }`,
  `.gp-wz-name { display: block; width: 100%; text-align: left; border: 0; background: transparent; color: var(--ink); font: inherit; padding: 0; min-height: ${rem(24)}; cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }`,
  `.gp-wz-name:hover { color: var(--accent-ink); }`,
  `.gp-wz-name:focus-visible { ${focus} }`,
  `.gp-wz-bar { display: block; height: ${rem(3)}; border-radius: var(--radius-pill); background: var(--track); overflow: hidden; }`,
  `.gp-wz-bar > i { display: block; height: 100%; width: calc(100% * var(--value, 0) / var(--max, 1)); max-width: 100%; background: var(--accent); border-radius: inherit; transition: width ${ease}; }`,
  `.gp-wz-iy { font-family: ${num}; font-variant-numeric: tabular-nums; color: var(--ink); text-align: right; min-width: ${rem(64)}; transition: opacity ${ease}; }`,
  `.gp-wz-conf { font-family: ${num}; font-variant-numeric: tabular-nums; color: var(--ink-3); font-size: var(--type-s-size); min-width: ${rem(40)}; text-align: right; }`,
  `.gp-wz-row[data-off="true"] .gp-wz-main, .gp-wz-row[data-off="true"] .gp-wz-iy, .gp-wz-row[data-off="true"] .gp-wz-conf { opacity: .4; }`,
  `.gp-wz-fam-row { display: flex; flex-direction: column; gap: ${rem(6)}; padding: ${rem(8)} 0; }`,
  `.gp-wz-fam-head { display: flex; justify-content: space-between; align-items: baseline; gap: ${rem(8)}; color: var(--ink-2); font-size: var(--type-s-size); }`,
  `.gp-wz-fam-head [data-value], .gp-wz-fam-head .gp-value { font-family: ${num}; font-variant-numeric: tabular-nums; color: var(--ink); }`,
  `.gp-wz-fam-bar { display: block; height: ${rem(8)}; border-radius: var(--radius-pill); background: var(--track); overflow: hidden; }`,
  `.gp-wz-fam-bar > i { display: block; height: 100%; width: calc(100% * var(--value, 0) / var(--max, 1)); max-width: 100%; background: var(--accent); border-radius: inherit; transition: width ${ease}; }`,
  `.gp-wz-total { display: flex; justify-content: space-between; align-items: baseline; margin-top: ${rem(12)}; padding-top: ${rem(12)}; border-top: ${line}; }`,
  `.gp-wz-total .gp-value { font-family: ${num}; font-variant-numeric: tabular-nums; font-size: var(--type-xl-size); color: var(--ink); }`,
  // ---- step 2
  `.gp-wz-chosen { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: ${rem(2)}; }`,
  `.gp-wz-pick { display: flex; align-items: center; gap: ${rem(10)}; width: 100%; min-height: ${rem(40)}; padding: ${rem(6)} ${rem(10)}; border-radius: var(--radius-card); border: ${rem(1)} solid transparent; background: transparent; color: var(--ink); font: inherit; text-align: left; cursor: pointer; transition: background ${ease}, border-color ${ease}; }`,
  `.gp-wz-pick:hover { background: var(--glass); }`,
  `.gp-wz-pick:focus-visible { ${focus} }`,
  `.gp-wz-pick[aria-pressed="true"] { background: var(--glass-2); border-color: var(--glass-line); }`,
  `.gp-wz-pick > span:first-child { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }`,
  // The tape's gap chip: ink text with a neg outline, so the label keeps 4.5:1 on the tinted pill in
  // both themes (neg text on its own tint is 3.8:1 in Daylight, and the tape sits under the tour scrim).
  `.gp-wz-tape .gp-chip[data-tone="neg"] { color: var(--ink); border-color: var(--neg); }`,
  `.gp-wz-pick-row { display: flex; align-items: center; gap: ${rem(6)}; border-radius: var(--radius-card); }`,
  `.gp-wz-pick-row[data-on] { background: var(--glass-2); }`,
  `.gp-wz-pick-row .gp-wz-pick { flex: 1; min-width: 0; }`,
  `.gp-wz-pick-row .gp-wz-pick-iy, .gp-wz-pick-row .gp-value-wrap { flex: none; padding-right: ${rem(10)}; font-family: ${num}; font-variant-numeric: tabular-nums; color: var(--ink-2); }`,
  `.gp-wz-empty { color: var(--ink-3); font-size: var(--type-m-size); margin: 0; }`,
  `.gp-wz-title { margin: 0 0 ${rem(16)}; font-size: var(--type-xl-size); font-weight: var(--type-xl-weight); letter-spacing: var(--type-xl-tracking); color: var(--ink); }`,
  `.gp-wz-kpis { display: grid; grid-template-columns: 1.3fr 1fr 1fr; gap: ${rem(12)}; margin-bottom: ${rem(20)}; }`,
  `.gp-wz-kpi { display: flex; flex-direction: column; gap: ${rem(6)}; padding: ${rem(14)} ${rem(16)}; border-radius: var(--radius-card); border: ${line}; background: var(--glass); min-width: 0; }`,
  `.gp-wz-kpi .gp-value, .gp-wz-kpi [data-value] { font-family: ${num}; font-variant-numeric: tabular-nums; font-size: var(--type-l-size); color: var(--ink); }`,
  `.gp-wz-kpi[data-hero="true"] .gp-value, .gp-wz-kpi[data-hero="true"] [data-value] { font-size: var(--type-xl-size); }`,
  `.gp-wz-sliders { display: flex; flex-direction: column; gap: ${rem(14)}; margin-bottom: ${rem(16)}; }`,
  `.gp-wz-slide { position: relative; }`,
  `.gp-wz-slide[data-moved] { padding-left: ${rem(14)}; }`,
  `.gp-wz-slide[data-moved]::before { content: ""; position: absolute; left: 0; top: ${rem(8)}; width: ${rem(8)}; height: ${rem(8)}; border-radius: var(--radius-pill); background: var(--accent); box-shadow: 0 0 ${rem(10)} var(--accent-glow); }`,
  `.gp-wz-details { border-top: ${line}; padding-top: ${rem(12)}; }`,
  `.gp-wz-details > summary { ${eyebrow} cursor: pointer; list-style: none; display: flex; align-items: center; gap: ${rem(8)}; min-height: ${rem(28)}; }`,
  `.gp-wz-details > summary::-webkit-details-marker { display: none; }`,
  `.gp-wz-details > summary::before { content: "▸"; transition: transform ${ease}; display: inline-block; }`,
  `.gp-wz-details[open] > summary::before { transform: rotate(90deg); }`,
  `.gp-wz-details > summary:focus-visible { ${focus} }`,
  `.gp-wz-details .gp-wz-sliders { margin-top: ${rem(12)}; margin-bottom: 0; }`,
  `.gp-wz-dial { display: flex; align-items: center; gap: ${rem(12)}; margin-top: ${rem(12)}; }`,
  `.gp-wz-off { display: flex; align-items: center; gap: ${rem(12)}; color: var(--ink-2); margin-bottom: ${rem(16)}; }`,
  // ---- phone
  `@media ${media.phone} {`,
  `  .gp-wz-stepper { gap: ${rem(8)}; }`,
  `  .gp-wz-steps li + li::before { width: ${rem(8)}; }`,
  `  .gp-wz-step { padding: 0 ${rem(8)} 0 ${rem(4)}; min-height: ${TOUCH_TARGET}; }`,
  `  .gp-wz-step .gp-wz-step-label { display: none; }`,
  `  .gp-wz-step[aria-current="step"] .gp-wz-step-label { display: inline; }`,
  `  .gp-wz-btn { min-height: ${TOUCH_TARGET}; }`,
  `  .gp-panel.gp-wz-tape[data-pad] { padding: ${rem(10)} ${rem(14)}; }`,
  `  .gp-wz-tape > .gp-body { gap: ${rem(10)}; }`,
  `  .gp-wz-tape-act { margin-left: 0; width: 100%; }`,
  `  .gp-wz-tape-act .gp-wz-btn { flex: 1; }`,
  `  .gp-wz-term[data-term="inyear"], .gp-wz-term[data-term="onetime"], .gp-wz-op[data-op="minus"] { order: 2; }`,
  `  .gp-wz-meter { order: 3; flex-basis: 100%; }`,
  `  .gp-wz-kpis { grid-template-columns: 1fr 1fr 1fr; gap: ${rem(8)}; }`,
  `  .gp-wz-chosen { flex-direction: row; overflow-x: auto; gap: ${rem(6)}; padding-bottom: ${rem(4)}; }`,
  `  .gp-wz-pick { width: auto; flex: none; border-color: var(--glass-line); border-radius: var(--radius-pill); }`,
  `  .gp-wz-row { column-gap: ${rem(8)}; }`,
  `  .gp-wz-row .gp-wz-conf { display: none; }`,
  `}`,
  // desktop (UIX-01): the 20 levers of step 1 sit in two columns, family by family, so the step
  // fits a 1280x720 screen; rows lose some air
  `@media ${DESKTOP_QUERY} {`,
  `  .gp-wz-levers > .gp-body { columns: 2; column-gap: ${rem(24)}; }`,
  `  .gp-wz-levers .gp-wz-group { break-inside: avoid; }`,
  `  .gp-wz-family { margin: ${rem(8)} 0 ${rem(2)}; }`,
  `  .gp-wz-row { padding: ${rem(3)} ${rem(6)}; column-gap: ${rem(10)}; }`,
  `  .gp-wz-fam-row { padding: ${rem(5)} 0; gap: ${rem(4)}; }`,
  `}`,
  `@media (prefers-reduced-motion: reduce) {`,
  `  .gp-wz-stage > [data-wizard-step] { animation: none; }`,
  `  .gp-wz-step, .gp-wz-dot, .gp-wz-btn, .gp-wz-row, .gp-wz-bar > i, .gp-wz-fam-bar > i, .gp-wz-meter > i, .gp-wz-pick, .gp-wz-main, .gp-wz-iy, .gp-wz-details > summary::before { transition: none; }`,
  `}`,
].join('\n');
