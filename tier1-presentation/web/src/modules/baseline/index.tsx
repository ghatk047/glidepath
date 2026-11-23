import { useMemo } from 'react';
import type { BaselineGroupBy } from '@glidepath/api-contract';
import { Treemap } from '@glidepath/ui/charts/treemap';
import { GlassPanel } from '@glidepath/ui/glass';
import { useBindContext, useView } from '../../bind';
import { GroupDetail } from './GroupDetail';
import { BaselineHeader } from './Header';
import { LineTable } from './LineTable';
import {
  GROUP_NOUN,
  useBaselineMembers,
  useBaselineNavigation,
  useBaselineSelection,
} from './model';
import { baselineCss } from './styles';

/**
 * Baseline, "Where the money is" (screens.md): header strip, treemap, group detail, line table.
 * Every number is a tier 2 value (`useNode` / `useVariable` / `useView`); selection is the URL's
 * `?group=<grouping>&key=<member>`. Renders inside GlobalLayout (BindProvider, CommitProvider).
 */
export default function Baseline() {
  const { tenant } = useBindContext();
  const { by, key } = useBaselineSelection();
  const nav = useBaselineNavigation();
  const members = useBaselineMembers(tenant);
  const groups = useView('baseline.groups', { by });
  const payload = groups.payload;

  // No (or an unknown) `?key`: show the first group tier 2 sent, without writing the URL.
  const selected = payload?.groups.find((g) => g.key === key) ?? payload?.groups[0];

  const colourBy = useMemo(
    () => ({
      categories: members.addrCategories,
      of: Object.fromEntries([...members.lines.values()].map((l) => [l.key, l.addr])),
    }),
    [members.addrCategories, members.lines],
  );
  const lineLabels = useMemo(
    () =>
      Object.fromEntries(
        [...members.lines.values()].map((l) => [l.key, { label: l.name, detail: l.vendor }]),
      ),
    [members.lines],
  );

  const onBy = (next: BaselineGroupBy) => nav.select(next, null);

  return (
    <div className="gp-module gp-baseline" data-module="baseline">
      <style href="glidepath-baseline" precedence="glidepath">
        {baselineCss}
      </style>
      <BaselineHeader by={by} onBy={onBy} />
      <div className="gp-bl-main">
        <GlassPanel
          level={1}
          header={{
            label: `CY26 outlay · ${GROUP_NOUN[by]}`,
            status: (
              <span className="gp-bl-legend" aria-label="Addressability colours">
                {members.addrCategories.map((c, i) => (
                  <span key={c.key}>
                    <i data-slot={i} aria-hidden="true" />
                    {c.label}
                  </span>
                ))}
              </span>
            ),
          }}
          loading={!payload}
          data-stale={groups.stale || undefined}
        >
          {payload && (
            <Treemap
              groups={payload}
              colourBy={colourBy}
              lineLabels={lineLabels}
              selected={selected?.key ?? null}
              onSelect={(k) => nav.select(by, k)}
              title={`Treemap of CY26 IT outlay by ${GROUP_NOUN[by].toLowerCase()}`}
            />
          )}
        </GlassPanel>
        <GroupDetail by={by} group={selected} members={members} />
      </div>
      <LineTable by={by} group={selected} members={members} onExcel={nav.toExcel} />
    </div>
  );
}
