import { useState } from 'react';
import type { TenantSlug } from '@glidepath/api-contract';
import { Grid } from '@glidepath/ui/glass';
import { useBindContext } from '../../bind';
import { useTenants } from '../../data';
import { EmptyState } from '../../jobs';
import { COPY } from './copy';
import { Onboarding } from './Onboarding';
import { ReconfigPanel } from './ReconfigPanel';
import { AirlinesStyles } from './styles';
import { Tiles } from './Tiles';
import { useReconfig } from './useReconfig';

/**
 * Airlines · "Airlines" (MOD-10; 03_screens, airlines-dark-1440.jpg). Tenant tiles (tenants and
 * the AI draft from tier 2), Reconfigure with AI (`/api/ai/reconfig`), and the nine-step
 * onboarding checklist. Nothing is computed here; nothing is written until the user applies.
 */
export default function Airlines() {
  const { tenant } = useBindContext();
  const tenants = useTenants();
  const r = useReconfig();
  const [seed, setSeed] = useState<{ prompt: string; tenant: TenantSlug | null; n: number } | null>(
    null,
  );
  const rows = tenants.data?.tenants ?? [];
  return (
    <main className="gp-module gp-airlines" aria-label={COPY.module}>
      <AirlinesStyles />
      <Grid data-testid="airlines-grid">
        <Tiles
          tenants={rows}
          current={tenant}
          job={r.job}
          onSetUp={(prompt, slug) =>
            setSeed((s) => ({
              prompt: prompt ?? '',
              tenant: rows.find((t) => t.slug === slug)?.slug ?? null,
              n: (s?.n ?? 0) + 1,
            }))
          }
        />
        <ReconfigPanel r={r} seed={seed} />
        <Onboarding job={r.job} />
      </Grid>
      {tenants.isError ? (
        <EmptyState
          line="Airlines could not be loaded."
          action={{ label: 'Try again', onAction: () => void tenants.refetch() }}
        />
      ) : null}
      <p className="gp-airlines-note">{COPY.note}</p>
    </main>
  );
}
