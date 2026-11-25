import type { DimKey } from '@glidepath/api-contract';
import type { CSSProperties } from 'react';
import { Gauge, RingTile, vpColour } from '@glidepath/ui/charts/gauge';
import { fmt } from '@glidepath/ui/format';
import { ComputeFlow } from '@glidepath/ui/compute';
import { GlassPanel, Grid } from '@glidepath/ui/glass';
import { StatusChip } from '@glidepath/ui/hud';
import { RadioCard, Toggle } from '@glidepath/ui/inputs/controls';
import { Value, useBindContext, useNode, useVariable } from '../../bind';
import { useBundle, useMembers, useScenarios } from '../../data';
import { presetLetter } from '../../global/shell';
import { RunIndicator } from '../../jobs';
import { gaugeMax } from '../cockpit/scale';
import { METRIC, OBJECTIVES, RISK_EXPOSURE } from '../path/copy';
import { COPY, NODES, POLICY, VP } from './copyResult';
import { Moves } from './Moves';
import { Odds } from './Odds';
import { useWizardOptimizer } from './optimizer';
import { ResultStyles } from './resultStyles';

const heroFormat = (v: number) => fmt.money(v).replace(/M$/, '');

function Stat({ label, node }: { label: string; node: string }) {
  return (
    <div className="gp-wzr-stat" data-node={node}>
      <dt>{label}</dt>
      <dd>
        <Value node={node} format={node === NODES.eps ? 'eps' : 'money'} />
      </dd>
    </div>
  );
}

function NetVsBar() {
  const net = useNode(NODES.net);
  const bar = useNode(NODES.bar);
  const target = useNode(NODES.target);
  const gap = useNode(NODES.gap);
  const absorb = useVariable(POLICY.absorb);
  return (
    <GlassPanel
      span={5}
      header={{ label: COPY.netVsBar }}
      loading={net.value === undefined}
      data-testid="wizard-net"
    >
      <Gauge net={net.value} bar={bar.value} target={target.value} max={gaugeMax(bar.value, net.value)}>
        <span className="gp-gauge-hero gp-wzr-hero">
          <span data-node={NODES.net} data-value={net.value ?? undefined}>
            <Value node={NODES.net} format={heroFormat} />
          </span>
          <span className="gp-gauge-hero-unit" aria-hidden="true">
            M
          </span>
        </span>
        <span data-node={NODES.gap} data-value={gap.value ?? undefined}>
          <StatusChip gap={gap.value} />
        </span>
        <span className="gp-wzr-faint" data-node={NODES.coverage}>
          <Value node={NODES.coverage} format="pct" />
        </span>
      </Gauge>
      <p className="gp-wzr-parts" aria-label={COPY.barParts}>
        <span data-node={NODES.target}>
          <Value node={NODES.target} format="money" />
        </span>
        {' + '}
        <span data-node={NODES.headwinds} data-dim={absorb.value === 0 || undefined}>
          <Value node={NODES.headwinds} format="money" />
          {absorb.value === 0 ? <em className="gp-wzr-faint"> {COPY.notAbsorbed}</em> : null}
        </span>
        {' = '}
        <span data-node={NODES.bar}>
          <Value node={NODES.bar} format="money" />
        </span>
      </p>
    </GlassPanel>
  );
}

function VpTile({ vp, slot }: { vp: { key: string; label: string }; slot: number }) {
  const net = useNode(VP.net, vp.key);
  const bar = useNode(VP.bar, vp.key);
  const gap = useNode(VP.gap, vp.key);
  const colour = { '--gp-vp-colour': vpColour(slot) } as CSSProperties;
  return (
    <div className="gp-wzr-vp" data-member={vp.key} role="group" aria-label={vp.label}>
      <span className="gp-wzr-vp-name">
        <span className="gp-wzr-swatch" style={colour} aria-hidden="true" />
        {vp.label}
      </span>
      <RingTile value={net.value} max={bar.value} colour={slot} label={vp.label}>
        <span data-node={VP.net} data-member={vp.key} className="gp-wzr-vp-net">
          <Value node={VP.net} member={vp.key} format="money" />
        </span>
        <span className="gp-wzr-faint">
          <span data-node={VP.bar} data-member={vp.key}>
            <Value node={VP.bar} member={vp.key} format="money" />
          </span>
        </span>
      </RingTile>
      <span data-node={VP.gap} data-member={vp.key} data-value={gap.value ?? undefined}>
        <StatusChip gap={gap.value} />
      </span>
    </div>
  );
}

