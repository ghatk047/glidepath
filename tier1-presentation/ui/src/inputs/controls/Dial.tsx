import { useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { useControlsStyles } from './styles';

export interface DialProps {
  /** Verbatim variable id; web binds it (ADR-018). Exposed as data-variable-id. */
  variableId?: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  /** Ghost tick position. */
  defaultValue: number;
  /** Display text; formatting comes from `fmt.*`. */
  format?: (n: number) => string;
  onChange?: (value: number) => void;
  /** Called when a drag or key press ends. */
  onCommit?: (value: number) => void;
}

/** Pointer travel (px) for a full min-to-max sweep while dragging up/down (prototype). */
const DRAG_PX_FULL_RANGE = 160;
const START = Math.PI * 0.75;
const SWEEP = Math.PI * 1.5;
const C = 48;

const polar = (r: number, a: number): [number, number] => [C + r * Math.cos(a), C + r * Math.sin(a)];
const arc = (r: number, a0: number, a1: number) => {
  const [x0, y0] = polar(r, a0);
  const [x1, y1] = polar(r, a1);
  return `M${x0} ${y0}A${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1} ${y1}`;
};
const decimals = (n: number) => (String(n).split('.')[1] ?? '').length;

/** 270° dial (#11). Drag up/down or use arrow keys; the ghost tick marks the default. */
export function Dial({ variableId, label, value, min, max, step, defaultValue, format, onChange, onCommit }: DialProps) {
  useControlsStyles();
  const drag = useRef<{ y: number; v: number } | null>(null);
  const last = useRef(value);
  last.current = value;

  const frac = (n: number) => (max === min ? 0 : (n - min) / (max - min));
  const snap = (n: number) => {
    const s = Math.round((Math.max(min, Math.min(max, n)) - min) / step) * step + min;
    const p = 10 ** (decimals(step) + decimals(min));
    return Math.max(min, Math.min(max, Math.round(s * p) / p));
  };
  const set = (n: number) => {
    const next = snap(n);
    if (next !== last.current) {
      last.current = next;
      onChange?.(next);
    }
  };

  const a = START + SWEEP * frac(value);
  const [hx, hy] = polar(30, a);
  const ga = START + SWEEP * frac(defaultValue);
  const [gx, gy] = polar(40, ga);
  const [gx2, gy2] = polar(34, ga);

  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    const up = e.key === 'ArrowUp' || e.key === 'ArrowRight';
    const down = e.key === 'ArrowDown' || e.key === 'ArrowLeft';
    if (up || down) set(value + (up ? step : -step));
    else if (e.key === 'Home') set(min);
    else if (e.key === 'End') set(max);
    else return;
    e.preventDefault();
    onCommit?.(last.current);
  };
  const onDown = (e: PointerEvent<SVGSVGElement>) => {
    drag.current = { y: e.clientY, v: value };
    e.currentTarget.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  };
  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (d) set(d.v + ((d.y - e.clientY) / DRAG_PX_FULL_RANGE) * (max - min));
  };
  const onUp = () => {
    if (drag.current) {
      drag.current = null;
      onCommit?.(last.current);
    }
  };
  const text = format ? format(value) : String(value);

  return (
    <div className="gp-dial" data-variable-id={variableId}>
      <svg
        viewBox="0 0 96 96"
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuenow={value}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuetext={text}
        onKeyDown={onKey}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        <path className="gp-dial-track" d={arc(37, START, START + SWEEP)} />
        <path className="gp-dial-arc" d={arc(37, START, Math.max(START + 0.001, a))} />
        <line className="gp-dial-ghost" data-testid="dial-ghost" x1={gx} y1={gy} x2={gx2} y2={gy2} />
        <circle className="gp-dial-cap" cx={C} cy={C} r={24} />
        <circle className="gp-dial-handle" cx={hx} cy={hy} r={4.5} />
      </svg>
      <span className="gp-dial-value">{text}</span>
      <span className="gp-dial-label">{label}</span>
    </div>
  );
}
