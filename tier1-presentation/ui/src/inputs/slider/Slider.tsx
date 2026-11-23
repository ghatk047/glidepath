import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import { formatByUnit, percentOf, snapToStep } from './display';
import { sliderCss } from './styles';
import { latestThrottle, type LatestThrottle } from './throttle';

/** Registry `kind` of the variable: decision (lever) or estimate (#7, #8). */
export type SliderVariant = 'decision' | 'estimate';

/** A reference tick on the track, e.g. the C and D scenario values: `{ label: 'C', value }`. */
export interface SliderGhost {
  label: string;
  value: number;
}

export interface SliderProps {
  /** decision = white thumb on accent fill; estimate = grey fill, lock icon and tooltip. */
  variant?: SliderVariant;
  /** Visible label; also the input's accessible name. */
  label: string;
  /** Current value from tier 2, in model units (0.18 for 18%). */
  value: number;
  /** Display metadata from the variable definition. */
  min: number;
  max: number;
  step: number;
  /** Registry unit (`%`, `$M`, `FTE`, `x`, ...): picks the value label format. */
  unit: string;
  /** Reference ticks (C and D). Ghosts outside [min, max] are not drawn. */
  ghosts?: readonly SliderGhost[];
  /** While dragging: at most once per 33 ms, latest value wins. */
  onPreview?: (value: number) => void;
  /** On release, key release, Enter or blur, once per gesture. */
  onCommit?: (value: number) => void;
  /** Overrides the unit-based value label. */
  format?: (value: number) => string;
  /** Input id; generated when omitted. */
  id?: string;
  className?: string;
}

/** Tooltip on the estimate lock (04_component_inventory #8). */
export const ESTIMATE_TOOLTIP = 'Estimate: solvers never move it';

/** Page Up / Page Down move this many steps. */
const PAGE_STEPS = 10;
const COMMIT_KEYS = new Set([
  'ArrowRight',
  'ArrowUp',
  'ArrowLeft',
  'ArrowDown',
  'PageUp',
  'PageDown',
  'Home',
  'End',
]);

/** Lock glyph from the prototype icon set (core.js `ICONS.lock`). */
function LockIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

interface Local {
  value: number;
  /** Changed since the last commit. */
  dirty: boolean;
}

/**
 * Slider · decision (#7) and Slider · estimate (#8). A native `input type=range`.
 * The thumb and value label move locally on every frame; tier 2 hears previews (throttled) and
 * one commit per gesture. The shown value follows the `value` prop again once tier 2 sends a new
 * one, except while a change is still uncommitted.
 */
