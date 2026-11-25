/**
 * Glass budget: at most three `backdrop-filter` layers on screen (07_frontend §5).
 *
 * Every mounted glass surface registers its level. Slots go to the highest level first
 * (overlays, then raised surfaces, then panels). A level gets real backdrop blur only when
 * all of its surfaces fit in the slots left, so surfaces of one level always look the same;
 * the rest render tint-only over the pre-blurred aurora, which is what the blur would show.
 */
export type GlassLevel = 1 | 2 | 3;
export const GLASS_LEVELS: readonly GlassLevel[] = [1, 2, 3];

/** The blur budget from 07_frontend §5. */
export const GLASS_BLUR_BUDGET = 3;

export type GlassQuality = 'full' | 'low';
/** Why the low-blur fallback is on. */
export type LowBlurReason = 'reduced-transparency' | 'frame-time' | 'forced';

export interface GlassBudget {
  readonly max: number;
  register(level: GlassLevel): number;
  unregister(id: number): void;
  /** True when this surface holds a backdrop-filter slot. */
  blurred(id: number): boolean;
  /** Number of surfaces holding a slot (never more than `max`). */
  blurCount(): number;
  quality(): GlassQuality;
  lowReasons(): readonly LowBlurReason[];
  setLow(reason: LowBlurReason, on: boolean): void;
  subscribe(listener: () => void): () => void;
  /** Changes whenever allocation or quality changes (for useSyncExternalStore). */
  version(): number;
}

export function createGlassBudget(max: number = GLASS_BLUR_BUDGET): GlassBudget {
  const entries = new Map<number, GlassLevel>();
  const listeners = new Set<() => void>();
  const reasons = new Set<LowBlurReason>();
  let granted = new Set<number>();
  let nextId = 1;
  let ver = 0;

  const allocate = () => {
    const next = new Set<number>();
    let left = max;
    for (const level of [...GLASS_LEVELS].reverse()) {
      const ids = [...entries].filter(([, l]) => l === level).map(([id]) => id);
      if (ids.length > 0 && ids.length <= left) {
        ids.forEach((id) => next.add(id));
        left -= ids.length;
      }
    }
    granted = next;
  };
  const emit = () => {
    ver += 1;
    listeners.forEach((l) => l());
  };

  return {
    max,
    register(level) {
      const id = nextId++;
      entries.set(id, level);
      allocate();
      emit();
      return id;
    },
    unregister(id) {
      if (!entries.delete(id)) return;
      allocate();
      emit();
    },
    blurred: (id) => granted.has(id),
    blurCount: () => granted.size,
    quality: () => (reasons.size > 0 ? 'low' : 'full'),
    lowReasons: () => [...reasons],
    setLow(reason, on) {
      if (on === reasons.has(reason)) return;
      if (on) reasons.add(reason);
      else reasons.delete(reason);
      emit();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    version: () => ver,
  };
}
