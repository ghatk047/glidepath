import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react';
import { GlassPanel } from '../../glass';
import { useEditableStyles } from '../../inputs/editable';
import { prefersReducedMotion } from '../../motion';
import { useDialog } from '../palette/dialog';

export interface CoachmarkProps {
  /** Zero-based step index. */
  index: number;
  count: number;
  title: string;
  body: ReactNode;
  onNext: () => void;
  onBack: () => void;
  /** Skip (Escape, the Skip button). */
  onClose: () => void;
  /** Position, from `placeCard`. Omit when docked as a sheet. */
  style?: CSSProperties;
  sheet?: boolean;
  placement?: string;
  /** For the owner that measures the card. */
  cardRef?: RefObject<HTMLDivElement | null>;
}

const isEditable = (el: EventTarget | null): boolean => {
  const e = el as HTMLElement | null;
  if (!e || !e.tagName) return false;
  return e.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.tagName);
};

/**
 * The tour card: a level-3 glass dialog (not modal) with counter, title, body, Back / Next
 * (Done on the last step) / Skip and progress dots. Focus moves to Next on every step, Tab
 * cycles inside, and a polite live region announces "Step n of N: title" once per step.
 * Keys: ArrowRight and Enter next, ArrowLeft back, Escape skip.
 */
export function Coachmark({
  index,
  count,
  title,
  body,
  onNext,
  onBack,
  onClose,
  style,
  sheet,
  placement,
  cardRef,
}: CoachmarkProps) {
  useEditableStyles();
  const own = useRef<HTMLDivElement>(null);
  const ref = cardRef ?? own;
  const nextRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const bodyId = useId();
  const last = index >= count - 1;
  const first = index <= 0;
  const reduced = prefersReducedMotion();

  const handlers = useRef({ onNext, onBack });
  useEffect(() => {
    handlers.current = { onNext, onBack };
  });

  useDialog(ref, { onClose, modal: false });

  // focus lands on Next at each step
  useEffect(() => {
    nextRef.current?.focus();
  }, [index]);

  // arrows and Enter
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || isEditable(e.target)) return;
      const t = e.target as HTMLElement | null;
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        handlers.current.onNext();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        handlers.current.onBack();
      } else if (e.key === 'Enter') {
        // a focused button activates itself; Enter elsewhere advances
        if (t && t.closest('button, a[href]')) return;
        e.preventDefault();
        handlers.current.onNext();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // announce once per step (set after mount so assistive tech sees a change)
  const [said, setSaid] = useState('');
  useEffect(() => {
    setSaid(`Step ${index + 1} of ${count}: ${title}`);
  }, [index, count, title]);

  return (
    <GlassPanel
      as="div"
      level={3}
      padding="tight"
      // GlassPanel's props type has no `ref`, but React 19 passes it through its `...rest` spread
      {...({ ref } as object)}
      className="gp-tour-card"
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      data-tour-card=""
      data-placement={placement}
      data-sheet={sheet || undefined}
      style={{ ...style, ...(reduced ? { transition: 'none' } : null) }}
    >
      <div className="gp-tour-head">
        <span className="gp-tour-count">{`${index + 1} / ${count}`}</span>
        <span className="gp-tour-dots" aria-hidden="true">
          {Array.from({ length: count }, (_, i) => (
            <i key={i} className="gp-tour-dot" data-on={i <= index || undefined} />
          ))}
        </span>
      </div>
      <h2 id={titleId} className="gp-tour-title">
        {title}
      </h2>
      <div id={bodyId} className="gp-tour-body">
        {body}
      </div>
      <div className="gp-tour-actions">
        <button type="button" className="gp-btn" data-variant="ghost" onClick={onClose}>
          Skip
        </button>
        <button type="button" className="gp-btn" onClick={onBack} disabled={first} data-tour-back="">
          Back
        </button>
        <button
          ref={nextRef}
          type="button"
          className="gp-btn"
          data-variant="primary"
          data-autofocus=""
          onClick={onNext}
          data-tour-next=""
        >
          {last ? 'Done' : 'Next'}
        </button>
      </div>
      <div className="gp-tour-sr" role="status" aria-live="polite" aria-atomic="true">
        {said}
      </div>
    </GlassPanel>
  );
}
