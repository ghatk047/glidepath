import { useMemo, type CSSProperties } from 'react';
import type { VariableDef } from '@glidepath/api-contract';
import { GlassPanel, Skeleton } from '@glidepath/ui/glass';
import { Stepper } from '@glidepath/ui/inputs/controls';
import { Slider } from '@glidepath/ui/inputs/slider';
import { useViewStore } from '../../app/view-store';
import { useBindContext, useVariable } from '../../bind';
import { useBundle } from '../../data';
import { COPY, HERO_LABELS, STEPPER_UNITS } from './copy';

const fail = () => undefined; // the commit queue (WEB-05) surfaces errors in the shell

const labelOf = (def: VariableDef) => HERO_LABELS[def.id] ?? def.label;

/**
 * A hero slider: `useVariable` + the ui Slider with the Cockpit's short label. Drag sends
 * previews (throttled by the slider and the session), release commits. Hero sliders use the
 * decision look of the render (white thumb, accent fill); min, max, step and unit are the
 * registry's as the bundle sent them.
 */
function HeroSlider({ def }: { def: VariableDef }) {
  const v = useVariable(def.id);
  const d = v.definition;
  if (!d || typeof v.value !== 'number' || d.min === null || d.max === null || d.step === null) {
    return (
      <div className="gp-cockpit-input" aria-busy="true" data-variable-id={def.id}>
        <Skeleton size="text" width="100%" />
      </div>
    );
  }
  return (
    <div className="gp-cockpit-input" data-variable-id={def.id} data-stale={v.stale || undefined}>
      <Slider
        variant="decision"
        label={labelOf(def)}
        value={v.value}
        min={d.min}
        max={d.max}
        step={d.step}
        unit={d.unit}
        onPreview={v.preview}
        onCommit={(next) => void v.commit(next).catch(fail)}
      />
    </div>
  );
}

/** A hero stepper (head counts): each step or typed value previews, then commits. */
function HeroStepper({ def }: { def: VariableDef }) {
  const v = useVariable(def.id);
  const d = v.definition;
  const label = labelOf(def);
  return (
    <div className="gp-cockpit-input" data-variable-id={def.id} data-stale={v.stale || undefined}>
      <span className="gp-cockpit-input-label" aria-hidden="true">
        {label}
      </span>
      {d && typeof v.value === 'number' && d.step !== null ? (
        <Stepper
          variableId={def.id}
          label={label}
          value={v.value}
          step={d.step}
          {...(d.min !== null ? { min: d.min } : {})}
          {...(d.max !== null ? { max: d.max } : {})}
          onChange={(next) => {
            v.preview(next);
            void v.commit(next).catch(fail);
          }}
        />
      ) : (
        <Skeleton size="text" width="100%" />
      )}
    </div>
  );
}

function SearchGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <circle cx="11" cy="11" r="6" />
      <path d="M20 20l-4.5-4.5" />
    </svg>
  );
}

/**
 * Your inputs (7 cols): the registry's `ui.hero` inputs in registry order (AA: `g.target_net`,
 * `g.ot_out_share` as sliders; `hc.us`, `hc.gcc`, `hc.ctr` as steppers). "All N" (N = the
 * bundle's variable count) opens the command palette (⌘K).
 */
export function YourInputsPanel() {
  const { tenant } = useBindContext();
  const bundle = useBundle(tenant);
  const openPanel = useViewStore((s) => s.openPanel);
  const variables = bundle.data?.variables;
  const heroes = useMemo(() => (variables ?? []).filter((v) => v.ui.hero), [variables]);
  const count = variables ? variables.length : null;
  const sliders = heroes.filter((v) => !STEPPER_UNITS.has(v.unit));
  const steppers = heroes.filter((v) => STEPPER_UNITS.has(v.unit));
  const columns = {
    '--gp-hero-sliders': String(sliders.length),
    '--gp-hero-steppers': String(steppers.length),
  } as CSSProperties;

  return (
    <GlassPanel
      data-testid="cockpit-inputs"
      header={{
        label: COPY.inputsLabel,
        status: (
          <button
            type="button"
            className="gp-cockpit-all"
            aria-label={COPY.allInputsName(count)}
            aria-keyshortcuts="Meta+K Control+K"
            onClick={() => openPanel('commandPalette')}
          >
            <SearchGlyph />
            <span>{COPY.allInputs(count)}</span>
          </button>
        ),
      }}
      loading={!variables}
    >
      <div className="gp-cockpit-inputs" style={columns}>
        {sliders.map((def) => (
          <HeroSlider key={def.id} def={def} />
        ))}
        {steppers.map((def) => (
          <HeroStepper key={def.id} def={def} />
        ))}
      </div>
    </GlassPanel>
  );
}
