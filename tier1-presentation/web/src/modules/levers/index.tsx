import { useCallback, useMemo } from 'react';
import { useRouter } from '@tanstack/react-router';
import { GlassPanel, Grid, GridCell } from '@glidepath/ui/glass';
import { useViewStore, viewStore } from '../../app/view-store';
import { DimKey } from '@glidepath/api-contract';
import { useBindContext, useView } from '../../bind';
import { useBundle, useMembers } from '../../data';
import { AllLevers, MonthlyPanel } from './AllLevers';
import { LeverDetail } from './LeverDetail';
import { LeverList } from './LeverList';
import { leversCss } from './styles';

const LEVER_DIM = DimKey.parse('lever');

function LeversStyles() {
  return (
    <style href="glidepath-web-levers" precedence="glidepath">
      {leversCss}
    </style>
  );
}

/** Moves `?lever=` (replace) and the view store's selection; the URL stays the source of truth. */
function useSelectLever(): (lever: string) => void {
  const router = useRouter();
  return useCallback(
    (lever: string) => {
      viewStore.getState().setSelection({ lever });
      const params = router.state.matches.at(-1)?.params as Record<string, string> | undefined;
      if (!params?.['module']) return;
      void router.navigate({
        to: '/$tenant/$scenario/$module',
        params,
        search: (prev: Record<string, unknown>) => ({ ...prev, lever }),
        replace: true,
      } as never);
    },
    [router],
  );
}

/**
 * Levers · "Lever studio" (MOD-04; UX 03_screens). Every number is a bound cell or view tier 2
 * pushed: `levers.families`, `levers.scale`, `levers.monthly`, `lev.*` and `res.*`. The selected
 * lever is the URL's `?lever=` (default: the first lever tier 2 lists).
 */
export default function Levers() {
  const { tenant } = useBindContext();
  const families = useView('levers.families', {});
  const scale = useView('levers.scale', {});
  const monthly = useView('levers.monthly', {});
  const members = useMembers(tenant);
  const bundle = useBundle(tenant);
  const requested = useViewStore((s) => s.selection.lever);
  const select = useSelectLever();

  const leverMembers = members.data?.dimensions[LEVER_DIM];
  const labels = useMemo(() => {
    const out: Record<string, string> = {};
    for (const m of leverMembers ?? []) out[m.key] = m.label;
    for (const f of families.payload?.families ?? []) out[f.key] = f.label;
    return out;
  }, [leverMembers, families.payload]);

  const listed: readonly string[] = families.payload?.families.flatMap((f) => f.levers) ?? [];
  const selected =
    requested !== null && listed.includes(requested) ? requested : (listed[0] ?? null);
  const family = families.payload?.families.find(
    (f) => selected !== null && (f.levers as readonly string[]).includes(selected),
  );
  const attrs = leverMembers?.find((m) => m.key === selected)?.attrs;
  const hyp = attrs?.['hypothesis'];
  const hypothesis = typeof hyp === 'string' ? hyp : undefined;

  return (
    <div className="gp-module" data-module="levers">
      <LeversStyles />
      <Grid>
        <GlassPanel
          as="section"
          span={4}
          header={{ label: 'Levers', labelAs: 'h2' }}
          loading={families.payload === undefined}
        >
          {families.payload && (
            <LeverList
              families={families.payload}
              scaleMax={scale.payload?.max}
              labels={labels}
              selected={selected ?? ''}
              onSelect={select}
            />
          )}
        </GlassPanel>
        {selected !== null ? (
          <LeverDetail
            lever={selected}
            label={labels[selected] ?? selected}
            family={family?.label}
            hypothesis={hypothesis}
            variables={bundle.data?.variables}
            monthly={monthly.payload}
          />
        ) : (
          <GlassPanel
            as="section"
            span={5}
            header={{ label: 'Lever detail', labelAs: 'h2' }}
            loading
          />
        )}
        <GridCell span={3} stack>
          <AllLevers />
          <MonthlyPanel monthly={monthly.payload} labels={labels} selected={selected} />
        </GridCell>
      </Grid>
    </div>
  );
}
