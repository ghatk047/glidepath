import type { CSSProperties } from 'react';
import { fmt } from '@glidepath/ui/format';
import { vpColour, vpTextColour } from '@glidepath/ui/charts/gauge';
import { GlassPanel } from '@glidepath/ui/glass';
import { BoundEditable, useNode } from '../../bind';
import { BoundToggle, GlowValue, useCells } from './Bound';
import type { VpMember } from './VpCard';

/** Key bar: each VP's `vp.usage` is the segment's flex weight, the label is tier 2's number. */
function UsageKey({ vps }: { vps: readonly VpMember[] }) {
  const usage = useCells(
    'vp.usage',
    vps.map((v) => v.key),
  );
  return (
    <div className="gp-vps-usage" role="img" aria-label="Usage key" data-testid="usage-key">
      {vps.map((v, i) => {
        const u = usage[i];
        if (typeof u !== 'number') return null;
        return (
          <span
            key={v.key}
            data-vp={v.key}
            data-value={u}
            data-tip={`${v.label} · ${fmt.pct(u)}`}
            style={
              {
                flexGrow: u,
                '--vp-colour': vpColour(i),
                '--vp-text': vpTextColour(i),
              } as CSSProperties
            }
          >
            {fmt.pct(u)}
          </span>
        );
      })}
    </div>
  );
}

function Override({ vps }: { vps: readonly VpMember[] }) {
  const on = useNode('org.usage_override_on');
  return (
    <>
      <div className="gp-vps-switch">
        <BoundToggle variable="org.usage_override_on" label="Use metered usage keys" />
        <span>Use metered usage keys</span>
      </div>
      {on.value === 1 && (
        <ul className="gp-vps-overrides" aria-label="Metered usage keys">
          {vps.map((v) => (
            <li key={v.key}>
              <span>{v.label}</span>
              <BoundEditable variable="org.usage_override" member={v.key} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** Chargeback: usage key, metered override and the shared-pool toggles (`pool.shared`). */
export function ChargebackPanel({
  vps,
  pools,
}: {
  vps: readonly VpMember[];
  pools: readonly { key: string; label: string }[];
}) {
  return (
    <GlassPanel
      level={1}
      header={{
        label: 'Chargeback · shared infrastructure',
        status: <span className="gp-vps-ss">usage key</span>,
      }}
    >
      <p className="gp-vps-sub">
        Infra&apos;s slice of shared pools is credited back to the VPs that consume it.
      </p>
      <UsageKey vps={vps} />
      <Override vps={vps} />
      <ul className="gp-vps-pools">
        {pools.map((p) => (
          <li key={p.key} className="gp-vps-pool" data-pool={p.key}>
            <span className="gp-vps-pool-name">{p.label}</span>
            <GlowValue
              className="gp-vps-pool-outlay"
              node="base.pool_outlay"
              member={p.key}
              format={(v) => fmt.money(v)}
            />
            <BoundToggle variable="pool.shared" member={p.key} label={`${p.label} is shared`} />
          </li>
        ))}
      </ul>
    </GlassPanel>
  );
}
