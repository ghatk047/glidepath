import type { ApiClient, JobKind } from '@glidepath/api-contract';
import type { CancelJob } from './context';

/** Kinds the contract has a cancel route for: only solver runs (`DELETE /solver-runs/:id`). */
export const cancellableKinds: readonly JobKind[] = ['solver'];

/**
 * `DELETE /api/t/:tenant/solver-runs/:id` (`solverRunCancel`): tier 2 sets `cancelRequested`
 * and the run stops at its next batch. The contract has no cancel route for imports or AI
 * reconfiguration, so for those kinds the promise rejects (and `useJob` never offers cancel).
 */
export function solverRunCanceller(
  api: Pick<ApiClient, 'solverRunCancel'>,
  tenant: string,
): CancelJob {
  return (id, kind) => {
    if (!cancellableKinds.includes(kind)) {
      return Promise.reject(new Error(`No cancel route for ${kind} jobs`));
    }
    return api.solverRunCancel({ params: { tenant, id } });
  };
}
