import type { BridgeView } from '@glidepath/api-contract';
import type { KeyboardEvent } from 'react';
import { fmt } from '../../format';
import {
  BRIDGE_OFFSETS as O,
  BRIDGE_PLOT,
  BRIDGE_VIEWBOX,
  bridgeDomain,
  bridgeGeometry,
  isLevelStep,
  type BridgeDomain,
  type BridgeStep,
  type BridgeStepKey,
} from './layout';
import { bridgeCss } from './styles';

export interface BridgeStepLabel {
  /** Category under the axis and the start of each mark's accessible name. */
  label: string;
  /** Tooltip line after the value. */
  hint?: string;
}

/** UX copy for the Cockpit "CY26 → CY27 outlay" panel (03_screens; prototype `waterfall` tips). */
export const DEFAULT_BRIDGE_LABELS: Readonly<Record<BridgeStepKey, Required<BridgeStepLabel>>> = {
  base: { label: 'CY26 base', hint: 'Normalized CY26 IT outlay' },
  growth: { label: 'Cost growth', hint: 'Status-quo CY27 growth to absorb' },
  savings: { label: 'Savings', hint: 'In-year lever savings' },
  oneTime: { label: 'One-time in IT', hint: 'Transition cost borne by the IT budget' },
  outlay: { label: 'CY27 outlay', hint: 'Projected CY27 IT outlay' },
};

/**
 * Props are the CON-02 `bridge` view payload as tier 2 sends it (spread it in), plus display
 * options. Item contract `Bridge(base, growth, iy, otIt, outlay, target)`: `steps` carries base,
 * growth, savings (in-year), one-time in IT and outlay with their bar extents; `targetOutlay` is
 * the target line; `gap` names the bracket.
 */
export interface BridgeProps extends BridgeView {
  /** Value axis [floor, ceiling] in $M. Defaults to `bridgeDomain(view)`. */
  domain?: BridgeDomain;
  /** Per-step copy overrides (e.g. another tenant's fiscal years). */
  labels?: Partial<Record<BridgeStepKey, BridgeStepLabel>>;
  /** Label of the dashed line. */
  targetLabel?: string;
  /** Makes bars keyboard buttons; called with the step (its `cell` opens the trace drawer). */
  onStep?: (step: BridgeStep) => void;
  className?: string;
}

/** Injects the bridge CSS once (React 19 hoists and de-duplicates `<style href precedence>`). */
function BridgeStyles() {
  return (
    <style href="glidepath-bridge" precedence="glidepath">
      {bridgeCss}
    </style>
  );
}

/** Axis-break zigzag (prototype): two teeth, relative to its start. */
const BREAK_ZIGZAG = 'l6 -5 6 5 6 -5';

const stepText = (step: BridgeStep) =>
  isLevelStep(step.key) ? fmt.money(step.value) : fmt.signed(step.value);

