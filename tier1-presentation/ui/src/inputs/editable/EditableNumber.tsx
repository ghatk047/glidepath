import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { EditPopover, type EditVariableDef, type EditPopoverProps } from './EditPopover';
import { useEditableStyles } from './styles';
import { useRolledText } from './useRolledText';

/** Popover content and callbacks: everything EditPopover needs except what EditableNumber owns. */
export type EditableNumberPopover = EditVariableDef &
  Pick<EditPopoverProps, 'parse' | 'onChange' | 'onReset' | 'onPin' | 'pinReason'>;

interface EditableNumberBase {
  /** Value pushed by tier 2. null / undefined shows an em dash. */
  value: number | null | undefined;
  /** Display transform: `fmt.money`, `fmt.pct`, ... */
  format: (v: number) => string;
  /**
   * Solid underline: the value differs from its scenario base. When omitted, the number counts as
   * changed after the first edit made through its popover (until Reset).
   */
  changed?: boolean;
  /** Popover content (label, unit, min, max, step, source, confidence, default, warnings) + callbacks. */
  popover?: EditableNumberPopover;
  className?: string;
}

export interface EditableInputProps extends EditableNumberBase {
  mode?: 'input';
  /** Registry variable id, verbatim (e.g. `g.target_net`). */
  variableId: string;
  nodeId?: never;
  onTrace?: never;
}

export interface EditableOutputProps extends EditableNumberBase {
  mode: 'output';
  /** Formula node id, verbatim (e.g. `res.net`). */
  nodeId: string;
  variableId?: never;
  /** Click opens the trace drawer for this node. */
  onTrace: (nodeId: string) => void;
  /** Output is pinned (an Override with a reason exists): shows the pin glyph. */
  pinned?: boolean;
}

export type EditableNumberProps = EditableInputProps | EditableOutputProps;

function PinGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 17v5M8 3h8l-1 7 3 3v2H6v-2l3-3-1-7z" />
    </svg>
  );
}

/**
 * Editable number (#9, `.ed`): the number as text with a dotted underline on hover and a solid one
 * once changed. Input mode opens the Edit popover; output mode calls onTrace (the trace drawer).
 * An output with a popover also gets a pin button that opens the popover in output mode
 * ("Pin with reason"). Presentational: the value, formats and warnings arrive as props.
 */
export function EditableNumber(props: EditableNumberProps) {
  useEditableStyles();
  const { value, format, popover, className } = props;
  const output = props.mode === 'output';
  const id = output ? props.nodeId : props.variableId;
  const pinned = output && !!props.pinned;
  const btnRef = useRef<HTMLButtonElement>(null);
  const pinRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [touched, setTouched] = useState(false);
  const [openFrom, setOpenFrom] = useState<HTMLElement | null>(null);
  const { text, minWidthCh } = useRolledText(value, format);
  const changed = props.changed ?? touched;

  const openFromEl = (el: HTMLElement | null) => {
    setOpenFrom(el);
    setOpen((o) => !o);
  };
  const onActivate = () => {
    if (output) props.onTrace(props.nodeId);
    else if (popover) openFromEl(btnRef.current);
  };

  const canEdit = typeof value === 'number' && Number.isFinite(value);
  const popoverMode = output ? 'output' : 'input';

  return (
    <span className={['gp-ed-wrap', className].filter(Boolean).join(' ')}>
      <button
        ref={btnRef}
        type="button"
        className="gp-ed"
        data-mode={output ? 'output' : 'input'}
        data-id={id}
        data-changed={changed || undefined}
        data-pinned={pinned || undefined}
        aria-haspopup={!output && popover ? 'dialog' : undefined}
        aria-expanded={!output && popover ? open : undefined}
        aria-label={popover ? `${popover.label}: ${text}` : undefined}
        style={{ minWidth: `${minWidthCh}ch` }}
        onClick={onActivate}
      >
        {text}
      </button>
      {output && popover && (
        <button
          ref={pinRef}
          type="button"
          className="gp-ed-pin"
          data-pinned={pinned || undefined}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={
            pinned ? `Pinned: ${popover.label}. Edit pin` : `Pin with reason: ${popover.label}`
          }
          onClick={() => openFromEl(pinRef.current)}
        >
          <PinGlyph />
        </button>
      )}
      {open &&
        popover &&
        canEdit &&
        typeof document !== 'undefined' &&
        createPortal(
          <EditPopover
            {...popover}
            mode={popoverMode}
            value={value}
            format={format}
            anchor={openFrom}
            onChange={(v) => {
              setTouched(true);
              popover.onChange?.(v);
            }}
            onReset={() => {
              setTouched(false);
              if (popover.onReset) popover.onReset();
              else popover.onChange?.(popover.defaultValue);
            }}
            onClose={() => setOpen(false)}
          />,
          document.body,
        )}
    </span>
  );
}
