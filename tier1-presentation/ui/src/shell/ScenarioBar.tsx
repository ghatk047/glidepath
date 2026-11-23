import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { GlassPanel } from '../glass';
import { ShellStyles } from './ShellStyles';

export interface ScenarioOption {
  id: string;
  /** Short letter shown on its own on a phone (R, A, B, C, D). */
  letter: string;
  name: string;
}
/** A Custom or Path scenario, listed in the overflow menu. */
export interface ScenarioMenuItem {
  id: string;
  name: string;
}

export interface ScenarioBarProps {
  scenarios: readonly ScenarioOption[];
  /** id of the current scenario: a preset, a custom or a path. */
  current: string;
  customs?: readonly ScenarioMenuItem[];
  paths?: readonly ScenarioMenuItem[];
  onSelect: (id: string) => void;
  /** Accessible name of the group. */
  label?: string;
}

const MENU_ITEMS = '[role="menuitemradio"]';

/**
 * Scenario bar (#2): segmented letters + names (letters only on a phone), pressed = glass-3.
 * Custom and Path scenarios live in an overflow menu. Presentational: no scenario logic.
 */
export function ScenarioBar({
  scenarios,
  current,
  customs = [],
  paths = [],
  onSelect,
  label = 'Scenario',
}: ScenarioBarProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const hasMore = customs.length + paths.length > 0;
  const more = [...customs, ...paths].find((s) => s.id === current);

  const items = () =>
    Array.from(wrapRef.current?.querySelectorAll<HTMLButtonElement>(MENU_ITEMS) ?? []);

  // focus the checked (else first) item on open; close on an outside press
  useEffect(() => {
    if (!open) return;
    const list = items();
    (list.find((b) => b.getAttribute('aria-checked') === 'true') ?? list[0])?.focus();
    const outside = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  };
  const choose = (id: string) => {
    onSelect(id);
    close(true);
  };

  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const list = items();
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    const go = (n: number) => {
      e.preventDefault();
      list[(n + list.length) % list.length]?.focus();
    };
    if (e.key === 'ArrowDown') go(i + 1);
    else if (e.key === 'ArrowUp') go(i - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(list.length - 1);
    else if (e.key === 'Escape') {
      e.preventDefault();
      close(true);
    } else if (e.key === 'Tab') setOpen(false);
  };

  const onTriggerKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowDown' && !open) {
      e.preventDefault();
      setOpen(true);
    }
  };

  const group = (key: string, heading: string, list: readonly ScenarioMenuItem[]) =>
    list.length > 0 && (
      <div className="gp-menu-group" role="group" aria-label={heading} key={key}>
        <span className="gp-menu-label" aria-hidden="true">
          {heading}
        </span>
        {list.map((s) => (
          <button
            key={s.id}
            type="button"
            role="menuitemradio"
            aria-checked={s.id === current}
            tabIndex={-1}
            data-scenario={s.id}
            onClick={() => choose(s.id)}
          >
            {s.name}
          </button>
        ))}
      </div>
    );

  return (
    <ShellStyles>
      <div className="gp-seg-wrap" ref={wrapRef}>
        <div className="gp-seg" role="group" aria-label={label}>
          {scenarios.map((s) => (
            <button
              key={s.id}
              type="button"
              aria-pressed={s.id === current}
              data-scenario={s.id}
              onClick={() => onSelect(s.id)}
            >
              <span className="gp-seg-k">{s.letter}</span>
              <span className="gp-seg-t">{s.name}</span>
            </button>
          ))}
          {hasMore && (
            <button
              ref={triggerRef}
              type="button"
              aria-haspopup="menu"
              aria-expanded={open}
              aria-controls={open ? menuId : undefined}
              aria-label={more ? `More scenarios, ${more.name} selected` : 'More scenarios'}
              data-active={more ? 'true' : undefined}
              onClick={() => setOpen((o) => !o)}
              onKeyDown={onTriggerKey}
            >
              <span aria-hidden="true">…</span>
              {more && (
                <span className="gp-seg-more-name" aria-hidden="true">
                  {more.name}
                </span>
              )}
            </button>
          )}
        </div>
        {open && (
          <div className="gp-menu-pop" onKeyDown={onMenuKey}>
            <GlassPanel level={3} as="div" padding="tight">
              <div id={menuId} className="gp-menu" role="menu" aria-label="More scenarios">
                {group('customs', 'Custom', customs)}
                {group('paths', 'Paths', paths)}
              </div>
            </GlassPanel>
          </div>
        )}
      </div>
    </ShellStyles>
  );
}
