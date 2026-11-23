import type { CSSProperties } from 'react';
import { fmt } from '@glidepath/ui/format';
import { vpColour } from '@glidepath/ui/charts/gauge';
import { StatusChip } from '@glidepath/ui/hud';
import { GlassPanel } from '@glidepath/ui/glass';
import { useNode } from '../../bind';
import { GlowText, GlowValue } from './Bound';

export interface VpMember {
  key: string;
  label: string;
}

const money = (v: number) => fmt.money(v);
const growth = (v: number) => `+ growth ${fmt.money(v)}`;

/** Bullet (net against the bar tick): geometry is CSS from the net and bar tier 2 pushed. */
function Bullet({ vp, label }: { vp: string; label: string }) {
  const net = useNode('vp.net', vp);
  const bar = useNode('vp.bar', vp);
  const known = typeof net.value === 'number' && typeof bar.value === 'number';
  const style = known ? ({ '--net': net.value, '--bar': bar.value } as CSSProperties) : undefined;
  return (
    <div
      className="gp-vps-bullet"
      role="img"
      aria-label={`${label}: net ${fmt.money(net.value)} against bar ${fmt.money(bar.value)}`}
      data-net={known ? net.value : undefined}
      data-bar={known ? bar.value : undefined}
      style={style}
    >
      {known && <span className="gp-vps-bullet-fill" />}
      <span className="gp-vps-bullet-tick" />
    </div>
  );
}

/** One VP card (inventory VP card): outlay, bullet, net, bar, target, growth, gap, shared owner. */
export function VpCard({ vp, slot }: { vp: VpMember; slot: number }) {
  const ss = useNode('org.ss_flag', vp.key);
  const gap = useNode('vp.gap', vp.key);
  return (
    <GlassPanel
      as="article"
      aria-label={vp.label}
      className="gp-vps-card"
      style={{ '--vp-colour': vpColour(slot) } as CSSProperties}
      data-vp={vp.key}
    >
      <div className="gp-vps-card-head">
        <span className="gp-vps-dot" aria-hidden="true" />
        <h3 className="gp-vps-card-name">{vp.label}</h3>
        {ss.value === 1 && <span className="gp-vps-ss">Shared owner</span>}
      </div>
      <div>
        <p className="gp-vps-eyebrow">CY26 outlay</p>
        <GlowValue className="gp-vps-hero" node="vp.outlay" member={vp.key} format={money} />
      </div>
      <Bullet vp={vp.key} label={vp.label} />
      <div className="gp-vps-pair">
        <span>
          Net <GlowValue node="vp.net" member={vp.key} format={money} />
        </span>
        <span>
          Bar <GlowValue node="vp.bar" member={vp.key} format={money} />
        </span>
      </div>
      <div className="gp-vps-card-foot">
        <div>
          <p className="gp-vps-eyebrow">Target</p>
          <GlowValue className="gp-vps-target" node="vp.target" member={vp.key} format={money} />
          <GlowValue className="gp-vps-sub" node="vp.growth" member={vp.key} format={growth} />
        </div>
        <div>
          <p className="gp-vps-eyebrow">Gap</p>
          <GlowText value={gap.value}>
            <StatusChip gap={typeof gap.value === 'number' ? gap.value : null} />
          </GlowText>
        </div>
      </div>
    </GlassPanel>
  );
}
