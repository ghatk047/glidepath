import type { ComponentType } from 'react';
import { AppModule } from '@glidepath/api-contract';

/** The eight modules, in site-map order (IA §1). The list itself is owned by the contract. */
export const MODULE_IDS = AppModule.options;
export type ModuleId = AppModule;

export const isModuleId = (v: unknown): v is ModuleId => AppModule.safeParse(v).success;

type ModuleLoader = () => Promise<{ default: ComponentType }>;

/**
 * One dynamic import per module, so the bundler emits one chunk per module (07 §5).
 * Each module lives in `src/modules/<id>/index.tsx` and default-exports its screen.
 */
export const moduleLoaders: Record<ModuleId, ModuleLoader> = {
  cockpit: () => import('../modules/cockpit'),
  baseline: () => import('../modules/baseline'),
  levers: () => import('../modules/levers'),
  vps: () => import('../modules/vps'),
  path: () => import('../modules/path'),
  market: () => import('../modules/market'),
  excel: () => import('../modules/excel'),
  airlines: () => import('../modules/airlines'),
};

/** Modules whose chunks are fetched right after first paint (07 §5: Cockpit, Levers, Path). */
export const PRELOADED_MODULES = [
  'cockpit',
  'levers',
  'path',
] as const satisfies readonly ModuleId[];

const cache = new Map<ModuleId, ReturnType<ModuleLoader>>();

/** Loads a module chunk once; later calls reuse the same promise. */
export function loadModule(id: ModuleId): ReturnType<ModuleLoader> {
  let p = cache.get(id);
  if (!p) {
    p = moduleLoaders[id]();
    cache.set(id, p);
  }
  return p;
}

type Scheduler = (cb: () => void) => unknown;

/** Fetches the preloaded modules once the browser is idle (after first paint). */
export function schedulePreload(
  schedule: Scheduler = typeof requestIdleCallback === 'function'
    ? requestIdleCallback
    : (cb) => setTimeout(cb, 0),
): void {
  schedule(() => void preloadModules());
}

export function preloadModules(ids: readonly ModuleId[] = PRELOADED_MODULES): Promise<unknown[]> {
  return Promise.all(ids.map((id) => loadModule(id).catch(() => undefined)));
}
