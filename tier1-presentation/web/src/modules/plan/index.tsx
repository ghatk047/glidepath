import { GlassPanel, Grid } from '@glidepath/ui/glass';

/** Panels of the Plan screen (SRC-18 fills each from the solver runs and the plan route of tier 2). */
const PANELS = [
  { id: 'breakeven', label: 'Breakeven by lever' },
  { id: 'stress', label: 'Stress tests' },
  { id: 'business-case', label: 'Business case' },
  { id: 'waves', label: 'Wave planner' },
] as const;

/**
 * Plan · "Plan & business case" (SRC-04 skeleton; features F1, F3, F9, F10 of docs/backlog/SRC.md). A grid of
 * glass panels in loading state until SRC-18 binds them to the `breakeven`, `stress_presets` and `wave_plan`
 * solver runs and `planBusinessCase`. Nothing is computed here.
 */
export default function Plan() {
  return (
    <main className="gp-module" data-module="plan" aria-label="Plan">
      <Grid data-testid="plan-grid">
        {PANELS.map((p) => (
          <GlassPanel key={p.id} span={6} loading data-testid={`plan-${p.id}`} header={{ label: p.label }} />
        ))}
      </Grid>
    </main>
  );
}
