import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { GlassPanel } from '../../glass';
import { useDialog } from './dialog';
import { usePaletteStyles } from './styles';

/** One change in the current Custom scenario. Texts arrive formatted (tier 2 / web apply `fmt`). */
export interface EditChange {
  /** Stable id of the changeset entry. */
  id: string;
  /** Who made it, e.g. "You", "AI", "Solver". */
  who: string;
  /** What changed, e.g. "Net target · CY27". */
  what: string;
  /** Value before, already formatted, e.g. "$100.0M". */
  from: string;
  /** Value after, already formatted. */
  to: string;
}

export interface EditsTrayProps {
  /** Number of changes in the current Custom scenario. A dot shows when > 0. */
  count: number;
  changes: readonly EditChange[];
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  /** "Save as scenario". The tray closes afterwards (the owner asks for the name). */
  onSaveAsScenario: () => void;
  /** "Discard" all edits. The tray closes afterwards (the owner confirms if it wants to). */
  onDiscard: () => void;
  /** Controlled open state; omit for uncontrolled. */
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Tray heading, e.g. "Changeset · Custom (from C)". */
  title?: string;
}

const TRAY_GAP = 10;

/**
 * Edits counter + changeset tray (#5). The counter is the top-bar button ("● 3 edits"); it opens
 * the tray: who / what / from → to for each change, undo, redo, save as scenario, discard.
 * Presentational: every text and flag arrives as props; the buttons only call back.
 */
export function EditsTray({
  count,
  changes,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onSaveAsScenario,
  onDiscard,
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  title = 'Changeset',
}: EditsTrayProps) {
  usePaletteStyles();
  const [inner, setInner] = useState(defaultOpen);
  const open = openProp ?? inner;
  const setOpen = (next: boolean) => {
    if (openProp === undefined) setInner(next);
    onOpenChange?.(next);
  };
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const noun = count === 1 ? 'edit' : 'edits';

  return (
    <div className="gp-edits" ref={wrapRef}>
      <button
        ref={btnRef}
        type="button"
        className="gp-edits-btn"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={`${count} ${noun}: open changeset`}
        onClick={() => setOpen(!open)}
      >
        {count > 0 && <span className="gp-edits-dot" aria-hidden="true" />}
        <b>{count}</b> {noun}
      </button>
      {open && (
        <TrayPanel
          id={panelId}
          title={title}
          anchor={btnRef.current}
          wrap={wrapRef.current}
          count={count}
          changes={changes}
          canUndo={canUndo}
          canRedo={canRedo}
          onUndo={onUndo}
          onRedo={onRedo}
          onSave={() => {
            onSaveAsScenario();
            setOpen(false);
          }}
          onDiscard={() => {
            onDiscard();
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

interface PanelProps {
  id: string;
  title: string;
  anchor: HTMLElement | null;
  wrap: HTMLElement | null;
  count: number;
  changes: readonly EditChange[];
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onSave: () => void;
  onDiscard: () => void;
  onClose: () => void;
}

function TrayPanel({
  id,
  title,
  anchor,
  wrap,
  count,
  changes,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onSave,
  onDiscard,
  onClose,
}: PanelProps) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useDialog(ref, { onClose, returnFocus: anchor });

  // a press outside the counter and the tray closes it
  useEffect(() => {
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (target && !wrap?.contains(target)) closeRef.current();
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [wrap]);

  const rect = anchor?.getBoundingClientRect();
  const style: CSSProperties & Record<`--${string}`, string> = {};
  if (rect) {
    style['--gp-tray-x'] = `${rect.right}px`;
    style['--gp-tray-y'] = `${rect.bottom + TRAY_GAP}px`;
  }
  const empty = changes.length === 0;
  return (
    <div ref={ref} tabIndex={-1}>
      <GlassPanel
        as="div"
        level={3}
        padding="tight"
        className="gp-tray"
        id={id}
        role="dialog"
        aria-label={title}
        style={style}
        header={{
          label: title,
          labelAs: 'h3',
        }}
      >
        {empty ? (
          <p className="gp-tray-empty">No edits yet. Change a number and it lands here.</p>
        ) : (
          <ol className="gp-tray-list" aria-label="Changes">
            {changes.map((c) => (
              <li key={c.id} className="gp-tray-item">
                <span className="gp-tray-who">{c.who}</span>
                <span className="gp-tray-what">{c.what}</span>
                <span className="gp-tray-change">
                  {c.from} <span aria-label="to">→</span> <b>{c.to}</b>
                </span>
              </li>
            ))}
          </ol>
        )}
        <div className="gp-tray-actions">
          <button type="button" className="gp-btn" disabled={!canUndo} onClick={onUndo}>
            Undo
          </button>
          <button type="button" className="gp-btn" disabled={!canRedo} onClick={onRedo}>
            Redo
          </button>
          <button
            type="button"
            className="gp-btn"
            data-variant="ghost"
            disabled={count === 0}
            onClick={onDiscard}
          >
            Discard
          </button>
          <button
            type="button"
            className="gp-btn"
            data-variant="primary"
            disabled={count === 0}
            onClick={onSave}
          >
            Save as scenario
          </button>
        </div>
      </GlassPanel>
    </div>
  );
}