/** Bridge / waterfall (#19): CY26 base → growth → savings → one-time in IT → CY27 outlay. */
export function Bridge({
  steps,
  targetOutlay,
  gap,
  domain,
  labels,
  targetLabel = 'Target outlay',
  onStep,
  className,
}: BridgeProps) {
  const view = { steps, targetOutlay };
  const axis = domain ?? bridgeDomain(view);
  const g = bridgeGeometry(view, axis);
  const copy = (key: BridgeStepKey) => ({ ...DEFAULT_BRIDGE_LABELS[key], ...labels?.[key] });
  const first = g.bars[0]!;
  const last = g.bars[g.bars.length - 1]!;
  const targetText = `${targetLabel} ${fmt.money(targetOutlay)}`;
  // the target label sits under the line at the right edge of the savings bar (prototype)
  const savings = g.bars.find((b) => b.step.key === 'savings') ?? first;
  const bracketX = last.x + last.width + O.bracketInset;
  const floorY = BRIDGE_PLOT.bottom;

  const activate = (step: BridgeStep) => onStep?.(step);
  const onKey = (step: BridgeStep) => (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      activate(step);
    }
  };

  return (
    <>
      <BridgeStyles />
      <svg
        className={className ? `gp-bridge ${className}` : 'gp-bridge'}
        viewBox={`0 0 ${BRIDGE_VIEWBOX.width} ${BRIDGE_VIEWBOX.height}`}
        role="group"
        aria-label={`Bridge from ${copy(first.step.key).label} to ${copy(last.step.key).label}`}
      >
        <g aria-hidden="true" data-part="axis">
          {g.ticks.map((t) => (
            <g key={t}>
              <line
                className="gp-bridge-grid"
                x1={BRIDGE_PLOT.left}
                x2={BRIDGE_PLOT.right}
                y1={g.y(t)}
                y2={g.y(t)}
              />
              <text
                data-part="tick"
                x={BRIDGE_PLOT.left - O.tickLabel}
                y={g.y(t) + O.tickBaseline}
                textAnchor="end"
              >
                {fmt.fte(t)}
              </text>
            </g>
          ))}
          <path
            className="gp-bridge-break"
            data-part="axis-break"
            d={`M${BRIDGE_PLOT.left - O.breakInset} ${floorY - O.tickBaseline}${BREAK_ZIGZAG}`}
          />
        </g>

        {g.bars.slice(0, -1).map((b, i) => {
          const next = g.bars[i + 1]!;
          return (
            <line
              key={`c-${b.step.key}`}
              className="gp-bridge-connector"
              data-part="connector"
              aria-hidden="true"
              x1={b.x + b.width}
              x2={next.x}
              y1={b.yTo}
              y2={b.yTo}
            />
          );
        })}

        {g.bars.map((b) => {
          const { label, hint } = copy(b.step.key);
          const name = `${label} ${stepText(b.step)}`;
          const interactive = onStep !== undefined;
          return (
            <g
              key={b.step.key}
              className="gp-bridge-step"
              data-step={b.step.key}
              data-cell={b.step.cell ?? undefined}
              role={interactive ? 'button' : 'img'}
              aria-label={name}
              tabIndex={interactive ? 0 : undefined}
              onClick={interactive ? () => activate(b.step) : undefined}
              onKeyDown={interactive ? onKey(b.step) : undefined}
            >
              <title>{hint ? `${name} · ${hint}` : name}</title>
              <rect
                className="gp-bridge-bar"
                data-step={b.step.key}
                x={b.x}
                y={b.y}
                width={b.width}
                height={b.height}
                rx={5}
              />
              <text
                className="gp-bridge-value"
                data-part="value"
                aria-hidden="true"
                x={b.cx}
                y={b.y - O.valueLabel}
                textAnchor="middle"
              >
                {stepText(b.step)}
              </text>
              <text
                data-part="category"
                aria-hidden="true"
                x={b.cx}
                y={floorY + O.categoryLabel}
                textAnchor="middle"
              >
                {label}
              </text>
            </g>
          );
        })}

        <g role="img" aria-label={targetText} data-part="target-mark">
          <title>{targetText}</title>
          <line
            className="gp-bridge-target"
            data-part="target"
            x1={BRIDGE_PLOT.left}
            x2={BRIDGE_PLOT.right}
            y1={g.yTarget}
            y2={g.yTarget}
          />
          <text
            className="gp-bridge-target-label"
            data-part="target-label"
            aria-hidden="true"
            x={savings.x + savings.width}
            y={g.yTarget + O.targetLabel}
            textAnchor="middle"
          >
            {targetText}
          </text>
        </g>

        {gap > 0 && (
          <g role="img" aria-label={`Gap to ${targetLabel.toLowerCase()} ${fmt.money(gap)}`}>
            <title>{`Gap to ${targetLabel.toLowerCase()} ${fmt.money(gap)}`}</title>
            <path
              className="gp-bridge-gap"
              data-part="gap"
              d={`M${bracketX} ${last.yTo}h${O.bracketArm}v${g.yTarget - last.yTo}h-${O.bracketArm}`}
            />
          </g>
        )}
      </svg>
    </>
  );
}
