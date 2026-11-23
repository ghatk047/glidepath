import { useCallback } from 'react';
import { useRouter } from '@tanstack/react-router';
import type { SearchResult } from '@glidepath/api-contract';
import type { ViewSearch } from '../../app/search';

/** How long a jump waits for the target control to render on the new screen (lazy chunks). */
export const FOCUS_WAIT_MS = 1500;

/** Attributes the bound controls carry their spec id in (ui: `EditableNumber`, controls, rows). */
const ID_ATTRS = ['data-id', 'data-variable-id', 'data-node', 'data-lever'] as const;

/** Overlays are never the jump target. */
const OVERLAY = '.gp-pop, .gp-drawer, .gp-palette, .gp-scrim';

const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

const escapeAttr = (v: string) => v.replace(/["\\]/g, '\\$&');

/** The on-screen control bound to `id` (first one outside the overlays), or `null`. */
export function findControl(id: string, root: ParentNode = document): HTMLElement | null {
  const selector = ID_ATTRS.map((a) => `[${a}="${escapeAttr(id)}"]`).join(',');
  for (const el of root.querySelectorAll<HTMLElement>(selector)) {
    if (!el.closest(OVERLAY)) return el;
  }
  return null;
}

/** Focuses the control itself when it can take focus, else its first focusable descendant. */
export function focusControl(el: HTMLElement): HTMLElement {
  const target = el.matches(FOCUSABLE) ? el : (el.querySelector<HTMLElement>(FOCUSABLE) ?? el);
  target.focus();
  return target;
}

/** Resolves with the control once it is on screen, or `null` after `FOCUS_WAIT_MS`. */
export function waitForControl(id: string, waitMs = FOCUS_WAIT_MS): Promise<HTMLElement | null> {
  const found = findControl(id);
  if (found || typeof MutationObserver === 'undefined') return Promise.resolve(found);
  return new Promise((resolve) => {
    const done = (el: HTMLElement | null) => {
      observer.disconnect();
      clearTimeout(timer);
      resolve(el);
    };
    const observer = new MutationObserver(() => {
      const el = findControl(id);
      if (el) done(el);
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [...ID_ATTRS],
    });
    const timer = setTimeout(() => done(findControl(id)), waitMs);
  });
}

/** URL selection a result jumps with (IA §5): levers select `?lever=`, outputs `?node=`. */
const selectionOf = (r: SearchResult): ViewSearch | null =>
  r.kind === 'lever' ? { lever: r.id } : r.kind === 'node' ? { node: r.id } : null;

/**
 * Enter on a palette result: moves the URL to the result's module (same tenant and scenario;
 * the result's selection, else the module's own when staying, else none), then waits for the
 * control bound to the result's id and focuses it. Resolves with the focused element.
 */
export function useJump(
  waitMs: number = FOCUS_WAIT_MS,
): (result: SearchResult) => Promise<HTMLElement | null> {
  const router = useRouter();
  return useCallback(
    async (result) => {
      const p = (router.state.matches.at(-1)?.params ?? {}) as Record<string, string>;
      const module = result.module ?? p['module'];
      if (p['tenant'] && p['scenario'] && module) {
        const select = selectionOf(result);
        const staying = module === p['module'];
        if (!staying || select) {
          await router.navigate({
            to: '/$tenant/$scenario/$module',
            params: { tenant: p['tenant'], scenario: p['scenario'], module },
            search: select ?? (staying ? true : {}),
          } as never);
        }
      }
      if (result.kind === 'screen') return null;
      const el = await waitForControl(result.id, waitMs);
      return el ? focusControl(el) : null;
    },
    [router, waitMs],
  );
}
