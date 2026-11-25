import { useEffect, useRef, useState, type ReactNode } from 'react';
import { GlassPanel } from '../glass';
import { springs } from '../motion/springs';
import { prefersReducedMotion } from '../motion/reduced';
import { HudStyles } from './HudStyles';

export interface ToastProps {
  /** Message to show. A new message (or a new `toastId`) shows the toast again; null/undefined shows nothing. */
  message: ReactNode | null | undefined;
  /** Optional leading icon (decorative). */
  icon?: ReactNode;
  /** Change this to show an identical message again. */
  toastId?: string | number;
  /** Called when the hold (token motion.toast, 2.4 s) is over and the toast starts to leave. */
  onClose?: () => void;
}

type Shown = { message: ReactNode; icon: ReactNode; state: 'open' | 'closing' };

/**
 * Toast (`toast`): top centre, springs in, stays 2.4 s (token motion.toast), then leaves.
 * The `role="status"` region is always mounted so the message is announced when it appears.
 */
export function Toast({ message, icon, toastId, onClose }: ToastProps) {
  const [shown, setShown] = useState<Shown | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (message === null || message === undefined || message === false) return;
    setShown({ message, icon, state: 'open' });
    let exit: ReturnType<typeof setTimeout> | undefined;
    const hold = setTimeout(() => {
      setShown((s) => (s ? { ...s, state: 'closing' } : s));
      onCloseRef.current?.();
      const leaveMs = prefersReducedMotion()
        ? springs.toast.reduced.durationMs
        : springs.toast.durationMs;
      exit = setTimeout(() => setShown(null), leaveMs);
    }, springs.toast.holdMs);
    return () => {
      clearTimeout(hold);
      clearTimeout(exit);
    };
    // `icon` is captured with the message it came with
  }, [message, toastId]);

  return (
    <>
      <HudStyles />
      <div className="gp-toast-region" role="status">
        {shown && (
          <GlassPanel
            as="div"
            level={3}
            padding="none"
            className="gp-toast"
            data-state={shown.state}
          >
            {shown.icon ? (
              <span className="gp-toast-icon" aria-hidden="true">
                {shown.icon}
              </span>
            ) : null}
            <span className="gp-toast-text">{shown.message}</span>
          </GlassPanel>
        )}
      </div>
    </>
  );
}
