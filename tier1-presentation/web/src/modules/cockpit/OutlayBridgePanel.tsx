import { Bridge, bridgeDomain } from '@glidepath/ui/charts/bridge';
import { fmt } from '@glidepath/ui/format';
import { GlassPanel, Skeleton } from '@glidepath/ui/glass';
import { useBindContext, useView } from '../../bind';
import { COPY } from './copy';

export interface OutlayBridgePanelProps {
  /** `CY26`, `CY27` from the tenant row. */
  fromYear: string | null;
  toYear: string | null;
}

const NO_PARAMS = {};

/** The axis floor as the header reads it ("axis starts at $840M"). */
const axisFloor = (v: number) => fmt.money(v, { digits: 0 });

/**
 * CY26 → CY27 outlay (7 cols): the tier 2 `bridge` view (ADR-021, DOM-06), whose five steps
 * carry `base.total`, `base.headwinds`, `res.tot_iy`, `res.tot_ot_it` and `res.cy27_outlay`
 * with their bar extents, plus the target outlay line and the gap bracket. Drawn as sent; a bar
 * opens the trace drawer for its cell when the shell has one.
 */
export function OutlayBridgePanel({ fromYear, toYear }: OutlayBridgePanelProps) {
  const { onTrace } = useBindContext();
  const bridge = useView('bridge', NO_PARAMS);
  const view = bridge.payload;
  const domain = view ? bridgeDomain(view) : null;

  return (
    <GlassPanel
      data-testid="cockpit-bridge"
      header={{
        label:
          fromYear && toYear ? (
            COPY.bridgeLabel(fromYear, toYear)
          ) : (
            <Skeleton size="label" width="40%" />
          ),
        status: domain ? (
          <span className="gp-cockpit-axis">{COPY.axisNote(axisFloor(domain[0]))}</span>
        ) : undefined,
      }}
      loading={bridge.isLoading}
      skeleton={<Skeleton size="block" ratio="3 / 1" />}
    >
      {view && domain && (
        <div data-stale={bridge.stale || undefined}>
          <Bridge
            {...view}
            domain={domain}
            {...(onTrace
              ? { onStep: (s: { cell: string | null }) => s.cell && onTrace(s.cell) }
              : {})}
          />
        </div>
      )}
    </GlassPanel>
  );
}
