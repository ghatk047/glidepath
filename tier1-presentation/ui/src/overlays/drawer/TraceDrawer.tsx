import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { GlassPanel } from '../../glass';
import { prefersReducedMotion } from '../../motion/reduced';
import { OverlayStyles } from './OverlayStyles';
import { drawerMs } from './styles';

/** One line of the upstream chain or of the top drivers. Values arrive formatted (`fmt`). */
export interface TraceItem {
  /** Node or lever id, used verbatim, e.g. `res.net`, `L05`. */
  id: string;
  label: ReactNode;
  value: ReactNode;
}

/** What the drawer shows for one node. Everything arrives from tier 2 via web; nothing is computed here. */
export interface TraceContent {
  /** Node name for the header: "Trace · {title}". */
  title: ReactNode;
  /** Node value, formatted. */
  value: ReactNode;
  /** Node id, verbatim from the registry, e.g. `res.net`. */
  nodeId: string;
  /** Formula in words. */
  formula: ReactNode;
  /** Chain from the first input to this node; the item whose id is `nodeId` (else the last) is highlighted. */
  upstream?: readonly TraceItem[];
  /** Top drivers, in the order given. */
  drivers?: readonly TraceItem[];
}

export interface TraceDrawerProps {
  /** The node to trace. `null` closes the drawer. */
  content: TraceContent | null;
  /** Override: open state. Default: open while `content` is not null. */
  open?: boolean;
  /** Escape, outside click or the close button. */
  onClose: () => void;
  /**
   * Pointer presses on elements matching this selector do not count as outside clicks, so the
   * trace trigger can re-point the drawer. Default `[data-node],[data-trace]` (prototype).
   */
  ignoreOutside?: string;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Trace drawer (`openTrace`): right side, 420 px, glass level 3. Shows the node value, id, the
 * formula in words, the upstream chain and the top drivers. Closes on Escape or a press outside;
 * focus moves in on open, is trapped while open and returns to the trigger on close.
 * Presentational: content is a prop; web fills it from the session.
 */
export function TraceDrawer({
  content,
  open: openProp,
  onClose,
  ignoreOutside = '[data-node],[data-trace]',
}: TraceDrawerProps) {
  const open = openProp ?? content !== null;
  // keep the last content while the drawer slides out
  const [last, setLast] = useState<TraceContent | null>(content);
  if (content !== null && content !== last) setLast(content);
  const shown = content ?? last;

  // stay mounted for the exit slide, then drop the glass surface (it holds a blur slot)
  const [present, setPresent] = useState(open && shown !== null);
  if (open && shown !== null && !present) setPresent(true);
  useEffect(() => {
    if (open) return;
    const t = setTimeout(() => setPresent(false), prefersReducedMotion() ? 0 : drawerMs);
    return () => clearTimeout(t);
  }, [open]);

  const rootRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const titleId = useId();
  const active = open && present && shown !== null;

  useEffect(() => {
    if (!active) return;
    const before = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();

    const root = () => rootRef.current;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const el = root();
      if (!el) return;
      const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0]!;
      const lastItem = items[items.length - 1]!;
      const at = document.activeElement;
      if (!el.contains(at)) {
        e.preventDefault();
        (e.shiftKey ? lastItem : first).focus();
      } else if (e.shiftKey && at === first) {
        e.preventDefault();
        lastItem.focus();
      } else if (!e.shiftKey && at === lastItem) {
        e.preventDefault();
        first.focus();
      }
    };
    // pointerdown, not click: the press that opened the drawer must not close it
    const onPress = (e: Event) => {
      const t = e.target as Element | null;
      if (!t || root()?.contains(t)) return;
      if (ignoreOutside && t.closest?.(ignoreOutside)) return;
      onCloseRef.current();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPress);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPress);
      if (before && before.isConnected) before.focus();
    };
  }, [active, ignoreOutside]);

  if (!present || shown === null) return null;
  const { title, value, nodeId, formula, upstream, drivers } = shown;
  const current = upstream?.some((u) => u.id === nodeId) ? nodeId : upstream?.at(-1)?.id;

  return (
    <>
      <OverlayStyles />
      <div
        ref={rootRef}
        className="gp-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-state={open ? 'open' : 'closed'}
        inert={!open || undefined}
      >
        <GlassPanel as="div" level={3} className="gp-drawer-panel">
          <div className="gp-drawer-h">
            <h2 id={titleId} className="gp-drawer-title">
              Trace · {title}
            </h2>
            <button
              ref={closeRef}
              type="button"
              className="gp-drawer-close"
              aria-label="Close"
              onClick={() => onClose()}
            >
              <span aria-hidden="true">✕</span>
            </button>
          </div>
          <p className="gp-drawer-value" data-slot="value">
            {value}
          </p>
          <p className="gp-drawer-id" data-slot="node-id">
            {nodeId}
          </p>
          <p className="gp-drawer-formula" data-slot="formula">
            {formula}
          </p>
          {upstream && upstream.length > 0 && (
            <section data-slot="upstream" aria-labelledby={`${titleId}-up`}>
              <h3 id={`${titleId}-up`} className="gp-drawer-h3">
                Upstream
              </h3>
              <ol className="gp-drawer-list gp-drawer-chain">
                {upstream.map((u) => (
                  <li
                    key={u.id}
                    className="gp-drawer-row"
                    data-node-id={u.id}
                    aria-current={u.id === current ? 'step' : undefined}
                  >
                    <span>{u.label}</span>
                    <span>{u.value}</span>
                  </li>
                ))}
              </ol>
            </section>
          )}
          {drivers && drivers.length > 0 && (
            <section data-slot="drivers" aria-labelledby={`${titleId}-dr`}>
              <h3 id={`${titleId}-dr`} className="gp-drawer-h3">
                Top drivers
              </h3>
              <ul className="gp-drawer-list gp-drawer-drivers">
                {drivers.map((d) => (
                  <li key={d.id} className="gp-drawer-row" data-node-id={d.id}>
                    <span>{d.label}</span>
                    <span>{d.value}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </GlassPanel>
      </div>
    </>
  );
}
