import type { CSSProperties } from 'react';
import type { BundleResponse, LeversMonthlyView } from '@glidepath/api-contract';
import { fmt } from '@glidepath/ui/format';
import { GlassPanel } from '@glidepath/ui/glass';
import { MONTH_LETTERS, MONTH_NAMES } from '@glidepath/ui/charts/monthly';
import { Dial } from '@glidepath/ui/inputs/controls';
import { BoundEditable, BoundSlider, Value, useGhosts, useVariable } from '../../bind';

export interface LeverDetailProps {
  lever: string;
  label: string;
  /** Family label from `levers.families` (the chip "Technology"). */
  family: string | undefined;
  /** `hypothesis` attribute of the lever member, when tier 2 sends it. */
  hypothesis: string | undefined;
  variables: BundleResponse['variables'] | undefined;
  monthly: LeversMonthlyView | undefined;
}

/** Scenario keys whose values show as ghost ticks (inventory #7). */
const GHOSTS = ['C', 'D'] as const;

/** `lev.conf` as a Dial (#11): the default tick is the Balanced preset's value. */
function ConfidenceDial({ lever }: { lever: string }) {
  const conf = useVariable('lev.conf', lever);
  const ghost = useGhosts('lev.conf', lever, ['C']);
  const d = conf.definition;
  if (!d || d.min === null || d.max === null || d.step === null || typeof conf.value !== 'number') {
    return null;
  }
  return (
    <div className="gp-lv-conf" data-stale={conf.stale || undefined}>
      <Dial
        variableId="lev.conf"
        label="Confidence"
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

/** Timing strip: `lev.start` select, `lev.ramp`, the 12 monthly cells of `levers.monthly`. */
function Timing({ lever, monthly }: { lever: string; monthly: LeversMonthlyView | undefined }) {
  const start = useVariable('lev.start', lever);
  const series = monthly?.levers.find((l) => l.key === lever)?.values;
  // The tallest month sets the cell scale; the fill itself is drawn by CSS from `--value / --max`.
  const top = series ? Math.max(...series) : undefined;
  return (
    <section aria-label="Timing" data-stale={start.stale || undefined}>
      <div className="gp-lv-timing-head">
        <h3 className="gp-lv-eyebrow">Timing · 2027</h3>
        <label className="gp-lv-eyebrow" htmlFor={`gp-lv-start-${lever}`}>
          Start
        </label>
        <select
          id={`gp-lv-start-${lever}`}
          className="gp-lv-select"
          data-variable-id="lev.start"
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
        <span className="gp-lv-eyebrow">
          ramp <BoundEditable variable="lev.ramp" member={lever} />
        </span>
      </div>
      <ol className="gp-lv-cells">
        {MONTH_LETTERS.map((letter, i) => {
          const v = series?.[i];
          const style = { '--value': v ?? 0, '--max': top ?? 1 } as CSSProperties;
          return (
            <li
              key={`${letter}${String(i)}`}
              aria-label={`${MONTH_NAMES[i] ?? letter} ${fmt.money(v)}`}
              data-month-value={v}
            >
              <span className="gp-lv-cell" aria-hidden="true">
                <i style={style} />
              </span>
              <span aria-hidden="true">{letter}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** Lever detail (panel 5). */
export function LeverDetail({
  lever,
  label,
  family,
  hypothesis,
  variables,
  monthly,
}: LeverDetailProps) {
  // One slider per `lev.Lxx.*` parameter in the registry (ids verbatim, order as tier 2 sent).
  const params = (variables ?? []).filter(
    (v) => v.id.startsWith(`lev.${lever}.`) && v.ui.control === 'slider',
  );
  return (
    <GlassPanel
      as="section"
      span={5}
      header={{ label: 'Lever detail', labelAs: 'h2' }}
      data-lever-detail={lever}
    >
      <div className="gp-lv-chips">
        <span className="gp-lv-chip" data-chip="id">
          {lever}
        </span>
        {family !== undefined && (
          <span className="gp-lv-chip" data-chip="category">
            {family}
          </span>
        )}
        <span className="gp-lv-chip" data-chip="confidence" data-tone="accent">
          Confidence <Value node="lev.conf" member={lever} format="pct" />
        </span>
      </div>
      <h3 className="gp-lv-title">{label}</h3>
      <div className="gp-lv-kpis">
        <div className="gp-lv-kpi" data-hero="true">
          <span className="gp-lv-eyebrow">In-year</span>
          <Value node="lev.iy" member={lever} format="money" />
        </div>
        <div className="gp-lv-kpi">
          <span className="gp-lv-eyebrow">Run-rate</span>
          <Value node="lev.rr" member={lever} format="money" />
        </div>
        <div className="gp-lv-kpi">
          <span className="gp-lv-eyebrow">One-time</span>
          <Value node="lev.ot" member={lever} format="money" />
        </div>
      </div>
      <ConfidenceDial lever={lever} />
      <div className="gp-lv-sliders">
        {params.map((p) => (
          <BoundSlider key={p.id} variable={p.id} ghosts={GHOSTS} />
        ))}
      </div>
      <Timing lever={lever} monthly={monthly} />
      {hypothesis !== undefined && hypothesis !== '' && <p className="gp-lv-hyp">{hypothesis}</p>}
    </GlassPanel>
  );
}
