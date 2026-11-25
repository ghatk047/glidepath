import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import {
  GLASS_BLUR_BUDGET,
  createGlassBudget,
  type GlassBudget,
  type GlassLevel,
  type GlassQuality,
} from './budget';
import { sampleFrameTime, watchReducedTransparency, type FrameSamplerOptions } from './quality';
import { glassCss } from './styles';

const defaultBudget = createGlassBudget();
const GlassContext = createContext<GlassBudget>(defaultBudget);

export interface GlassProviderProps {
  children?: ReactNode;
  /** Backdrop-filter layers allowed on screen. Default 3 (07_frontend §5). */
  maxBlurLayers?: number;
  /** Sample frame time on mount and fall back to low blur when slow. Default true. */
  frameSampling?: boolean | FrameSamplerOptions;
  /** Force the low-blur fallback on (e.g. a user setting). */
  forceLow?: boolean;
}

/**
 * Mount once at the app root: injects the glass CSS, owns the blur budget and switches to the
 * low-blur fallback on prefers-reduced-transparency or slow frames.
 */
export function GlassProvider({
  children,
  maxBlurLayers = GLASS_BLUR_BUDGET,
  frameSampling = true,
  forceLow = false,
}: GlassProviderProps) {
  const [budget] = useState(() => createGlassBudget(maxBlurLayers));

  useEffect(
    () => watchReducedTransparency((on) => budget.setLow('reduced-transparency', on)),
    [budget],
  );
  useEffect(() => {
    if (frameSampling === false) return;
    const opts = frameSampling === true ? {} : frameSampling;
    return sampleFrameTime((slow) => budget.setLow('frame-time', slow), opts);
  }, [budget, frameSampling]);
  useEffect(() => budget.setLow('forced', forceLow), [budget, forceLow]);

  return (
    <GlassContext.Provider value={budget}>
      <style data-glidepath-glass="">{glassCss}</style>
      {children}
    </GlassContext.Provider>
  );
}

export const useGlassBudget = (): GlassBudget => useContext(GlassContext);

const useBudgetVersion = (budget: GlassBudget) =>
  useSyncExternalStore(budget.subscribe, budget.version, budget.version);

export function useGlassQuality(): GlassQuality {
  const budget = useGlassBudget();
  useBudgetVersion(budget);
  return budget.quality();
}

/** Registers a glass surface; true when it holds one of the backdrop-filter slots. */
export function useGlassBlur(level: GlassLevel): boolean {
  const budget = useGlassBudget();
  const [id, setId] = useState<number | null>(null);
  useEffect(() => {
    const i = budget.register(level);
    setId(i);
    return () => budget.unregister(i);
  }, [budget, level]);
  useBudgetVersion(budget);
  return id !== null && budget.blurred(id);
}
