import { FlightStrip } from '@glidepath/ui/hud';
import { GlassPanel, Skeleton } from '@glidepath/ui/glass';
import { useNode } from '../../bind';

/** Spec ids of the flight strip (inventory #3), verbatim. */
export const HUD_NODES = {
  net: 'res.net',
  bar: 'res.bar',
  gap: 'res.gap',
  risk: 'res.risk',
  eps27: 'br.eps27',
} as const;

/**
 * Flight strip bound to tier 2 (IA §2): `useNode` on `res.net`, `res.bar`, `res.gap`,
 * `res.risk`, `br.eps27`. Values are handed to the ui strip as pushed; it rolls them.
 * Hidden on Cockpit (the same numbers are the hero there); the subscriptions stay, so the
 * strip is current when it shows again. Until the first values arrive it rests as skeletons.
 */
export function BoundFlightStrip({ hidden = false }: { hidden?: boolean }) {
  const net = useNode(HUD_NODES.net);
  const bar = useNode(HUD_NODES.bar);
  const gap = useNode(HUD_NODES.gap);
  const risk = useNode(HUD_NODES.risk);
  const eps27 = useNode(HUD_NODES.eps27);
  const cells = [net, bar, gap, risk, eps27];
  const loading = cells.every((c) => c.value === undefined);
  const stale = cells.some((c) => c.stale);

  if (loading) {
    return (
      <GlassPanel
        as="aside"
        level={2}
        padding="tight"
        className="gp-hud-loading"
        aria-label="Flight strip"
        loading
        hidden={hidden}
        data-hud-loading=""
        skeleton={<Skeleton size="mid" width="100%" />}
      />
    );
  }
  return (
    <div data-stale={stale || undefined} data-hud="">
      <FlightStrip
        net={net.value}
        bar={bar.value}
        gap={gap.value}
        risk={risk.value}
        eps27={eps27.value}
        hidden={hidden}
      />
    </div>
  );
}
