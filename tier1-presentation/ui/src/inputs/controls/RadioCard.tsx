import { useId, type ReactNode } from 'react';
import { useControlsStyles } from './styles';

export interface RadioCardOption<K extends string = string> {
  id: K;
  label: ReactNode;
}
export interface RadioCardProps<K extends string = string> {
  variableId?: string;
  /** Accessible name of the radio group. */
  label: string;
  options: readonly RadioCardOption<K>[];
  value: K;
  onChange?: (id: K) => void;
}

/** Radio cards (#14), e.g. solver objective. Checked = glass-2 + hairline. */
export function RadioCard<K extends string = string>({ variableId, label, options, value, onChange }: RadioCardProps<K>) {
  useControlsStyles();
  const name = useId();
  return (
    <div role="radiogroup" aria-label={label} data-variable-id={variableId}>
      {options.map((o) => (
        <label key={o.id} className="gp-radio-card" data-checked={o.id === value ? '' : undefined}>
          <input type="radio" name={name} value={o.id} checked={o.id === value} onChange={() => onChange?.(o.id)} />
          {o.label}
        </label>
      ))}
    </div>
  );
}
