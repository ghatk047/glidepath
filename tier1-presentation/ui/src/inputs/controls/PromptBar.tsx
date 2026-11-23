import { useEffect, useState, type FormEvent } from 'react';
import { useControlsStyles } from './styles';

export interface PromptBarProps {
  /** Prompt text (initial, and re-synced when it changes). */
  value: string;
  /** Accessible name of the field. */
  label?: string;
  placeholder?: string;
  submitLabel?: string;
  /** Copy under the bar: states that the result is a changeset to review. */
  note?: string;
  onChange?: (value: string) => void;
  /** Receives the prompt. The consumer drafts a changeset for review; this never writes directly. */
  onSubmit: (value: string) => void;
}

export const PROMPT_NOTE = 'Ends in a reviewable changeset: nothing is written until you accept it.';

/** Prompt bar (#15): AI reconfiguration entry. Always ends in a reviewable changeset. */
export function PromptBar({
  value,
  label = 'Describe the change',
  placeholder,
  submitLabel = 'Draft',
  note = PROMPT_NOTE,
  onChange,
  onSubmit,
}: PromptBarProps) {
  useControlsStyles();
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (text.trim()) onSubmit(text);
  };
  return (
    <form className="gp-prompt" onSubmit={submit}>
      <input
        aria-label={label}
        placeholder={placeholder}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          onChange?.(e.target.value);
        }}
      />
      <button type="submit" disabled={!text.trim()}>
        {submitLabel}
      </button>
      <p className="gp-prompt-note">{note}</p>
    </form>
  );
}
