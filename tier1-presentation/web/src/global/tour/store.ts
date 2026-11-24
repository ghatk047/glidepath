import { createStore, useStore } from 'zustand';
import { readSeen, writeSeen } from './seen';
import { TOUR_CHAPTERS, TOUR_STEPS, stepIndex, type TourChapter } from './steps';

export type TourCloseReason = 'done' | 'skip';

export interface TourState {
  open: boolean;
  index: number;
  /** Mirrors `readSeen()`; drives the Tour button's dot. */
  seen: boolean;
  /** Always step 1. The tour never auto-starts: only a click (or a presenter call) opens it. */
  start(): void;
  /** Opens at a step id or a chapter name (`wizard`). Unknown ids are ignored. */
  startAt(target: string): void;
  /** Moves an open tour to a step id or chapter name. No-op when closed or unknown. */
  jumpTo(target: string): void;
  next(): void;
  back(): void;
  close(reason: TourCloseReason): void;
}

const LAST = TOUR_STEPS.length - 1;

/** A step id, or a chapter name resolved to its step id; -1 when unknown. */
export const resolveStep = (target: string): number =>
  stepIndex(target) >= 0
    ? stepIndex(target)
    : stepIndex(TOUR_CHAPTERS[target as TourChapter] ?? '');

export const tourStore = createStore<TourState>()((set, get) => ({
  open: false,
  index: 0,
  seen: readSeen(),
  start: () => set({ open: true, index: 0 }),
  startAt: (target) => {
    const i = resolveStep(target);
    if (i >= 0) set({ open: true, index: i });
  },
  jumpTo: (target) => {
    const i = resolveStep(target);
    if (i >= 0 && get().open) set({ index: i });
  },
  next: () => {
    const { open, index } = get();
    if (!open) return;
    if (index >= LAST) get().close('done');
    else set({ index: index + 1 });
  },
  back: () => {
    const { open, index } = get();
    if (open && index > 0) set({ index: index - 1 });
  },
  close: () => {
    // done and skip both count as seen; the page is left exactly as the presenter had it
    writeSeen();
    set({ open: false, index: 0, seen: true });
  },
}));

export const useTour = <T,>(select: (s: TourState) => T): T => useStore(tourStore, select);
