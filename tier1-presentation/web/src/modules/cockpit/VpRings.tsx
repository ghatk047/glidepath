import type { CSSProperties } from 'react';
import type { DimKey, Member } from '@glidepath/api-contract';
import { RingTile, vpColour } from '@glidepath/ui/charts/gauge';
import { GlassPanel } from '@glidepath/ui/glass';
import { StatusChip } from '@glidepath/ui/hud';
import { Value, useBindContext, useNode } from '../../bind';
import { useMembers } from '../../data';
import { useShellNavigation } from '../../global/shell';
import { COPY, VP_DIM, VP_LABELS, VP_NODES } from './copy';

/** A bound output cell of one VP, with its id and member on the wrapper for tests and ⌘K. */
function VpValue({
  node,
  member,
  className,
}: {
  node: string;
  member: string;
  className?: string;
}) {
  return (
    <span className={className} data-node={node} data-member={member}>
      <Value node={node} member={member} format="money" />
    </span>
  );
}

/**
 * One VP tile (3 cols, prototype `.vp-tile`): name with its slot colour and `vp.outlay`; ring of
 * `vp.net` against `vp.bar` (the ring draws the share it is handed), net and "of $X bar"; gap
 * chip `vp.gap`. The name opens the VPs module.
 */
function VpTile({ member, slot }: { member: Member; slot: number }) {
  const net = useNode(VP_NODES.net, member.key);
  const bar = useNode(VP_NODES.bar, member.key);
  const gap = useNode(VP_NODES.gap, member.key);
  const { toModule } = useShellNavigation();
  const name = VP_LABELS[member.key] ?? member.label;
  const colour = { '--gp-vp-colour': vpColour(slot) } as CSSProperties;

  return (
    <GlassPanel
      span={3}
      padding="tight"
      className="gp-cockpit-vp"
      data-testid="cockpit-vp"
      data-member={member.key}
      aria-label={name}
      loading={net.value === undefined}
    >
      <div className="gp-cockpit-vp-head">
        <h2 className="gp-cockpit-vp-name">
          <button type="button" aria-label={COPY.openVps(name)} onClick={() => toModule('vps')}>
            <span className="gp-cockpit-swatch" style={colour} aria-hidden="true" />
            {name}
          </button>
        </h2>
        <VpValue node={VP_NODES.outlay} member={member.key} className="gp-cockpit-vp-outlay" />
      </div>
      <RingTile value={net.value} max={bar.value} colour={slot} label={name}>
        <div className="gp-cockpit-vp-num">
          <VpValue node={VP_NODES.net} member={member.key} className="gp-cockpit-mid" />
          <span className="gp-cockpit-of">
            {COPY.of} <VpValue node={VP_NODES.bar} member={member.key} /> {COPY.bar}
          </span>
        </div>
      </RingTile>
      <span
        className="gp-cockpit-vp-gap"
        data-node={VP_NODES.gap}
        data-member={member.key}
        data-value={gap.value ?? undefined}
        data-stale={gap.stale || undefined}
      >
        <StatusChip gap={gap.value} />
      </span>
    </GlassPanel>
  );
}

/**
 * VP rings (4 × 3 for AA): one tile per active member of the `vp` dimension, in the order
 * `/members` sends them; the slot (colour) follows that order. Values are the session's cells
 * `vp.*[member]`; nothing is computed here.
 */
export function VpRings() {
  const { tenant } = useBindContext();
  const members = useMembers(tenant);
  const vps = (members.data?.dimensions[VP_DIM as DimKey] ?? []).filter((m) => m.active);
  return (
    <>
      {vps.map((m, slot) => (
        <VpTile key={m.key} member={m} slot={slot} />
      ))}
    </>
  );
}
