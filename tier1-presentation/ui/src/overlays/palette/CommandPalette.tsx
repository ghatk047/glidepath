import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { GlassPanel } from '../../glass';
import { useDialog } from './dialog';
import { DEFAULT_SUGGESTIONS, MAX_RESULTS, searchItems, type PaletteItem } from './search';
import { usePaletteStyles } from './styles';

export interface CommandPaletteProps {
  /** Whether the palette is showing. Controlled: the owner flips it through `onOpenChange`. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The index: inputs, levers, nodes, lines and screens, built by tier 2 / web. */
  items: readonly PaletteItem[];
  /** Enter or a click on a result. The palette closes itself afterwards. */
  onSelect: (item: PaletteItem) => void;
  /** Words offered when nothing matches. Default "COLA", "cloud", "headcount". */
  suggestions?: readonly string[];
  /** Listen for ⌘K / Ctrl+K on the document and call `onOpenChange(true)`. Default true. */
  shortcut?: boolean;
  /** Input placeholder. */
  placeholder?: string;
  /** Every change of the typed query (the owner can ask tier 2's search with it). */
  onQueryChange?: (query: string) => void;
  /**
   * Filter `items` by the typed text (`searchItems`). Default true. `false`: `items` already
   * answer the query (e.g. tier 2's `/search`) and are shown as given, up to `MAX_RESULTS`.
   */
  filter?: boolean;
}

const LABEL = 'Find any number';

/**
 * Command palette (#4): "find any number". ⌘K / Ctrl+K opens, up to 9 results with kind and unit on
 * the right, arrows + Enter select, Escape closes, focus is trapped. Presentational: it filters the
 * index it is given by text and calls `onSelect`; it computes nothing.
 */
export function CommandPalette({
  open,
  onOpenChange,
  items,
  onSelect,
  suggestions = DEFAULT_SUGGESTIONS,
  shortcut = true,
  placeholder = 'Find any input, lever, line or output…',
  onQueryChange,
  filter = true,
}: CommandPaletteProps) {
  usePaletteStyles();
  const openRef = useRef(onOpenChange);
  useEffect(() => {
    openRef.current = onOpenChange;
  });

  useEffect(() => {
    if (!shortcut) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        openRef.current(true);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [shortcut]);

  if (!open || typeof document === 'undefined') return null;
  return createPortal(
    <PaletteDialog
      items={items}
      suggestions={suggestions}
      placeholder={placeholder}
      onSelect={onSelect}
      onQueryChange={onQueryChange}
      filter={filter}
      onClose={() => onOpenChange(false)}
    />,
    document.body,
  );
}

interface DialogProps {
  items: readonly PaletteItem[];
  suggestions: readonly string[];
  placeholder: string;
  onSelect: (item: PaletteItem) => void;
  onQueryChange: ((query: string) => void) | undefined;
  filter: boolean;
  onClose: () => void;
}

function PaletteDialog({
  items,
  suggestions,
  placeholder,
  onSelect,
  onQueryChange,
  filter,
  onClose,
}: DialogProps) {
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const hits = useMemo(
    () => (filter ? searchItems(items, query) : items.slice(0, MAX_RESULTS)),
    [items, query, filter],
  );
  const queryRef = useRef(onQueryChange);
  useEffect(() => {
    queryRef.current = onQueryChange;
  });
  const changeQuery = (q: string) => {
    setQuery(q);
    setActive(0);
    queryRef.current?.(q);
  };
  const current = Math.min(active, Math.max(hits.length - 1, 0));
  // a pick lets focus go where onSelect sent it: the trap is off from then on
  const picked = useRef(false);
  useDialog(ref, { onClose, modal: () => !picked.current });

  useEffect(() => {
    listRef.current?.children[current]?.scrollIntoView?.({ block: 'nearest' });
  }, [current]);

  const pick = (item: PaletteItem | undefined) => {
    if (!item) return;
    picked.current = true;
    onSelect(item);
    onClose();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const last = hits.length - 1;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive(current >= last ? 0 : current + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(current <= 0 ? Math.max(last, 0) : current - 1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      setActive(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setActive(Math.max(last, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pick(hits[current]);
    }
  };

  const optionId = (i: number) => `${listId}-${i}`;
  return (
    <div
      ref={ref}
      className="gp-scrim"
      data-testid="palette-scrim"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <GlassPanel
        as="div"
        level={3}
        padding="none"
        className="gp-palette"
        role="dialog"
        aria-modal="true"
        aria-label={LABEL}
      >
        <input
          data-autofocus
          className="gp-pal-q"
          role="combobox"
          aria-expanded={hits.length > 0}
          aria-controls={listId}
          aria-activedescendant={hits.length > 0 ? optionId(current) : undefined}
          aria-autocomplete="list"
          aria-label="Search inputs, levers, lines and outputs"
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(e) => changeQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />
        {hits.length > 0 ? (
          <ul id={listId} ref={listRef} className="gp-pal-res" role="listbox" aria-label="Results">
            {hits.map((h, i) => (
              <li
                key={h.id}
                id={optionId(i)}
                role="option"
                aria-selected={i === current}
                className="gp-pal-opt"
                data-id={h.id}
                onMouseMove={() => i !== current && setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(h)}
              >
                <span className="gp-pal-name">{h.label}</span>
                <span className="gp-pal-kind">
                  {h.kind}
                  {h.unit ? ` · ${h.unit}` : ''}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="gp-pal-empty">
            No match.
            {suggestions.length > 0 && ' Try '}
            {suggestions.map((s, i) => (
              <span key={s}>
                {i > 0 && (i === suggestions.length - 1 ? ' or ' : ', ')}
                <button
                  type="button"
                  className="gp-pal-sug"
                  onClick={() => {
                    changeQuery(s);
                    (ref.current?.querySelector('[data-autofocus]') as HTMLElement | null)?.focus();
                  }}
                >
                  {s}
                </button>
              </span>
            ))}
            {suggestions.length > 0 && '.'}
          </p>
        )}
        <div className="gp-sr" role="status">
          {hits.length === 1 ? '1 result' : `${hits.length} results`}
        </div>
      </GlassPanel>
    </div>
  );
}
