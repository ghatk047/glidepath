import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import { vpColour, vpTextColour } from '../../charts/gauge';
import { fmt } from '../../format';
import { decimalsOf, latestThrottle, type LatestThrottle } from '../slider';
import {
  dividerRange,
  dividersFromShares,
  gridUnits,
  moveDivider,
  segmentUnits,
  unitsAtPointer,
  unitsToShare,
} from './partition';
import { ownershipCss } from './styles';

/** One VP's slice of a domain: `org.dom_share[domainId, vp]`, in model units (0.4 for 40%). */
export interface OwnershipShare {
  /** VP id, verbatim from the spec (`vp_commercial`). */
  vp: string;
  /** Display name for the tooltip and the spoken label. Defaults to `vp`. */
  label?: string;
  share: number;
}

/**
 * What tier 2 says about this row: the `severity` and `message` of a contract `Violation`
 * (structurally the same, so a `Violation` can be passed as is), in tier 2's words.
 */
export interface OwnershipMessage {
  severity: 'error' | 'warning';
  message: string;
}

export interface OwnershipBarProps {
  /** Domain id, verbatim from the spec (`data_analytics`). Echoed back to the callbacks. */
  domainId: string;
  /** Domain display name, the accessible name of the row. Defaults to `domainId`. */
  label?: string;
  /** Current `org.dom_share` row from tier 2, one entry per VP in slot order (colour follows slot). */
  shares: readonly OwnershipShare[];
  /** While dragging or holding an arrow: at most once per 33 ms, latest wins. */
  onPreview?: (domainId: string, shares: readonly OwnershipShare[]) => void;
  /** Once per gesture: pointer release, arrow release, or blur. This is the write. */
  onCommit?: (domainId: string, shares: readonly OwnershipShare[]) => void;
  /** Validation results for this row, shown as tier 2 worded them (VR rules). */
  violations?: readonly OwnershipMessage[];
  /** Divider step from the variable definition (`org.dom_share` step). Default: UX 5%. */
  step?: number;
  /** Segments at or above this share carry a label. Default: UX 12%. */
  labelMin?: number;
  className?: string;
}

/** UX defaults (04_component_inventory #13): 5% steps, segments labelled from 12%. */
export const OWNERSHIP_STEP = 0.05;
export const OWNERSHIP_LABEL_MIN = 0.12;

/** Tolerance when comparing a share with `labelMin` (both are decimals). */
const EPS = 1e-9;
const KEY_DELTA: Record<string, number> = {
  ArrowRight: 1,
  ArrowUp: 1,
  ArrowLeft: -1,
  ArrowDown: -1,
};
const COMMIT_KEYS = new Set(['ArrowRight', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'Home', 'End']);

interface Local {
  dividers: number[];
  /** Changed since the last commit. */
  dirty: boolean;
}

/**
 * Ownership bar (#13): one domain's row split between VPs, with a draggable divider between
 * neighbours. Dividers move in whole steps and cannot cross, so the segments always partition the
 * row. The bar and its labels move locally on every frame; tier 2 hears throttled previews and one
 * commit per gesture, and shows its own validation messages. No rules here: shares and messages
 * arrive as props.
 */