function VpSplit() {
  const { tenant } = useBindContext();
  const members = useMembers(tenant);
  const vps = (members.data?.dimensions[VP.dim as DimKey] ?? []).filter((m) => m.active);
  return (
    <GlassPanel span={7} header={{ label: COPY.vpSplit }} data-testid="wizard-vps">
      <div className="gp-wzr-vps">
        {vps.map((m, slot) => (
          <VpTile key={m.key} vp={{ key: m.key, label: m.label }} slot={slot} />
        ))}
      </div>
    </GlassPanel>
  );
}

function Risk() {
  return (
    <GlassPanel span={4} header={{ label: COPY.risk }} data-testid="wizard-risk">
      <dl className="gp-wzr-stats">
        <Stat label={COPY.riskAdjusted} node={NODES.risk} />
        <Stat label={COPY.gapRisk} node={NODES.gapRisk} />
        <Stat label={COPY.eps} node={NODES.eps} />
      </dl>
    </GlassPanel>
  );
}

const cleared = (status: string) => status === 'optimal' || status === 'feasible';

function Optimizer() {
  const { tenant, scenarioId } = useBindContext();
  const opt = useWizardOptimizer();
  const bundle = useBundle(tenant);
  const scenarios = useScenarios(tenant);
  const current = scenarios.data?.scenarios.find((s) => s.id === scenarioId);
  const from = current ? (current.kind === 'preset' ? presetLetter(current.key) : current.label) : '';
  const m = opt.result?.metrics;

  return (
    <GlassPanel
      span={4}
      data-wizard-optimizer=""
      data-testid="wizard-optimizer"
      header={{
        label: COPY.optimizer,
        status: <RunIndicator busy={opt.busy} jobId={opt.jobId} />,
      }}
    >
      <div className="gp-wzr-stack">
        <RadioCard
          label={COPY.objective}
          options={OBJECTIVES.map((o) => ({ id: o.id, label: o.label }))}
          value={opt.objective}
          onChange={opt.setObjective}
        />
        <div className="gp-wzr-row">
          <span>{COPY.everyVp}</span>
          <Toggle label={COPY.everyVp} value={opt.perVp} onChange={opt.setPerVp} />
        </div>
        <button
          type="button"
          className="gp-wzr-btn"
          data-primary=""
          data-wizard-find=""
          disabled={opt.busy}
          onClick={opt.find}
        >
          {COPY.findPath}
        </button>
        {opt.busy && (
          <div className="gp-wzr-flow" data-testid="wizard-flow">
            <ComputeFlow active variant="field" />
          </div>
        )}
        {opt.error && (
          <p className="gp-wzr-problem" role="alert">
            {opt.error}
          </p>
        )}
        {opt.result && m && (
          <div className="gp-wzr-found" data-testid="wizard-found" data-status={opt.result.status}>
            <dl className="gp-wzr-stats">
              <div className="gp-wzr-stat" data-metric={COPY.net}>
                <dt>{COPY.net}</dt>
                <dd data-value={m[METRIC.net]}>{fmt.money(m[METRIC.net])}</dd>
              </div>
              <div className="gp-wzr-stat" data-metric={COPY.oneTime}>
                <dt>{COPY.oneTime}</dt>
                <dd data-value={m[METRIC.oneTime]}>{fmt.money(m[METRIC.oneTime])}</dd>
              </div>
              {m[RISK_EXPOSURE] !== undefined && (
                <div className="gp-wzr-stat" data-metric={COPY.riskExposure}>
                  <dt>{COPY.riskExposure}</dt>
                  <dd data-value={m[RISK_EXPOSURE]}>{fmt.money(m[RISK_EXPOSURE])}</dd>
                </div>
              )}
            </dl>
            {cleared(opt.result.status) ? (
              <StatusChip status="clear" label={COPY.barCleared} />
            ) : (
              <StatusChip status="short" label={COPY.barShort} />
            )}
            <Moves
              moves={opt.moves}
              runId={opt.run?.id ?? null}
              variables={bundle.data?.variables}
              from={from}
            />
            <div className="gp-wzr-actions">
              <button
                type="button"
                className="gp-wzr-btn"
                data-primary=""
                data-wizard-use=""
                disabled={opt.applying}
                onClick={opt.apply}
              >
                {opt.applying ? COPY.applying : COPY.usePath}
              </button>
              <button type="button" className="gp-wzr-btn" onClick={opt.discard}>
                {COPY.discard}
              </button>
            </div>
          </div>
        )}
      </div>
    </GlassPanel>
  );
}

/**
 * Step 4 · Result (WIZ-06): net against the bar (target + growth), the VP split, risk, Monte Carlo
 * odds and the optimizer with its moves. Every number is a tier 2 node or solver metric.
 */
export function StepResult() {
  return (
    <section data-wizard-step="4" aria-label={COPY.result}>
      <ResultStyles />
      <Grid>
        <NetVsBar />
        <VpSplit />
        <Risk />
        <Odds />
        <Optimizer />
      </Grid>
    </section>
  );
}
