import type { CSSProperties } from 'react';
import { ComputeFlow } from '@glidepath/ui/compute';
import { GlassPanel } from '@glidepath/ui/glass';
import { StatusChip } from '@glidepath/ui/hud';
import { Value, useNode } from '../../bind';
import { JobHeader } from '../../jobs';
import { COPY } from './copy';
import { useWizardOptimizer } from './optimizer';

const T = COPY.tape;

function Term({ id, label, node }: { id: string; label: string; node: string }) {
  return (
    <span className="gp-wz-term" data-term={id} data-node={node}>
      <span className="gp-wz-eyebrow">{label}</span>
      <Value node={node} format="money" />
    </span>
  );
}

const Op = ({ id, children }: { id: string; children: string }) => (
  <span className="gp-wz-op" data-op={id} aria-hidden="true">
    {children}
  </span>
);

/**
 * The running total, a calculator tape that stays on every step: In-year − One-time = Net vs Bar,
 * the gap chip and a meter. All three terms and the gap are tier 2's nodes (no arithmetic here);
 * `Value` rolls and flashes each one as it is recalculated, so a slider drag shows on the tape.
 */
export function Tape() {
  const opt = useWizardOptimizer();
  const net = useNode('res.net');
  const bar = useNode('res.bar');
  const gap = useNode('res.gap');
  const meter = { '--value': net.value ?? 0, '--max': bar.value ?? 1 } as CSSProperties;
  const starting = opt.busy && opt.jobId === null;

  return (
    <GlassPanel
      as="section"
      level={2}
      padding="none"
      className="gp-wz-tape"
      data-wizard-tape
      data-busy={opt.busy || undefined}
      aria-label={T.label}
    >
      <Term id="inyear" label={T.inYear} node="res.tot_iy" />
      <Op id="minus">{T.minus}</Op>
      <Term id="onetime" label={T.oneTime} node="res.tot_ot_it" />
      <Op id="equals">{T.equals}</Op>
      <Term id="net" label={T.net} node="res.net" />
      <Op id="vs">{T.vs}</Op>
      <Term id="bar" label={T.bar} node="res.bar" />
      <span data-node="res.gap" data-value={gap.value ?? undefined}>
        <StatusChip gap={gap.value} />
      </span>
      <span className="gp-wz-meter" aria-hidden="true">
        <i style={meter} />
      </span>
      <span className="gp-wz-tape-act">
        {opt.jobId !== null ? <JobHeader id={opt.jobId} /> : null}
        {starting && <ComputeFlow active variant="inline" />}
        <button
          type="button"
          className="gp-wz-btn"
          data-variant="primary"
          data-wizard-optimize
          disabled={opt.busy}
          aria-busy={opt.busy || undefined}
          onClick={() => opt.find()}
        >
          {starting ? T.starting : T.find}
        </button>
      </span>
    </GlassPanel>
  );
}
