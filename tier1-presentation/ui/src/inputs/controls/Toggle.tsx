import { useControlsStyles } from './styles';

export interface ToggleProps {
  variableId?: string;
  /** Accessible name (the visible label lives next to the toggle). */
  label: string;
  value: boolean;
  disabled?: boolean;
  onChange?: (value: boolean) => void;
}

/** Switch (#12) whose knob springs between positions (toggle spring token). */
export function Toggle({ variableId, label, value, disabled, onChange }: ToggleProps) {
  useControlsStyles();
  return (
    <span className="gp-toggle" data-variable-id={variableId}>
      <input
        type="checkbox"
        role="switch"
        aria-label={label}
        checked={value}
        disabled={disabled}
        onChange={(e) => onChange?.(e.target.checked)}
      />
      <span className="gp-toggle-track" aria-hidden="true" />
    </span>
  );
}
