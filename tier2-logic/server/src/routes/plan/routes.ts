import { planRoutes } from '@glidepath/api-contract';
import type { Hono } from 'hono';
import { ApiError } from '../../app/problem';
import type { AppEnv } from '../../app/tenant';
import type { SpecBundleSource } from '../read/spec-source';

/**
 * What the routes get from `createApp` (the same as the explain and market routes). The tenant transaction comes
 * from `c.get('tenant').tx`. SRC-17 may add optional fields here; app.ts already passes `specBundle`.
 */
export interface PlanRoutesDeps {
  /** The spec bundle of the pinned model version (registry, formulas) for evaluating a scenario. */
  specBundle: SpecBundleSource;
}

const notYet = (): never => {
  throw new ApiError({
    status: 501,
    title: 'Not implemented',
    detail: 'The business case lands with SRC-17.',
  });
};

/**
 * `/api/t/:tenant/plan/*` (SRC-05 stubs, contract `planRoutes`): mounted behind the auth and tenant middleware
 * like every tenant route; answers 501 problem JSON until SRC-17 implements it in this folder.
 */
export function registerPlanRoutes(app: Hono<AppEnv>, deps: PlanRoutesDeps): void {
  void deps; // SRC-17 reads deps.specBundle
  app.get(planRoutes.planBusinessCase.path, notYet);
}