export function Slider({
  variant = 'decision',
  label,
  value,
  min,
  max,
  step,
  unit,
  ghosts = [],
  onPreview,
  onCommit,
  format,
  id,
  className,
}: SliderProps) {
  const autoId = useId();
  const inputId = id ?? `gp-slider-${autoId}`;
  const tipId = `${inputId}-tip`;
  const ghostsId = `${inputId}-ghosts`;
  const estimate = variant === 'estimate';

  const [local, setLocal] = useState<Local | null>(null);
  const [prevValue, setPrevValue] = useState(value);
  if (prevValue !== value) {
    setPrevValue(value);
    if (!local?.dirty) setLocal(null);
  }

  const shown = snapToStep(local?.value ?? value, min, max, step);
  const text = (v: number) => (format ? format(v) : formatByUnit(v, unit, step));

  // Handlers read refs, so a burst of events inside one frame sees the latest value.
  const inputRef = useRef<HTMLInputElement>(null);
  const liveRef = useRef(shown);
  const dirtyRef = useRef(false);
  const onPreviewRef = useRef(onPreview);
  const onCommitRef = useRef(onCommit);
  useEffect(() => {
    onPreviewRef.current = onPreview;
    onCommitRef.current = onCommit;
  });
  const throttleRef = useRef<LatestThrottle<number> | null>(null);
  const throttle = () =>
    (throttleRef.current ??= latestThrottle<number>((v) => onPreviewRef.current?.(v)));
  useEffect(() => () => throttleRef.current?.cancel(), []);

  const set = (raw: number) => {
    const next = snapToStep(raw, min, max, step);
    const current = dirtyRef.current ? liveRef.current : shown;
    if (next === current) return;
    dirtyRef.current = true;
    liveRef.current = next;
    setLocal({ value: next, dirty: true });
    throttle().push(next);
  };

  const commit = useCallback(() => {
    if (!dirtyRef.current) return;
    dirtyRef.current = false;
    throttleRef.current?.cancel();
    const v = liveRef.current;
    setLocal({ value: v, dirty: false });
    onCommitRef.current?.(v);
  }, []);

  // The browser fires a native `change` on release (and for assistive-tech adjustments);
  // React's onChange follows `input`, so listen for it directly.
  useEffect(() => {
    const el = inputRef.current;
    el?.addEventListener('change', commit);
    return () => el?.removeEventListener('change', commit);
  }, [commit]);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      commit();
      return;
    }
    if (!COMMIT_KEYS.has(e.key)) return;
    e.preventDefault();
    const base = dirtyRef.current ? liveRef.current : shown;
    const unitStep = step > 0 ? step : (max - min) / 100;
    const delta: Record<string, number> = {
      ArrowRight: unitStep,
      ArrowUp: unitStep,
      ArrowLeft: -unitStep,
      ArrowDown: -unitStep,
      PageUp: unitStep * PAGE_STEPS,
      PageDown: -unitStep * PAGE_STEPS,
    };
    if (e.key === 'Home') set(min);
    else if (e.key === 'End') set(max);
    else set(base + delta[e.key]!);
  };

  const onKeyUp = (e: KeyboardEvent<HTMLInputElement>) => {
    if (COMMIT_KEYS.has(e.key)) commit();
  };

  const visibleGhosts = ghosts.filter((g) => g.value >= min && g.value <= max);
  const describedBy =
    [estimate ? tipId : null, visibleGhosts.length ? ghostsId : null].filter(Boolean).join(' ') ||
    undefined;
  const label$ = text(shown);
  const cls = ['gp-slider', estimate ? 'est' : null, className].filter(Boolean).join(' ');

  return (
    <div className={cls} data-variant={variant}>
      <style href="gp-slider" precedence="gp-ui">
        {sliderCss}
      </style>
      <div className="gp-slider-head">
        <label className="gp-slider-label" htmlFor={inputId}>
          {label}
          {estimate ? (
            <span className="gp-slider-lock">
              <LockIcon />
            </span>
          ) : null}
        </label>
        <output className="gp-slider-value" htmlFor={inputId} aria-hidden="true">
          {label$}
        </output>
        {estimate ? (
          <span className="gp-slider-tip" role="tooltip" id={tipId}>
            {ESTIMATE_TOOLTIP}
          </span>
        ) : null}
      </div>
      <div className="gp-slider-range">
        {visibleGhosts.map((g) => (
          <span
            key={g.label}
            className="gp-slider-ghost"
            aria-hidden="true"
            style={{ left: `${percentOf(g.value, min, max)}%` }}
          >
            <b>{g.label}</b>
          </span>
        ))}
        <input
          ref={inputRef}
          type="range"
          id={inputId}
          min={min}
          max={max}
          step={step}
          value={shown}
          aria-valuetext={label$}
          aria-describedby={describedBy}
          style={{ '--p': `${percentOf(shown, min, max)}%` } as CSSProperties}
          onChange={(e) => set(Number(e.currentTarget.value))}
          onPointerUp={commit}
          onKeyDown={onKeyDown}
          onKeyUp={onKeyUp}
          onBlur={commit}
        />
        {visibleGhosts.length ? (
          <span className="gp-slider-sr" id={ghostsId}>
            {`Reference marks: ${visibleGhosts.map((g) => `${g.label} ${text(g.value)}`).join(', ')}`}
          </span>
        ) : null}
      </div>
    </div>
  );
}
