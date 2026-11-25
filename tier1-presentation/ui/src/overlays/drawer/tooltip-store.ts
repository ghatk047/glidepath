import type { ReactNode } from 'react';

/** State of the one shared tooltip. */
export interface TipState {
  content: ReactNode | null;
  /** Pointer position in viewport pixels. */
  x: number;
  y: number;
}

let state: TipState = { content: null, x: 0, y: 0 };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Module-level store: every chart talks to the same tooltip, whatever tree it is in. */
export const tipStore = {
  get: (): TipState => state,
  subscribe(l: () => void): () => void {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
  show(content: ReactNode, x: number, y: number): void {
    state = { content, x, y };
    emit();
  },
  hide(): void {
    if (state.content === null) return;
    state = { ...state, content: null };
    emit();
  },
};

/** Mounted `<Tooltip />` instances in mount order; only the first one renders (shared instance). */
const instances: symbol[] = [];
const instanceListeners = new Set<() => void>();
let ownerSnapshot: symbol | null = null;
const emitInstances = () => {
  ownerSnapshot = instances[0] ?? null;
  instanceListeners.forEach((l) => l());
};

export const tipOwner = {
  get: (): symbol | null => ownerSnapshot,
  subscribe(l: () => void): () => void {
    instanceListeners.add(l);
    return () => {
      instanceListeners.delete(l);
    };
  },
  claim(id: symbol): () => void {
    instances.push(id);
    emitInstances();
    return () => {
      const i = instances.indexOf(id);
      if (i >= 0) instances.splice(i, 1);
      emitInstances();
    };
  },
};
