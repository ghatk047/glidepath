import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { GlassPanel } from '../../glass';
import { useEditableStyles } from './styles';

/** What the popover shows about a variable or node. Every value comes from tier 2 / the registry. */
export interface EditVariableDef {
  /** Variable label, e.g. "Net target · CY27". */
  label: string;
  /** Unit chip, e.g. "$M", "%/yr", "×". */
  unit: string;
  min: number;
  max: number;
  step: number;
  /** Source chip text, e.g. "User", "Baseline". */
  source: string;
  /** Confidence chip text, e.g. "High". */
  confidence: string;
  /** Registry default; shown as the Default chip and used by Reset when no onReset is given. */
  defaultValue: number;
  /** Tier 2's warning texts for the current value, rendered verbatim. */
  warnings?: readonly string[];
}

export interface EditPopoverProps extends EditVariableDef {
  /** `input`: edit the value. `output`: the value is a result; offers "Pin with reason". */
  mode?: 'input' | 'output';
  /** Current value (pushed by tier 2). */
  value: number;
  /** Display transform (`fmt.*`), also used for the default chip. */
  format: (v: number) => string;
  /** Typed text to number; default strips everything but digits, ".", "-" and U+2212. */
  parse?: (text: string) => number | null;
  /** Value changed by the number field or the slider (live: tier 2 re-evaluates each time). */
  onChange?: (value: number) => void;
  /** Reset to default. When absent, Reset calls onChange(defaultValue). Closes afterwards. */
  onReset?: () => void;
  /** Output mode: write an Override with a reason. */
  onPin?: (pin: { value: number; reason: string }) => void;
  /** Reason already attached to a pinned output. */
  pinReason?: string;
  /** Escape, outside click, Done, Reset and a successful pin all call this. */
  onClose: () => void;
  /** Element the popover hangs from (positioned under it; clicks on it do not count as outside). */
  anchor?: HTMLElement | null;
}

/** Default parse: "1,007.6", "$23.7M", "−4" -> number; anything without digits -> null. */
export function parseNumber(text: string): number | null {
  const cleaned = text.replace('−', '-').replace(/[^0-9.-]/g, '');
  if (!/[0-9]/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

const POP_GAP_Y = 10;

export function EditPopover({
  mode = 'input',
  label,
  unit,
  min,
  max,
  step,
  source,
  confidence,
  defaultValue,
  warnings,
  value,
  format,
  parse = parseNumber,
  onChange,
  onReset,
  onPin,
  pinReason = '',
  onClose,
  anchor,
}: EditPopoverProps) {
  useEditableStyles();
  const numRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef(onClose);
  const anchorRef = useRef(anchor);
  const labelId = useId();
  const warnId = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const [reason, setReason] = useState(pinReason);

  useEffect(() => {
    closeRef.current = onClose;
    anchorRef.current = anchor;
  });

  // focus the number field on open; give focus back to the anchor on close
  useEffect(() => {
    const opener = anchorRef.current;
    numRef.current?.focus();
    numRef.current?.select();
    return () => {
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  // Escape closes; a pointer press outside (and not on the anchor) closes
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeRef.current();
      }
    };
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Element | null;
      if (!target) return;
      if (target.closest?.('.gp-pop') || anchorRef.current?.contains(target)) return;
      closeRef.current();
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, []);

  const commitDraft = () => {
    if (draft === null) return;
    const n = parse(draft);
    setDraft(null);
    if (n !== null && n !== value) onChange?.(n);
  };
  const onNumKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitDraft();
    }
  };

  const reset = () => {
    if (onReset) onReset();
    else onChange?.(defaultValue);
    onClose();
  };
  const pin = () => {
    const text = reason.trim();
    if (!text) return;
    onPin?.({ value, reason: text });
    onClose();
  };

  const rect = anchor?.getBoundingClientRect();
  const style: CSSProperties & Record<`--${string}`, string> = {};
  if (rect) {
    style['--gp-pop-x'] = `${rect.left}px`;
    style['--gp-pop-y'] = `${rect.bottom + POP_GAP_Y}px`;
  }
  const span = max - min;
  const pct = span > 0 ? Math.min(100, Math.max(0, ((value - min) / span) * 100)) : 0;
  const hasWarnings = !!warnings && warnings.length > 0;
  const sliderStyle: CSSProperties & Record<`--${string}`, string> = { '--gp-p': `${pct}%` };

  return (
    <GlassPanel
      as="div"
      level={3}
      padding="tight"
      className="gp-pop"
      role="dialog"
      aria-label={label}
      data-mode={mode}
      style={style}
    >
      <div className="gp-pop-h">
        <span className="gp-pop-label" id={labelId}>
          {label}
        </span>
        <span className="gp-chip">{unit}</span>
      </div>
      <input
        ref={numRef}
        className="gp-numin"
        inputMode="decimal"
        aria-label={label}
        aria-describedby={hasWarnings ? warnId : undefined}
        value={draft ?? format(value)}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => e.target.select()}
        onBlur={commitDraft}
        onKeyDown={onNumKey}
      />
      <div className="gp-range" style={sliderStyle}>
        <input
          type="range"
          aria-label={`${label}: drag or type`}
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange?.(Number(e.target.value))}
        />
      </div>
      <div className="gp-pop-meta">
        <span className="gp-chip">Source · {source}</span>
        <span className="gp-chip">Confidence · {confidence}</span>
        <span className="gp-chip">Default {format(defaultValue)}</span>
      </div>
      {hasWarnings && (
        <div id={warnId} role="status">
          <ul className="gp-pop-warn">
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}
      {mode === 'output' && (
        <textarea
          className="gp-reason"
          rows={2}
          aria-label="Reason for pinning"
          placeholder="Reason for pinning this number"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      )}
      <div className="gp-pop-actions">
        <button type="button" className="gp-btn" data-variant="ghost" onClick={reset}>
          Reset
        </button>
        {mode === 'output' && (
          <button type="button" className="gp-btn" disabled={!reason.trim()} onClick={pin}>
            Pin with reason
          </button>
        )}
        <button type="button" className="gp-btn" data-variant="primary" onClick={onClose}>
          Done
        </button>
      </div>
    </GlassPanel>
  );
}
