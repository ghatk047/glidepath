import { sourcingRoutes } from '@glidepath/api-contract';
import type { Hono } from 'hono';
import { ApiError } from '../../app/problem';
import type { AppEnv } from '../../app/tenant';
import type { SpecBundleSource } from '../read/spec-source';

/**
 * What the routes get from `createApp` (the same as the explain and market routes). The tenant transaction comes
 * from `c.get('tenant').tx`. SRC-07 may add optional fields here; app.ts already passes `specBundle`.
 */
export interface SourcingRoutesDeps {
  /** The spec bundle of the pinned model version (registry, formulas) for evaluating a scenario. */
  specBundle: SpecBundleSource;
}

const notYet = (): never => {
  throw new ApiError({
    status: 501,
    title: 'Not implemented',
    detail: 'Sourcing lands with SRC-07.',
  });
};

/**
 * `/api/t/:tenant/sourcing/*` (SRC-05 stubs, contract `sourcingRoutes`): mounted behind the auth and tenant
 * middleware like every tenant route; each answers 501 problem JSON until SRC-07 implements it in this folder.
 */
export function registerSourcingRoutes(app: Hono<AppEnv>, deps: SourcingRoutesDeps): void {
  void deps; // SRC-07 reads deps.specBundle
  const r = sourcingRoutes;
  app.get(r.sourcingVendors.path, notYet);
  app.get(r.sourcingRenewals.path, notYet);
  app.get(r.sourcingBenchmarks.path, notYet);
  app.get(r.sourcingParams.path, notYet);
  app.post(r.sourcingConsolidation.path, notYet);
}
