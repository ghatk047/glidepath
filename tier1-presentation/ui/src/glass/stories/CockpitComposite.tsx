/**
 * Composite story: the Cockpit panel layout (docs/ux/screens/cockpit-*-1440.jpg) built from
 * glass primitives only, with skeleton bodies (no values: values come from tier 2).
 * Used by the glass tests (blur budget, layout snapshot, a11y) and the G11 render.
 */
import { GlassPanel } from '../GlassPanel';
import { Aurora } from '../Aurora';
import { Grid, GridCell } from '../Grid';
import { Skeleton } from '../Skeleton';

export interface CockpitCompositeProps {
  /** Show every panel loading. */
  loading?: boolean;
  /** Add overlays (popover, palette, trace drawer at level 3; a raised control at level 2). */
  overlays?: boolean;
}

const VP_TILES = ['vp-1', 'vp-2', 'vp-3', 'vp-4'];

export function CockpitComposite({ loading = false, overlays = false }: CockpitCompositeProps) {
  return (
    <>
      <Aurora />
      <main>
        <Grid data-testid="cockpit-grid">
          <GlassPanel
            span={5}
            loading={loading}
            header={{ label: 'Net savings · CY27', status: <span>Scenario</span> }}
            data-testid="hero"
          >
            <Skeleton size="block" ratio="1 / 1" width="80%" />
            <Skeleton size="label" width="30%" />
            <Skeleton size="mid" width="50%" />
          </GlassPanel>
          <GridCell span={7} stack data-testid="outlay+inputs">
            <GlassPanel
              loading={loading}
              header={{ label: 'CY26 → CY27 outlay', status: <span>axis note</span> }}
            >
              <Skeleton size="block" ratio="3 / 1" />
            </GlassPanel>
            <GlassPanel loading={loading} header={{ label: 'Your inputs' }}>
              <Skeleton size="text" width="70%" />
              <Skeleton size="text" width="45%" />
            </GlassPanel>
          </GridCell>
          {VP_TILES.map((id) => (
            <GlassPanel
              key={id}
              span={3}
              padding="tight"
              loading={loading}
              header={{ label: id, labelAs: 'h3' }}
              data-testid={id}
            >
              <Skeleton size="mid" width="60%" />
              <Skeleton size="text" width="40%" />
            </GlassPanel>
          ))}
          <GlassPanel span={4} loading={loading} header={{ label: 'Shareholder view · 2027' }}>
            <Skeleton size="big" width="60%" />
          </GlassPanel>
          <GlassPanel span={4} loading={loading} header={{ label: 'Odds' }}>
            <Skeleton size="block" ratio="2 / 1" />
          </GlassPanel>
          <GlassPanel span={4} loading={loading} header={{ label: 'Fastest path to the bar' }}>
            <Skeleton size="big" width="55%" />
            <Skeleton size="text" width="90%" />
          </GlassPanel>
        </Grid>
      </main>
      {overlays && (
        <>
          <GlassPanel level={2} as="div" padding="tight" data-testid="raised">
            <Skeleton size="text" width="50%" />
          </GlassPanel>
          <GlassPanel
            level={3}
            as="div"
            role="dialog"
            aria-label="Edit popover"
            data-testid="popover"
          >
            <Skeleton size="text" width="60%" />
          </GlassPanel>
          <GlassPanel
            level={3}
            as="div"
            role="dialog"
            aria-label="Command palette"
            data-testid="palette"
          >
            <Skeleton size="text" width="60%" />
          </GlassPanel>
          <GlassPanel level={3} as="aside" aria-label="Trace drawer" data-testid="drawer">
            <Skeleton size="text" width="60%" />
          </GlassPanel>
        </>
      )}
    </>
  );
}
