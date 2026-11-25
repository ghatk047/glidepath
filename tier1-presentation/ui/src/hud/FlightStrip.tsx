import { fmt } from '../format';
import { GlassPanel } from '../glass';
import { HudStyles } from './HudStyles';
import { RollValue } from './RollValue';
import { StatusChip } from './StatusChip';

/**
 * The progress track runs to 120% of the bar, with a tick at the bar (04 component inventory #3,
 * the UX display constant). It only positions marks; it is not a business number.
 */
export const TRACK_SCALE = 1.2;
const PERCENT = 100;

const clampPct = (n: number) => Math.min(PERCENT, Math.max(0, n));

/** Fill width in % of the track for a net and a bar from tier 2. Empty without a usable bar. */
export function trackFillPct(net: number | null | undefined, bar: number | null | undefined) {
  if (typeof net !== 'number' || typeof bar !== 'number') return 0;
  if (!Number.isFinite(net) || !Number.isFinite(bar) || bar <= 0) return 0;
  return clampPct((net / (bar * TRACK_SCALE)) * PERCENT);
}
/** Bar tick position in % of the track. */
export const BAR_TICK_PCT = PERCENT / TRACK_SCALE;

export interface FlightStripProps {
  /** res.net, $M. */
  net: number | null | undefined;
  /** res.bar, $M. */
  bar: number | null | undefined;
  /** res.gap, $M (>= 0 clear, < 0 short). */
  gap: number | null | undefined;
  /** res.risk, risk-adjusted net, $M. */
  risk: number | null | undefined;
  /** br.eps27, $ per share. */
  eps27: number | null | undefined;
  /** Hide the strip (the Cockpit screen has its own hero). The DOM stays mounted. */
  hidden?: boolean;
  /**
   * `phone` renders net, bar and gap only. Under 760 px the full strip also hides the track,
   * risk and EPS with CSS, so the web app can leave this at `full`.
   */
  variant?: 'full' | 'phone';
  className?: string;
}

/** Flight strip / HUD (`hud`): fixed bottom centre, glass, values from tier 2 by props. */
export function FlightStrip({
  net,
  bar,
  gap,
  risk,
  eps27,
  hidden = false,
  variant = 'full',
  className,
}: FlightStripProps) {
  const phone = variant === 'phone';
  return (
    <>
      <HudStyles />
      <GlassPanel
        as="aside"
        level={2}
        padding="none"
        className={className ? `gp-hud ${className}` : 'gp-hud'}
        aria-label="Flight strip"
        data-variant={variant}
        hidden={hidden}
      >
        <dl className="gp-hud-cells">
          <div className="gp-hud-cell" data-cell="net">
            <dt className="gp-hud-label">Net</dt>
            <dd className="gp-hud-value">
              <RollValue value={net} format={fmt.money} />
              {!phone && (
                <span className="gp-hud-prog" aria-hidden="true" data-testid="hud-track">
                  <i style={{ width: `${trackFillPct(net, bar)}%` }} />
                  <b style={{ left: `${BAR_TICK_PCT}%` }} />
                </span>
              )}
            </dd>
          </div>
          <div className="gp-hud-cell" data-cell="bar">
            <dt className="gp-hud-label">Bar</dt>
            <dd className="gp-hud-value">
              <RollValue value={bar} format={fmt.money} />
            </dd>
          </div>
          <div className="gp-hud-cell" data-cell="gap">
            <dt className="gp-hud-label">Gap</dt>
            <dd className="gp-hud-value">
              <StatusChip gap={gap} />
            </dd>
          </div>
          {!phone && (
            <>
              <div className="gp-hud-cell" data-cell="risk" data-phone="hide">
                <dt className="gp-hud-label">Risk-adj.</dt>
                <dd className="gp-hud-value">
                  <RollValue value={risk} format={fmt.money} />
                </dd>
              </div>
              <div className="gp-hud-cell" data-cell="eps27" data-phone="hide">
                <dt className="gp-hud-label">EPS 27</dt>
                <dd className="gp-hud-value">
                  <RollValue value={eps27} format={fmt.eps} />
                </dd>
              </div>
            </>
          )}
        </dl>
      </GlassPanel>
    </>
  );
}
