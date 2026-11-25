import type { ReactNode } from 'react';
import { hudCss } from '@glidepath/ui/hud';

/**
 * Screen-state chips of the global layer (IA §6): error (neg, tier 2's `problem.detail` as the
 * one line of cause and fix), reconnecting (session dropped, values dim) and stale (the stored
 * calc predates the scenario or model version: "Recalculate"). Icon + word, never colour alone.
 * Rule warnings of the last commit show verbatim as warn chips.
 * They reuse the ui chip (`.gp-chip`, `hudCss`); the texts come from tier 2 or are UX copy.
 */

export type ShellState =
  | { kind: 'error'; detail: string; onDismiss?: () => void }
  | { kind: 'warning'; detail: string }
  | { kind: 'reconnecting' }
  | { kind: 'stale' };

const ICON = { error: '⚠', warning: '⚠', reconnecting: '↻', stale: '●' } as const;
const TONE = { error: 'neg', warning: 'warn', reconnecting: 'warn', stale: 'neutral' } as const;

function Chip({ state, children }: { state: ShellState['kind']; children: ReactNode }) {
  return (
    <span className="gp-chip" data-tone={TONE[state]} data-state={state}>
      <span className="gp-chip-icon" aria-hidden="true">
        {ICON[state]}
      </span>{' '}
      <span className="gp-chip-text">{children}</span>
    </span>
  );
}

export function StateChips({ states }: { states: readonly ShellState[] }) {
  return (
    <>
      <style href="glidepath-hud" precedence="glidepath">
        {hudCss}
      </style>
      <div className="gp-states" role="status" aria-live="polite">
        {states.map((s, i) => {
          if (s.kind === 'error')
            return (
              <Chip key={`error-${String(i)}`} state="error">
                {s.detail}
                {s.onDismiss && (
                  <button
                    type="button"
                    className="gp-chip-dismiss"
                    aria-label="Dismiss"
                    onClick={s.onDismiss}
                  >
                    ×
                  </button>
                )}
              </Chip>
            );
          if (s.kind === 'warning')
            return (
              <Chip key={`warning-${String(i)}`} state="warning">
                {s.detail}
              </Chip>
            );
          if (s.kind === 'reconnecting')
            return (
              <Chip key="reconnecting" state="reconnecting">
                Reconnecting
              </Chip>
            );
          return (
            <Chip key="stale" state="stale">
              Recalculate
            </Chip>
          );
        })}
      </div>
    </>
  );
}
