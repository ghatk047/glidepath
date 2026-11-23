import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const focusables = (root: HTMLElement): HTMLElement[] =>
  [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.hasAttribute('hidden'));

export interface DialogOptions {
  /** Escape closes. */
  onClose: () => void;
  /** Modal: focus that lands outside the dialog is pulled back in. Default false (Tab is still trapped). */
  modal?: boolean | (() => boolean);
  /** Where focus goes on close. Default: the element that had focus when the dialog opened. */
  returnFocus?: HTMLElement | null;
}

/**
 * Focus trap and Escape for an overlay (palette, tray). Focus moves in on open (to
 * `[data-autofocus]`, else the first focusable); Tab and Shift+Tab cycle inside; Escape calls
 * `onClose`; on close focus returns to the opener, unless something else took it meanwhile
 * (a jump that focused its target keeps that focus).
 */
export function useDialog(ref: RefObject<HTMLElement | null>, options: DialogOptions): void {
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const opener = optionsRef.current.returnFocus ?? (document.activeElement as HTMLElement | null);
    const first =
      root.querySelector<HTMLElement>('[data-autofocus]') ?? focusables(root)[0] ?? root;
    first.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        e.preventDefault();
        optionsRef.current.onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = focusables(root);
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const head = items[0]!;
      const tail = items[items.length - 1]!;
      const active = document.activeElement as HTMLElement | null;
      if (!active || !root.contains(active)) {
        e.preventDefault();
        (e.shiftKey ? tail : head).focus();
      } else if (e.shiftKey && active === head) {
        e.preventDefault();
        tail.focus();
      } else if (!e.shiftKey && active === tail) {
        e.preventDefault();
        head.focus();
      }
    };
    const onFocusIn = (e: FocusEvent) => {
      const modal = optionsRef.current.modal;
      if (typeof modal === 'function' ? !modal() : !modal) return;
      const target = e.target as Node | null;
      if (target && !root.contains(target)) (focusables(root)[0] ?? root).focus();
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('focusin', onFocusIn);
      const active = document.activeElement;
      const stillHere = !active || active === document.body || root.contains(active);
      if (stillHere && opener?.isConnected) opener.focus();
    };
  }, [ref]);
}
