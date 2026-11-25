import { useState } from 'react';
import { fmt } from '../../format';
import { parseNumber } from '../editable';
import { useControlsStyles } from './styles';

export interface StepperProps {
  variableId?: string;
  label: string;
  value: number;
  step: number;
  min?: number;
  max?: number;
  /** Display text; default is plain en-US grouping. */
  format?: (n: number) => string;
  /** Typed text to number; default `parseNumber`. */
  parse?: (text: string) => number | null;
  onChange?: (value: number) => void;
}

const clamp = (n: number, min?: number, max?: number) =>
  Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));
const defaultFormat = (n: number) => fmt.fte(n);

/** Stepper (#12): minus / typed field / plus. Typed entry commits on Enter or blur. */
export function Stepper({ variableId, label, value, step, min, max, format = defaultFormat, parse = parseNumber, onChange }: StepperProps) {
  useControlsStyles();
  const [draft, setDraft] = useState<string | null>(null);
  const bump = (d: number) => onChange?.(clamp(Math.round((value + d) * 1e10) / 1e10, min, max));
  const commit = () => {
    if (draft === null) return;
    const n = parse(draft);
    setDraft(null);
    if (n !== null && n !== value) onChange?.(clamp(n, min, max));
  };
  return (
    <div className="gp-stepper" role="group" aria-label={label} data-variable-id={variableId}>
      <button type="button" aria-label={`Decrease ${label}`} disabled={min !== undefined && value <= min} onClick={() => bump(-step)}>
        −
      </button>
      <input
        inputMode="numeric"
        aria-label={label}
        value={draft ?? format(value)}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          else if (e.key === 'Escape') setDraft(null);
          else if (e.key === 'ArrowUp') {
            e.preventDefault();
            bump(step);
          } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            bump(-step);
          }
        }}
      />
      <button type="button" aria-label={`Increase ${label}`} disabled={max !== undefined && value >= max} onClick={() => bump(step)}>
        +
      </button>
    </div>
  );
}
