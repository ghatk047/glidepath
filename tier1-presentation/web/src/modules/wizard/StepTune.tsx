import { useMemo } from 'react';
import { fmt } from '@glidepath/ui/format';
import { GlassPanel, Grid } from '@glidepath/ui/glass';
import { Dial, Toggle } from '@glidepath/ui/inputs/controls';
import {
  BoundSlider,
  Value,
  useBindContext,
  useGhosts,
  useVariable,
  useView,
} from '../../bind';
import { useBundle } from '../../data';
import { COPY, GHOSTS, leverPrefix } from './copy';
import { useWizardOptimizer } from './optimizer';
import { useWizard, wizardStore } from './store';
import { useLeverLabels } from './StepLevers';

/** A chosen lever: renders only while `lev.on` is 1; click focuses it. */
function ChosenRow({ lever, label, focused }: { lever: string; label: string; focused: boolean }) {
  const on = useVariable('lev.on', lever);
  if (on.value !== 1) return null;
  return (
    <li>
      <button
        type="button"
        className="gp-wz-pick"
        data-lever={lever}
        aria-pressed={focused}
        onClick={() => wizardStore.getState().setFocusLever(lever)}
      >
        <span>{label}</span>
        <Value node="lev.iy" member={lever} format="money" />
      </button>
    </li>
  );
}

/** `lev.conf` as a Dial: the default tick is the C preset's value. */
function ConfidenceDial({ lever }: { lever: string }) {
  const conf = useVariable('lev.conf', lever);
  const ghost = useGhosts('lev.conf', lever, ['C']);
  const d = conf.definition;
  if (!d || d.min === null || d.max === null || d.step === null || typeof conf.value !== 'number') {
    return null;
  }
  return (
    <div className="gp-wz-dial" data-stale={conf.stale || undefined}>
      <Dial
        variableId="lev.conf"
        label={COPY.confidence}
        value={conf.value}
        min={d.min}
        max={d.max}
        step={d.step}
        defaultValue={ghost[0]?.value ?? conf.value}
        format={(n) => fmt.pct(n)}
        onChange={(n) => conf.preview(n)}
        onCommit={(n) => void conf.commit(n).catch(() => undefined)}
      />
    </div>
  );
}

function Sliders({ ids, moved }: { ids: readonly string[]; moved: ReadonlySet<string> }) {
  return (
    <div className="gp-wz-sliders">
      {ids.map((id) => (
        <div
          key={id}
          className="gp-wz-slide"
          data-moved={moved.has(id) || undefined}
          title={moved.has(id) ? COPY.moved : undefined}
        >
          <BoundSlider variable={id} ghosts={GHOSTS} />
        </div>
      ))}
    </div>
  );
}

function Detail({ lever, label }: { lever: string; label: string }) {
  const { tenant } = useBindContext();
  const bundle = useBundle(tenant);
  const on = useVariable('lev.on', lever);
  const { moved } = useWizardOptimizer();
  const params = useMemo(
    () =>
      (bundle.data?.variables ?? []).filter(
        (v) => v.id.startsWith(leverPrefix(lever)) && v.ui.control === 'slider',
      ),
    [bundle.data, lever],
  );
  const decisions = params.filter((v) => v.kind === 'decision').map((v) => v.id);
  const assumptions = params.filter((v) => v.kind !== 'decision').map((v) => v.id);
  const isOn = on.value !== 0;

  return (
    <GlassPanel
      as="section"
      span={8}
      header={{ label: label, labelAs: 'h2' }}
      data-lever-detail={lever}
    >
      {!isOn && (
        <div className="gp-wz-off">
          <span>{COPY.switchedOff}</span>
          <Toggle
            variableId="lev.on"
            label={`${label} on`}
            value={false}
            disabled={on.value === undefined}
            onChange={() => void on.commit(1).catch(() => undefined)}
          />
        </div>
      )}
      <div className="gp-wz-kpis">
        <div className="gp-wz-kpi" data-hero="true">
          <span className="gp-wz-eyebrow">{COPY.inYear}</span>
          <Value node="lev.iy" member={lever} format="money" />
        </div>
        <div className="gp-wz-kpi">
          <span className="gp-wz-eyebrow">{COPY.runRate}</span>
          <Value node="lev.rr" member={lever} format="money" />
        </div>
        <div className="gp-wz-kpi">
          <span className="gp-wz-eyebrow">{COPY.oneTime}</span>
          <Value node="lev.ot" member={lever} format="money" />
        </div>
      </div>
      {isOn && (
        <>
          <h3 className="gp-wz-eyebrow">{COPY.decisions}</h3>
          <Sliders ids={decisions} moved={moved} />
          <details className="gp-wz-details">
            <summary>{COPY.assumptions}</summary>
            <ConfidenceDial lever={lever} />
            <Sliders ids={assumptions} moved={moved} />
          </details>
        </>
      )}
    </GlassPanel>
  );
}

/**
 * Step 2 · Tune: the controls of the levers chosen in step 1. The list shows only levers whose
 * `lev.on` is 1; the detail shows `focusLever` (default: the first lever in tier 2's order) with
 * one slider per `lev.<Lxx>.*` registry variable, decisions first, estimates under Assumptions.
 */
export function StepTune() {
  const families = useView('levers.families', {});
  const labels = useLeverLabels();
  const focus = useWizard((s) => s.focusLever);
  const order: readonly string[] = families.payload?.families.flatMap((f) => f.levers) ?? [];
  const shown = focus !== null && order.includes(focus) ? focus : (order[0] ?? null);
  return (
    <section data-wizard-step="2" aria-label="Step 2">
      <Grid>
        <GlassPanel
          as="section"
          span={4}
          header={{ label: COPY.chosen, labelAs: 'h2' }}
          loading={families.payload === undefined}
        >
          <ul className="gp-wz-chosen">
            {order.map((lever) => (
              <ChosenRow
                key={lever}
                lever={lever}
                label={labels[lever] ?? lever}
                focused={lever === shown}
              />
            ))}
          </ul>
        </GlassPanel>
        {shown !== null ? (
          <Detail key={shown} lever={shown} label={labels[shown] ?? shown} />
        ) : (
          <GlassPanel as="section" span={8} header={{ label: COPY.levers, labelAs: 'h2' }} loading />
        )}
      </Grid>
    </section>
  );
}
