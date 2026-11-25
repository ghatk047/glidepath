import type { DimKey } from '@glidepath/api-contract';
import { MONTH_NAMES } from '@glidepath/ui/charts/monthly';
import { Grid, GlassPanel } from '@glidepath/ui/glass';
import { Toggle } from '@glidepath/ui/inputs/controls';
import { BoundEditable, BoundSlider, Value, useBindContext, useVariable } from '../../bind';
import { useBundle, useMembers } from '../../data';
import { Controls } from '../vps/Controls';
import { OwnershipPanel } from '../vps/OwnershipPanel';
import { vpsCss } from '../vps/styles';
import { COPY, DIM, NODES, POLICY, TARGET_MODE_PCT, VP } from './copyResult';
import { useWizardOptimizer } from './optimizer';
import { ResultStyles } from './resultStyles';

/** A labelled output read-out; the number is tier 2's. */
function Stat({ label, node, member = '' }: { label: string; node: string; member?: string }) {
  return (
    <div className="gp-wzr-stat" data-node={node} data-member={member || undefined}>
      <dt>{label}</dt>
      <dd>
        <Value node={node} member={member} format="money" />
      </dd>
    </div>
  );
}

function Target() {
  const mode = useVariable(POLICY.targetMode);
  const absorb = useVariable(POLICY.absorb);
  return (
    <GlassPanel span={4} header={{ label: COPY.target }} data-testid="wizard-target">
      <div className="gp-wzr-stack">
        <BoundSlider
          variable={mode.value === TARGET_MODE_PCT ? POLICY.targetPct : POLICY.targetNet}
        />
        <div className="gp-wzr-row">
          <span>{COPY.absorbGrowth}</span>
          <Toggle
            variableId={POLICY.absorb}
            label={COPY.absorbGrowth}
            value={absorb.value === 1}
            disabled={absorb.value === undefined}
            onChange={(on) => void absorb.commit(on ? 1 : 0).catch(() => undefined)}
          />
        </div>
        <dl className="gp-wzr-stats">
          <Stat label={COPY.target} node={NODES.target} />
          <Stat label={COPY.growth} node={NODES.headwinds} />
          <Stat label={COPY.bar} node={NODES.bar} />
        </dl>
      </div>
    </GlassPanel>
  );
}

function Funding() {
  return (
    <GlassPanel span={4} header={{ label: COPY.funding }} data-testid="wizard-funding">
      <div className="gp-wzr-stack">
        <BoundSlider variable={POLICY.otOutShare} />
        <dl className="gp-wzr-stats">
          <Stat label={COPY.onIt} node={NODES.otIt} />
          <Stat label={COPY.outsideIt} node={NODES.otOut} />
        </dl>
      </div>
    </GlassPanel>
  );
}

/** One chosen lever: start month and ramp. Renders nothing when the lever is off. */
function TimingRow({ lever, label }: { lever: string; label: string }) {
  const on = useVariable(POLICY.leverOn, lever);
  const start = useVariable(POLICY.start, lever);
  if (on.value !== 1) return null;
  const id = `gp-wzr-start-${lever}`;
  return (
    <li className="gp-wzr-timing-row" data-lever={lever} data-stale={start.stale || undefined}>
      <span className="gp-wzr-lever" title={label}>
        {label}
      </span>
      <label className="gp-wzr-eyebrow" htmlFor={id}>
        {COPY.start}
      </label>
      <select
        id={id}
        className="gp-wzr-select"
        data-variable-id={POLICY.start}
        value={typeof start.value === 'number' ? String(start.value) : ''}
        disabled={typeof start.value !== 'number'}
        onChange={(e) => void start.commit(Number(e.target.value)).catch(() => undefined)}
      >
        {typeof start.value !== 'number' && <option value="" />}
        {MONTH_NAMES.map((name, i) => (
          <option key={name} value={String(i + 1)}>
            {name}
          </option>
        ))}
      </select>
      <span className="gp-wzr-eyebrow">
        {COPY.ramp} <BoundEditable variable={POLICY.ramp} member={lever} />
      </span>
    </li>
  );
}

function Timing() {
  const { tenant } = useBindContext();
  const members = useMembers(tenant);
  const levers = (members.data?.dimensions[DIM.lever as DimKey] ?? []).filter((m) => m.active);
  return (
    <GlassPanel span={4} header={{ label: COPY.timing }} data-testid="wizard-timing">
      <div className="gp-wzr-stack">
        <BoundSlider variable={POLICY.headStart} />
        <ul className="gp-wzr-timing" aria-label={COPY.timing}>
          {levers.map((m) => (
            <TimingRow key={m.key} lever={m.key} label={m.label} />
          ))}
        </ul>
      </div>
    </GlassPanel>
  );
}

function Ownership() {
  const { tenant } = useBindContext();
  const members = useMembers(tenant);
  const bundle = useBundle(tenant);
  const { moved } = useWizardOptimizer();
  const dims = members.data?.dimensions;
  const active = (id: string) =>
    (Object.entries(dims ?? {}).find(([k]) => k === id)?.[1] ?? [])
      .filter((m) => m.active)
      .map((m) => ({ key: m.key as string, label: m.label }));
  const vps = active(VP.dim);
  const domains = active(DIM.domain);
  const step = bundle.data?.variables.find((v) => v.id === POLICY.domShare)?.step ?? undefined;
  return (
    <>
      <style href="glidepath-vps" precedence="glidepath">
        {vpsCss}
      </style>
      <div
        className="gp-wzr-own"
        data-testid="wizard-ownership"
        data-moved={moved.has(POLICY.domShare) || undefined}
      >
        <Controls />
        <Grid>
          <OwnershipPanel vps={vps} domains={domains} step={step} />
          <GlassPanel span={5} header={{ label: COPY.outlay }}>
            <ul className="gp-wzr-outlays" aria-label={COPY.outlay}>
              {vps.map((v) => (
                <li key={v.key} data-member={v.key}>
                  <span>{v.label}</span>
                  <span data-node={VP.outlay} data-member={v.key}>
                    <Value node={VP.outlay} member={v.key} format="money" />
                  </span>
                </li>
              ))}
            </ul>
          </GlassPanel>
        </Grid>
      </div>
    </>
  );
}

/**
 * Step 3 · Policy (WIZ-06): target and growth, outside funding share, timing per chosen lever,
 * VP ownership and method. Every control is bound to its registry id; every number is tier 2's.
 */
export function StepPolicy() {
  return (
    <section data-wizard-step="3" aria-label={COPY.policy}>
      <ResultStyles />
      <Grid>
        <Target />
        <Funding />
        <Timing />
      </Grid>
      <Ownership />
    </section>
  );
}
