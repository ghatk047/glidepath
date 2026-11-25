import { useMemo, type CSSProperties } from 'react';
import { DimKey, type LeversFamiliesView } from '@glidepath/api-contract';
import { fmt } from '@glidepath/ui/format';
import { GlassPanel, Grid } from '@glidepath/ui/glass';
import { Toggle } from '@glidepath/ui/inputs/controls';
import { Value, useBindContext, useNode, useVariable, useView } from '../../bind';
import { useMembers } from '../../data';
import { COPY } from './copy';
import { wizardStore } from './store';

const LEVER_DIM = DimKey.parse('lever');

/** Lever names: the `lever` members' labels, tenant data, never literals. */
export function useLeverLabels(): Readonly<Record<string, string>> {
  const { tenant } = useBindContext();
  const members = useMembers(tenant);
  const leverMembers = members.data?.dimensions[LEVER_DIM];
  return useMemo(() => {
    const out: Record<string, string> = {};
    for (const m of leverMembers ?? []) out[m.key] = m.label;
    return out;
  }, [leverMembers]);
}

interface RowProps {
  lever: string;
  label: string;
  scaleMax: number | undefined;
}

/** One lever: `lev.on` toggle, name (focus + go to Tune), in-year bar and value, confidence. */
function LeverRow({ lever, label, scaleMax }: RowProps) {
  const on = useVariable('lev.on', lever);
  const iy = useNode('lev.iy', lever);
  const isOn = on.value !== 0;
  const style = { '--value': iy.value ?? 0, '--max': scaleMax ?? 1 } as CSSProperties;
  return (
    <li
      className="gp-wz-row"
      data-off={!isOn || undefined}
      data-stale={on.stale || iy.stale || undefined}
    >
      <Toggle
        variableId="lev.on"
        label={`${label} on`}
        value={isOn}
        disabled={on.value === undefined}
        onChange={(next) => void on.commit(next ? 1 : 0).catch(() => undefined)}
      />
      <span className="gp-wz-main">
        <button
          type="button"
          className="gp-wz-name"
          data-lever={lever}
          title={label}
          onClick={() => {
            const w = wizardStore.getState();
            w.setFocusLever(lever);
            w.setStep(2);
          }}
        >
          {label}
        </button>
        <span className="gp-wz-bar" aria-hidden="true">
          <i style={style} />
        </span>
      </span>
      <Value node="lev.iy" member={lever} format="money" className="gp-wz-iy" />
      <Value node="lev.conf" member={lever} format="pct" className="gp-wz-conf" />
    </li>
  );
}

function FamilyBars({ families }: { families: LeversFamiliesView }) {
  return (
    <>
      {families.families.map((f) => {
        const style = { '--value': f.value, '--max': families.total } as CSSProperties;
        return (
          <div key={f.key} className="gp-wz-fam-row" data-family={f.key}>
            <div className="gp-wz-fam-head">
              <span>{f.label}</span>
              <span data-family-total={f.key} data-value={f.value}>
                {fmt.money(f.value)}
              </span>
            </div>
            <span className="gp-wz-fam-bar" aria-hidden="true">
              <i style={style} />
            </span>
          </div>
        );
      })}
      <div className="gp-wz-total" data-node="res.tot_iy">
        <span className="gp-wz-eyebrow">{COPY.total}</span>
        <Value node="res.tot_iy" format="money" />
      </div>
    </>
  );
}

/**
 * Step 1 · Levers: every lever by family (tier 2's `levers.families` order) with its on/off
 * switch. Families and the in-year bar scale are tier 2's views; nothing is counted here.
 */
export function StepLevers() {
  const families = useView('levers.families', {});
  const scale = useView('levers.scale', {});
  const labels = useLeverLabels();
  const loading = families.payload === undefined;
  return (
    <section data-wizard-step="1" aria-label="Step 1">
      <Grid>
        <GlassPanel
          as="section"
          span={8}
          className="gp-wz-levers"
          header={{ label: COPY.levers, labelAs: 'h2' }}
          loading={loading}
        >
          {families.payload?.families.map((f) => (
            <div key={f.key} className="gp-wz-group" role="group" aria-label={f.label}>
              <div className="gp-wz-family">
                <h3 className="gp-wz-eyebrow">{f.label}</h3>
                <span className="gp-wz-eyebrow">{fmt.money(f.value)}</span>
              </div>
              <ul className="gp-wz-list">
                {f.levers.map((lever) => (
                  <LeverRow
                    key={lever}
                    lever={lever}
                    label={labels[lever] ?? lever}
                    scaleMax={scale.payload?.max}
                  />
                ))}
              </ul>
            </div>
          ))}
        </GlassPanel>
        <GlassPanel
          as="section"
          span={4}
          header={{ label: COPY.families, labelAs: 'h2' }}
          loading={loading}
        >
          {families.payload && <FamilyBars families={families.payload} />}
        </GlassPanel>
      </Grid>
    </section>
  );
}
