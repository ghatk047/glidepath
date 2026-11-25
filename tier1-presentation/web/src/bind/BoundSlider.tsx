import { Skeleton } from '@glidepath/ui/glass';
import { Slider, type SliderVariant } from '@glidepath/ui/inputs/slider';
import type { VariableKind } from '@glidepath/api-contract';
import { BoundEditable } from './BoundEditable';
import { formatFor, type FormatProp } from './format';
import { useGhosts } from './useGhosts';
import { useVariable } from './useVariable';

export interface BoundSliderProps {
  /** Registry variable id, verbatim (`lev.L10.shelf`). */
  variable: string;
  member?: string;
  /** Scenario keys whose values show as ghost ticks, e.g. `['C', 'D']` (inventory #7). */
  ghosts?: readonly string[];
  /** Overrides the unit-based value label. */
  format?: FormatProp;
  className?: string;
}

const NO_GHOSTS: readonly string[] = [];

/** Decision thumb for `kind: decision`; every other kind is an estimate (#8: solvers never move it). */
const variantOf = (kind: VariableKind): SliderVariant =>
  kind === 'decision' ? 'decision' : 'estimate';

/**
 * `<BoundSlider variable="lev.L10.shelf" ghosts={['C','D']} />`: Slider · decision / estimate
 * (#7, #8) bound to a variable. Definition (label, unit, min, max, step, kind) from the bundle,
 * value from the session, ghost ticks from the named scenarios' resolved inputs. Drag sends
 * previews; release commits. A value outside [min, max] (e.g. a seed above the registry max) is
 * only clamped on the track by the slider; it is never rewritten unless the user moves it.
 */
export function BoundSlider({
  variable,
  member = '',
  ghosts = NO_GHOSTS,
  format,
  className,
}: BoundSliderProps) {
  const v = useVariable(variable, member);
  const ghostTicks = useGhosts(variable, member, ghosts);
  const d = v.definition;

  if (!d || v.value === undefined) {
    return (
      <span className={className} aria-busy="true">
        <Skeleton size="text" width="100%" />
      </span>
    );
  }
  if (d.min === null || d.max === null || d.step === null || v.value === null) {
    // No track without limits or a value: fall back to the editable number.
    return (
      <BoundEditable variable={variable} member={member} format={format} className={className} />
    );
  }

  const fail = () => undefined; // WEB-05 surfaces commit errors.
  const label =
    format !== undefined ? { format: formatFor(format, d.unit, d.step, d.percentScale) } : {};
  return (
    <div data-stale={v.stale || undefined} className={className}>
      <Slider
        variant={variantOf(d.kind)}
        label={d.label}
        value={v.value}
        min={d.min}
        max={d.max}
        step={d.step}
        unit={d.unit}
        percentScale={d.percentScale}
        ghosts={ghostTicks}
        onPreview={v.preview}
        onCommit={(next) => void v.commit(next).catch(fail)}
        {...label}
      />
    </div>
  );
}
