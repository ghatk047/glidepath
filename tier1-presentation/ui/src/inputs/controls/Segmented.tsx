import type { ReactNode } from 'react';
import { useControlsStyles } from './styles';

export interface SegmentedOption<K extends string = string> {
  id: K;
  label: ReactNode;
}
export interface SegmentedProps<K extends string = string> {
  variableId?: string;
  /** Accessible name of the group. */
  label: string;
  options: readonly SegmentedOption<K>[];
  value: K;
  size?: 'md' | 'sm';
  onChange?: (id: K) => void;
}

/** Segmented control (#12) for enums: target method, valuation basis. aria-pressed marks the choice. */
export function Segmented<K extends string = string>({ variableId, label, options, value, size = 'md', onChange }: SegmentedProps<K>) {
  useControlsStyles();
  return (
    <div className="gp-seg" role="group" aria-label={label} data-size={size} data-variable-id={variableId}>
      {options.map((o) => (
        <button key={o.id} type="button" data-k={o.id} aria-pressed={o.id === value} onClick={() => onChange?.(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
