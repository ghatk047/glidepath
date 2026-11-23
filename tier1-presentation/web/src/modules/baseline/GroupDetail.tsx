import type { BaselineGroupBy, BaselineGroupsView } from '@glidepath/api-contract';
import { fmt } from '@glidepath/ui/format';
import { GlassPanel } from '@glidepath/ui/glass';
import { BoundEditable, Value, useNode } from '../../bind';
import { LineAmount } from './LineAmount';
import { GROUP_NOUN, type BaselineMembers } from './model';

type Group = BaselineGroupsView['groups'][number];

/** Lines shown in the detail panel (screens.md: "top 7 lines"). */
export const TOP_LINES = 7;

/**
 * Group detail: name, total (tier 2's group value), growth (editable for pools), the addressable
 * share of a pool (`base.pool_addressable` against `base.pool_outlay`, drawn by a native meter so
 * no ratio is computed here) and the top lines in tier 2's value order with editable amounts.
 */
export function GroupDetail({
  by,
  group,
  members,
}: {
  by: BaselineGroupBy;
  group: Group | undefined;
  members: BaselineMembers;
}) {
  if (!group) {
    return (
      <GlassPanel header={{ label: GROUP_NOUN[by] }} loading aria-label="Group detail">
        {null}
      </GlassPanel>
    );
  }
  // Order only (largest first, as tier 2 sent the values); nothing is summed or derived.
  const top = [...group.lines].sort((a, b) => b.value - a.value).slice(0, TOP_LINES);
  return (
    <GlassPanel
      level={1}
      header={{
        label: GROUP_NOUN[by],
        status: <span className="gp-chip">{group.lines.length} lines</span>,
      }}
      className="gp-bl-detail"
      data-group={group.key}
    >
      <h3 className="gp-bl-name">{group.label}</h3>
      <div className="gp-bl-total">
        <span data-testid="group-total">{fmt.money(group.value)}</span>
        {by === 'pool' && (
          <span className="gp-bl-growth">
            growth <BoundEditable variable="pool.growth" member={group.key} format="pct" />
            /yr
          </span>
        )}
      </div>
      {by === 'pool' && <AddressableSplit pool={group.key} />}
      <ol className="gp-bl-top" aria-label={`Top ${TOP_LINES} lines of ${group.label}`}>
        {top.map((l) => {
          const info = members.lines.get(l.key);
          return (
            <li key={l.key} data-line={l.key}>
              <span className="gp-bl-line-name">
                <span>{info?.name ?? l.key}</span>
                <small>{info?.vendor}</small>
              </span>
              <LineAmount line={l.key} name={info?.name} format={(v) => fmt.money(v)} />
            </li>
          );
        })}
      </ol>
    </GlassPanel>
  );
}

/** `base.pool_addressable[pool]` of `base.pool_outlay[pool]`: values as tier 2 pushed them. */
function AddressableSplit({ pool }: { pool: string }) {
  const addressable = useNode('base.pool_addressable', pool);
  const outlay = useNode('base.pool_outlay', pool);
  const a = typeof addressable.value === 'number' ? addressable.value : undefined;
  const o = typeof outlay.value === 'number' ? outlay.value : undefined;
  return (
    <div className="gp-bl-split" data-stale={addressable.stale || outlay.stale || undefined}>
      <meter
        className="gp-bl-meter"
        min={0}
        max={o ?? 0}
        value={a ?? 0}
        aria-label="Addressable share of the pool"
      />
      <div className="gp-bl-split-labels">
        <span>
          Addressable <Value node="base.pool_addressable" member={pool} format="money" />
        </span>
        <span>
          of <Value node="base.pool_outlay" member={pool} format="money" />
        </span>
      </div>
    </div>
  );
}
