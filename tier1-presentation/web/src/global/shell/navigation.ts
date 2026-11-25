import { useCallback, useMemo } from 'react';
import { useRouter } from '@tanstack/react-router';
import type { ModuleId } from '../../app/modules';

/**
 * URL moves of the global layer (IA §1, §5): tenant, scenario and module live only in the URL.
 * - `toModule(id)`: rail; same tenant and scenario, the module's selection is dropped.
 * - `toScenario(id)`: scenario bar; same module and selection, a new history entry.
 */
export interface ShellNavigation {
  toModule(module: ModuleId): void;
  toScenario(scenarioId: string, options?: { replace?: boolean }): void;
}

export function useShellNavigation(): ShellNavigation {
  const router = useRouter();
  const params = useCallback(
    () => (router.state.matches.at(-1)?.params ?? {}) as Record<string, string>,
    [router],
  );

  const toModule = useCallback(
    (module: ModuleId) => {
      const p = params();
      if (!p['tenant'] || !p['scenario']) return;
      void router.navigate({
        to: '/$tenant/$scenario/$module',
        params: { tenant: p['tenant'], scenario: p['scenario'], module },
      } as never);
    },
    [router, params],
  );

  const toScenario = useCallback(
    (scenarioId: string, options: { replace?: boolean } = {}) => {
      const p = params();
      if (!p['tenant'] || p['scenario'] === scenarioId) return;
      void router.navigate({
        to: p['module'] ? '/$tenant/$scenario/$module' : '/$tenant/$scenario',
        params: { ...p, scenario: scenarioId },
        search: true,
        replace: options.replace ?? false,
      } as never);
    },
    [router, params],
  );

  return useMemo(() => ({ toModule, toScenario }), [toModule, toScenario]);
}
