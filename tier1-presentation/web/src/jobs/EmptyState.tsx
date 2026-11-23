import type { ReactNode } from 'react';
import { JobsStyles } from './styles';

export interface EmptyStateProps {
  /** The one line, e.g. "This scenario has not been simulated." */
  line: ReactNode;
  /** The one action, e.g. `{ label: 'Run 2,000 trials', onAction }`. */
  action: {
    label: ReactNode;
    onAction: () => void;
    /** Disable while the action's job is already running. */
    disabled?: boolean;
  };
  className?: string;
}

/**
 * Designed empty panel body (02 §6 "Empty"): one line and one action, nothing else. Put it
 * where the panel's content would be; the caller supplies both texts and what the action does.
 */
export function EmptyState({ line, action, className }: EmptyStateProps) {
  return (
    <>
      <JobsStyles />
      <div className={className ? `gp-empty ${className}` : 'gp-empty'} data-state="empty">
        <p className="gp-empty-line">{line}</p>
        <button
          type="button"
          className="gp-empty-action"
          disabled={action.disabled}
          onClick={action.onAction}
        >
          {action.label}
        </button>
      </div>
    </>
  );
}
