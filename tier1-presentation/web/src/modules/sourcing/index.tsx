import { Component, type ReactNode } from 'react';
import { GlassPanel } from '@glidepath/ui/glass';
import { useBindContext } from '../../bind';
import { BenchmarksPanel } from './BenchmarksPanel';
import { ConsolidationPanel } from './ConsolidationPanel';
import { RenewalsPanel } from './RenewalsPanel';
import { VendorsPanel } from './VendorsPanel';
import { sourcingCss } from './styles';
import { useSourcing } from './useSourcing';

/** Panels of the Sourcing screen, in reading order (features F5-F8 of docs/backlog/SRC.md). */
const PANELS = [
  { id: 'vendors', label: 'Vendor spend' },
  { id: 'renewals', label: 'Renewal calendar' },
  { id: 'benchmarks', label: 'Should-cost benchmarks' },
  { id: 'consolidation', label: 'Vendor consolidation' },
] as const;

function Frame({ children }: { children: ReactNode }) {
  return (
    <main className="gp-module" data-module="sourcing" aria-label="Sourcing">
      <style href="glidepath-sourcing" precedence="glidepath">
        {sourcingCss}
      </style>
      <div className="gp-src" data-testid="sourcing-grid">
        {children}
      </div>
    </main>
  );
}

/** The four panels in their loading state: before the app's providers are there (a bare mount). */
function Skeletons() {
  return (
    <Frame>
      {PANELS.map((p) => (
        <GlassPanel key={p.id} level={1} loading data-testid={`sourcing-${p.id}`} header={{ label: p.label }} />
      ))}
    </Frame>
  );
}

/** Renders the skeleton grid when the screen is mounted without the session and data providers. */
class NeedsProviders extends Component<{ children: ReactNode }, { error: unknown }> {
  override state: { error: unknown } = { error: null };
  static getDerivedStateFromError(error: unknown) {
    return { error };
  }
  override render() {
    const { error } = this.state;
    if (error === null) return this.props.children;
    // Only a missing provider (`... need a <XProvider> above them`) falls back; anything else goes up.
    if (error instanceof Error && /need a <\w+Provider/.test(error.message)) return <Skeletons />;
    throw error;
  }
}

function Screen() {
  const { tenant, scenarioId } = useBindContext();
  const s = useSourcing(tenant, scenarioId);
  const params = s.params.data?.params ?? [];
  return (
    <Frame>
      <VendorsPanel read={s.vendors} />
      <RenewalsPanel read={s.renewals} params={params} onCommitted={s.reload} />
      <BenchmarksPanel read={s.benchmarks} params={params} onCommitted={s.reload} />
      <ConsolidationPanel read={s.consolidation} params={params} onCommitted={s.reload} />
    </Frame>
  );
}

/**
 * Sourcing · "Spend & contracts" (SRC-11; features F5-F8): vendor spend, renewal calendar,
 * should-cost benchmarks and vendor consolidation, each read from tier 2's sourcing routes. The
 * `sourcing_param` members are edited in place (steppers → commit queue → structural change) and the
 * panels read again, the consolidation optimizer re-runs. Nothing is computed here.
 */
export default function Sourcing() {
  return (
    <NeedsProviders>
      <Screen />
    </NeedsProviders>
  );
}
