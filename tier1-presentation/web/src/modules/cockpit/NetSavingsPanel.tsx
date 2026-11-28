import { useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Gauge } from '@glidepath/ui/charts/gauge';
import { fmt } from '@glidepath/ui/format';
import { GlassPanel, Skeleton } from '@glidepath/ui/glass';
import { StatusChip } from '@glidepath/ui/hud';
import { EditPopover, parseNumber } from '@glidepath/ui/inputs/editable';
import { Value, useBindContext, useNode, useVariable } from '../../bind';
import { SolveForThis, solvable } from '../../global/overlays/SolveForThis';
import { COPY, NET_NODES, TARGET_VARIABLE } from './copy';
import { gaugeMax } from './scale';

export interface NetSavingsPanelProps {
  /** Panel label year (`CY27`) from the tenant row. */
  year: string | null;
  /** The year the run-rate is read in, from the tenant row. */
  runRateYear: number | null;
  /** Scenario chip (`Balanced`, `· edited`). */
  status?: ReactNode;
}

/** The hero number without its unit; the unit is drawn smaller beside it (render: `$119.3`M). */
const heroFormat = (v: number) => fmt.money(v).replace(/M$/, '');

/**
 * "of $143.0M bar": the bar is `res.bar`; pressing it edits the net target (`g.target_net`, shown
 * as `res.target`), as in the prototype (`data-ed="target" data-bind="bar"`). The popover is fed
 * by the registry definition; changes preview and commit through the bind layer.
 */
function BarTarget() {
  const bar = useNode(NET_NODES.bar);
  const target = useNode(NET_NODES.target);
  const ctx = useBindContext();
  const v = useVariable(TARGET_VARIABLE);
  const d = v.definition;
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const text = fmt.money(bar.value);
  const value = target.value ?? v.value;
  const canEdit =
    d !== undefined &&
    d.min !== null &&
    d.max !== null &&
    d.step !== null &&
    typeof value === 'number';
  const fail = () => undefined; // the commit queue (WEB-05) surfaces errors in the shell
  const commitTarget = (next: number) => {
    v.preview(next);
    void v.commit(next).catch(fail);
  };

  return (
    <>
      <button
        ref={ref}
        type="button"
        className="gp-cockpit-bar"
        data-node={NET_NODES.bar}
        data-variable-id={TARGET_VARIABLE}
        data-value={typeof bar.value === 'number' ? bar.value : undefined}
        data-changed={v.from === 'scenario' || undefined}
        data-stale={bar.stale || undefined}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${COPY.bar} ${text}. ${COPY.editTarget}`}
        disabled={!canEdit}
        onClick={() => setOpen((o) => !o)}
      >
        {text}
      </button>
      {open &&
        canEdit &&
        typeof document !== 'undefined' &&
        createPortal(
          <>
            <EditPopover
              label={d.label}
              unit={d.unit}
              min={d.min!}
              max={d.max!}
              step={d.step!}
              source={d.source}
              confidence={d.confidence}
              defaultValue={d.default ?? Number.NaN}
              value={value}
              format={(n) => fmt.money(n)}
              parse={parseNumber}
              anchor={ref.current}
              onChange={commitTarget}
              onReset={() => void v.commit(null).catch(fail)}
              onClose={() => setOpen(false)}
            />
            {v.def && solvable(v.def) && (
              <SolveForThis
                tenant={ctx.tenant}
                scenarioId={ctx.scenarioId}
                cell={v.cell}
                format={(n) => fmt.money(n)}
                onApply={commitTarget}
              />
            )}
          </>,
          document.body,
        )}
    </>
  );
}

function Stat({ label, node }: { label: string; node: string }) {
  return (
    <div className="gp-cockpit-stat" data-node={node}>
      <dt>{label}</dt>
      <dd>
        <Value node={node} format="money" />
      </dd>
    </div>
  );
}

/**
 * Net savings (5 cols): 270° gauge (net fill, bar notch, target notch), hero `res.net`, "of
 * `res.bar` bar" (edits the target), gap chip `res.gap`; stat row `res.risk`, `res.tot_rr`,
 * `res.tot_ot_it`. Every number is the session's; nothing is computed here.
 */
export function NetSavingsPanel({ year, runRateYear, status }: NetSavingsPanelProps) {
  const net = useNode(NET_NODES.net);
  const bar = useNode(NET_NODES.bar);
  const target = useNode(NET_NODES.target);
  const gap = useNode(NET_NODES.gap);
  const loading = net.value === undefined;

  return (
    <GlassPanel
      span={5}
      className="gp-cockpit-net"
      data-testid="cockpit-net"
      header={{
        label: year ? COPY.netLabel(year) : <Skeleton size="label" width="40%" />,
        status,
      }}
      loading={loading}
    >
      <Gauge
        net={net.value}
        bar={bar.value}
        target={target.value}
        max={gaugeMax(bar.value, net.value)}
      >
        <span className="gp-gauge-hero gp-cockpit-hero" data-stale={net.stale || undefined}>
          <Value node={NET_NODES.net} format={heroFormat} className="gp-cockpit-hero-value" />
          <span className="gp-gauge-hero-unit" aria-hidden="true">
            M
          </span>
        </span>
        <span className="gp-cockpit-of">
          {COPY.of} <BarTarget /> {COPY.bar}
        </span>
        <span data-node={NET_NODES.gap} data-value={gap.value ?? undefined}>
          <StatusChip gap={gap.value} />
        </span>
      </Gauge>
      <dl className="gp-cockpit-stats">
        <Stat label={COPY.risk} node={NET_NODES.risk} />
        <Stat label={COPY.runRate(runRateYear)} node={NET_NODES.runRate} />
        <Stat label={COPY.oneTimeIt} node={NET_NODES.oneTimeIt} />
      </dl>
    </GlassPanel>
  );
}
