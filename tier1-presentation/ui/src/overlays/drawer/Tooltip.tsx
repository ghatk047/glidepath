import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FocusEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { GlassPanel } from '../../glass';
import { OverlayStyles } from './OverlayStyles';
import { TIP_POINTER_OFFSET, TIP_VIEWPORT_MARGIN } from './styles';
import { tipOwner, tipStore } from './tooltip-store';

/** Attribute for plain-text tips on any element: `<rect data-tip="Savings" />`. */
export const TIP_ATTRIBUTE = 'data-tip';

/**
 * The shared tooltip (`initTips` in the prototype): glass level 3, 12 px, follows the pointer.
 * Mount it once at the app root. Charts do not render their own: they call `showTip` / `hideTip`
 * or spread `tipProps(content)` on a mark, and every one of them drives this single instance. A
 * second `<Tooltip />` renders nothing, so there is never more than one `role="tooltip"`.
 * Elements with a `data-tip` attribute get a plain-text tip with no extra code.
 */
export function Tooltip() {
  const [id] = useState(() => Symbol('gp-tooltip'));
  useEffect(() => tipOwner.claim(id), [id]);
  const owner = useSyncExternalStore(tipOwner.subscribe, tipOwner.get, tipOwner.get);
  const { content, x, y } = useSyncExternalStore(tipStore.subscribe, tipStore.get, tipStore.get);
  const isOwner = owner === id;
  const ref = useRef<HTMLDivElement>(null);

  // `data-tip` delegation: the pointer over a [data-tip] element shows its text.
  useEffect(() => {
    if (!isOwner) return;
    const tipOf = (e: Event) => (e.target as Element | null)?.closest?.(`[${TIP_ATTRIBUTE}]`);
    const move = (e: globalThis.PointerEvent) => {
      const el = tipOf(e);
      if (el) tipStore.show(el.getAttribute(TIP_ATTRIBUTE), e.clientX, e.clientY);
    };
    const out = (e: globalThis.PointerEvent) => {
      if (tipOf(e)) tipStore.hide();
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerout', out);
    return () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerout', out);
    };
  }, [isOwner]);

  // Follow the pointer, kept inside the viewport (needs the measured size).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || content === null) return;
    const left = Math.min(
      x + TIP_POINTER_OFFSET,
      window.innerWidth - el.offsetWidth - TIP_VIEWPORT_MARGIN,
    );
    const top = Math.min(
      y + TIP_POINTER_OFFSET,
      window.innerHeight - el.offsetHeight - TIP_VIEWPORT_MARGIN,
    );
    el.style.left = `${Math.max(0, left)}px`;
    el.style.top = `${Math.max(0, top)}px`;
  }, [content, x, y, isOwner]);

  if (!isOwner) return null;
  return (
    <>
      <OverlayStyles />
      <div
        ref={ref}
        className="gp-tip"
        role="tooltip"
        // idle, the tooltip is empty and a role=tooltip needs a name (axe: aria-tooltip-name);
        // showing, its content names it
        aria-label={content === null ? 'Tooltip' : undefined}
        data-on={content !== null || undefined}
      >
        {content !== null && (
          <GlassPanel as="div" level={3} padding="none" className="gp-tip-body">
            {content}
          </GlassPanel>
        )}
      </div>
    </>
  );
}

/** Show the shared tooltip at a viewport position. */
export const showTip = (content: ReactNode, x: number, y: number): void =>
  tipStore.show(content, x, y);
/** Hide the shared tooltip. */
export const hideTip = (): void => tipStore.hide();

/**
 * Handlers that make an element (a chart mark) show `content` in the shared tooltip: the pointer
 * moves it, leaving hides it, and keyboard focus shows it beside the element.
 */
export function tipProps<E extends Element = Element>(content: ReactNode) {
  return {
    onPointerEnter: (e: PointerEvent<E>) => tipStore.show(content, e.clientX, e.clientY),
    onPointerMove: (e: PointerEvent<E>) => tipStore.show(content, e.clientX, e.clientY),
    onPointerLeave: () => tipStore.hide(),
    onFocus: (e: FocusEvent<E>) => {
      const r = e.currentTarget.getBoundingClientRect();
      tipStore.show(content, r.right, r.bottom);
    },
    onBlur: () => tipStore.hide(),
  };
}
