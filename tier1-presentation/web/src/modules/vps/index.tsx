import { useMemo } from 'react';
import { Grid, GridCell } from '@glidepath/ui/glass';
import { useBindContext } from '../../bind';
import { useBundle, useApiClient, useMembers } from '../../data';
import { JobsProvider, solverRunCanceller } from '../../jobs';
import { ChargebackPanel } from './ChargebackPanel';
import { Controls } from './Controls';
import { FeasiblePanel } from './FeasiblePanel';
import { OwnershipPanel } from './OwnershipPanel';
import { VpCard } from './VpCard';
import { vpsCss } from './styles';

/**
 * VPs · "VP targets & ownership" (MOD-05; screens doc, vps-dark-1440.jpg). Renders inside
 * `GlobalLayout`: every number is a pushed cell or view of the session (`useNode`, `useVariable`,
 * `useView`), every edit goes through the commit queue. Nothing is computed here.
 */
export default function Vps() {
  const { tenant, scenarioId, session } = useBindContext();
  const api = useApiClient();
  const members = useMembers(tenant);
  const bundle = useBundle(tenant);
  const cancel = useMemo(() => solverRunCanceller(api, tenant), [api, tenant]);

  const dims = members.data?.dimensions;
  const active = (id: string) =>
    (Object.entries(dims ?? {}).find(([k]) => k === id)?.[1] ?? [])
      .filter((m) => m.active)
      .map((m) => ({ key: m.key as string, label: m.label }));
  const vps = active('vp');
  const domains = active('domain');
  const pools = active('pool');
  const step = bundle.data?.variables.find((v) => v.id === 'org.dom_share')?.step ?? undefined;

  return (
    <JobsProvider session={session} cancel={cancel}>
      <style href="glidepath-vps" precedence="glidepath">
        {vpsCss}
      </style>
      <div className="gp-vps" data-module="vps">
        <Controls />
        <section className="gp-vps-cards" aria-label="VP targets">
          {vps.map((vp, slot) => (
            <VpCard key={vp.key} vp={vp} slot={slot} />
          ))}
        </section>
        <Grid>
          <OwnershipPanel vps={vps} domains={domains} step={step} />
          <GridCell span={5} stack>
            <ChargebackPanel vps={vps} pools={pools} />
            <FeasiblePanel tenant={tenant} scenarioId={scenarioId} vps={vps} />
          </GridCell>
        </Grid>
      </div>
    </JobsProvider>
  );
}
