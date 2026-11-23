import { useCallback } from 'react';
import { useRouter } from '@tanstack/react-router';
import type { ScenarioId } from '@glidepath/api-contract';

/**
 * `onFork` for `CommitProvider`: swaps the URL's `:scenario` for the fork tier 2 created, keeping
 * tenant, module and selection (`/:tenant/:scenario/:module?lever…`). It replaces the history
 * entry: the preset's URL would no longer show the edit just made.
 */
export function useForkNavigation(): (scenarioId: ScenarioId) => void {
  const router = useRouter();
  return useCallback(
    (scenarioId: ScenarioId) => {
      const leaf = router.state.matches.at(-1);
      const params = leaf?.params as Record<string, string> | undefined;
      if (!params?.['scenario'] || params['scenario'] === scenarioId) return;
      void router.navigate({
        to: params['module'] ? '/$tenant/$scenario/$module' : '/$tenant/$scenario',
        params: { ...params, scenario: scenarioId },
        search: true,
        replace: true,
      } as never);
    },
    [router],
  );
}
