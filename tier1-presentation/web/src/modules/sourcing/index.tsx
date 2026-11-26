import { GlassPanel, Grid } from '@glidepath/ui/glass';

/** Panels of the Sourcing screen (SRC-11 fills each from the sourcing routes of tier 2). */
const PANELS = [
  { id: 'vendors', label: 'Vendor spend' },
  { id: 'renewals', label: 'Renewal calendar' },
  { id: 'benchmarks', label: 'Should-cost benchmarks' },
  { id: 'consolidation', label: 'Vendor consolidation' },
] as const;

/**
 * Sourcing · "Spend & contracts" (SRC-04 skeleton; features F5-F8 of docs/backlog/SRC.md). A grid of glass
 * panels in loading state until SRC-11 binds them to `sourcingVendors`, `sourcingRenewals`,
 * `sourcingBenchmarks` and `sourcingConsolidation`. Nothing is computed here.
 */
export default function Sourcing() {
  return (
    <main className="gp-module" data-module="sourcing" aria-label="Sourcing">
      <Grid data-testid="sourcing-grid">
        {PANELS.map((p) => (
          <GlassPanel key={p.id} span={6} loading data-testid={`sourcing-${p.id}`} header={{ label: p.label }} />
        ))}
      </Grid>
    </main>
  );
}