export function OwnershipBar({
  domainId,
  label,
  shares,
  onPreview,
  onCommit,
  violations = [],
  step = OWNERSHIP_STEP,
  labelMin = OWNERSHIP_LABEL_MIN,
  className,
}: OwnershipBarProps) {
  const autoId = useId();
  const msgId = `gp-own-msg-${autoId}`;
  const total = gridUnits(step);
  const digits = Math.max(0, decimalsOf(step) - 2);
  const shareKey = shares.map((s) => s.share).join(',');
  const fromProps = () =>
    dividersFromShares(
      shares.map((s) => s.share),
      total,
    );

  const [local, setLocal] = useState<Local | null>(null);
  const [prevKey, setPrevKey] = useState(shareKey);
  if (prevKey !== shareKey) {
    setPrevKey(shareKey);
    if (!local?.dirty) setLocal(null);
  }
  const dividers = local?.dividers ?? fromProps();

  // Handlers read refs so a burst of events inside one frame sees the latest positions.
  const barRef = useRef<HTMLDivElement>(null);
  const liveRef = useRef(dividers);
  const dirtyRef = useRef(false);
  const dragRef = useRef<number | null>(null);
  const [active, setActive] = useState<number | null>(null);
  const propsRef = useRef({ domainId, shares, onPreview, onCommit, total });
  useEffect(() => {
    propsRef.current = { domainId, shares, onPreview, onCommit, total };
  });
  const throttleRef = useRef<LatestThrottle<number[]> | null>(null);
  const withShares = (d: readonly number[]): OwnershipShare[] => {
    const p = propsRef.current;
    return segmentUnits(d, p.total).map((u, i) => ({
      ...p.shares[i]!,
      share: unitsToShare(u, p.total),
    }));
  };
  const throttle = () =>
    (throttleRef.current ??= latestThrottle<number[]>((d) => {
      propsRef.current.onPreview?.(propsRef.current.domainId, withShares(d));
    }));
  useEffect(() => () => throttleRef.current?.cancel(), []);

  const current = () => (dirtyRef.current ? liveRef.current : dividers);

  const move = (i: number, to: number) => {
    const base = current();
    const next = moveDivider(base, i, to, total);
    if (next[i] === base[i]) return;
    dirtyRef.current = true;
    liveRef.current = next;
    setLocal({ dividers: next, dirty: true });
    throttle().push(next);
  };

  const commit = useCallback(() => {
    dragRef.current = null;
    setActive(null);
    if (!dirtyRef.current) return;
    dirtyRef.current = false;
    throttleRef.current?.cancel();
    const d = liveRef.current;
    setLocal({ dividers: d, dirty: false });
    propsRef.current.onCommit?.(propsRef.current.domainId, withShares(d));
  }, []);

  const onPointerDown = (i: number) => (e: PointerEvent<HTMLElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    e.currentTarget.focus();
    liveRef.current = dividers;
    dragRef.current = i;
    setActive(i);
  };
  const onPointerMove = (i: number) => (e: PointerEvent<HTMLElement>) => {
    if (dragRef.current !== i) return;
    const r = barRef.current?.getBoundingClientRect();
    if (r) move(i, unitsAtPointer(e.clientX, r.left, r.width, total));
  };

  const onKeyDown = (i: number) => (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Enter') {
      commit();
      return;
    }
    if (!COMMIT_KEYS.has(e.key)) return;
    e.preventDefault();
    const [lo, hi] = dividerRange(current(), i, total);
    if (e.key === 'Home') move(i, lo);
    else if (e.key === 'End') move(i, hi);
    else move(i, current()[i]! + KEY_DELTA[e.key]!);
  };
  const onKeyUp = (e: KeyboardEvent<HTMLElement>) => {
    if (COMMIT_KEYS.has(e.key)) commit();
  };

  const units = segmentUnits(dividers, total);
  const names = shares.map((s) => s.label ?? s.vp);
  const pct = (u: number) => fmt.pct(unitsToShare(u, total), { digits });
  const hasError = violations.some((m) => m.severity === 'error');
  const cls = ['gp-own', className].filter(Boolean).join(' ');

  return (
    <div className={cls} role="group" aria-label={`${label ?? domainId} ownership`}>
      <style href="gp-ownership" precedence="gp-ui">
        {ownershipCss}
      </style>
      <div
        ref={barRef}
        className="gp-own-bar"
        data-domain={domainId}
        data-live={active !== null || undefined}
      >
        {units.map((u, i) => (
          <i
            key={shares[i]?.vp ?? i}
            className="gp-own-seg"
            data-vp={shares[i]?.vp}
            data-empty={u === 0 || undefined}
            data-tip={`${names[i]} · ${pct(u)}`}
            style={{
              width: `${(u / total) * 100}%`,
              background: vpColour(i),
              color: vpTextColour(i),
            }}
          >
            {unitsToShare(u, total) >= labelMin - EPS ? pct(u) : ''}
          </i>
        ))}
        {dividers.map((at, i) => {
          const [lo, hi] = dividerRange(dividers, i, total);
          const pctNow = (at / total) * 100;
          return (
            <span
              key={i}
              role="slider"
              tabIndex={0}
              className="gp-own-hdl"
              data-index={i}
              data-active={active === i || undefined}
              style={{ left: `${pctNow}%` }}
              aria-label={`${names[i]} and ${names[i + 1]} divider, ${label ?? domainId}`}
              aria-orientation="horizontal"
              aria-valuemin={(lo / total) * 100}
              aria-valuemax={(hi / total) * 100}
              aria-valuenow={pctNow}
              aria-valuetext={`${names[i]} ${pct(at)}, ${names[i + 1]} ${pct(segmentUnits(dividers, total)[i + 1]!)}`}
              aria-describedby={violations.length ? msgId : undefined}
              onPointerDown={onPointerDown(i)}
              onPointerMove={onPointerMove(i)}
              onPointerUp={commit}
              onPointerCancel={commit}
              onKeyDown={onKeyDown(i)}
              onKeyUp={onKeyUp}
              onBlur={commit}
            />
          );
        })}
      </div>
      {violations.length ? (
        <div id={msgId} role={hasError ? 'alert' : 'status'} aria-label="Ownership checks">
          <ul className="gp-own-msgs">
            {violations.map((m, i) => (
              <li key={i} data-severity={m.severity}>
                {m.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
