import { BusinessCase, PlanQuery, TenantParams, planRoutes } from '@glidepath/api-contract';
import { loadMembers, loadModelDefs, loadResolvedInputs, loadSourcingMembers } from '@glidepath/data-access';
import { SourcingDataError, businessCase, businessCaseParams, readSourcingParams } from '@glidepath/domain';
import type { SourcingParamsLookup } from '@glidepath/domain';
import type { Hono } from 'hono';
import { ApiError } from '../../app/problem';
import type { AppEnv } from '../../app/tenant';
import { engineInputs } from '../explain/explain';
import { ModelCache } from '../explain/model-cache';
import { BundleError } from '../read/bundle';
import type { SpecBundleSource } from '../read/spec-source';

/**
 * What the routes get from `createApp` (the same as the explain and sourcing routes). The tenant transaction
 * comes from `c.get('tenant').tx`.
 */
export interface PlanRoutesDeps {
  /** The spec bundle of the pinned model version (registry, formulas) for evaluating a scenario. */
  specBundle: SpecBundleSource;
}

const NO_SCENARIO = 'No such scenario in this tenant. Check the scenario id.';

/** A business-case parameter the tenant does not hold, or cannot be used, is a 422 that names it. */
function guarded<T>(fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    if (err instanceof SourcingDataError) {
      throw new ApiError({ status: 422, title: 'Business case parameters not usable', detail: `${err.message}.` });
    }
    throw err;
  }
}

/**
 * `/api/t/:tenant/plan/*` (SRC-17, contract `planRoutes`): the lever business case of a scenario (SRC-16,
 * @glidepath/domain `businessCase`) over its evaluation (compiled once per members set, like the explain and
 * sourcing routes) at the tenant's `business_case` sourcing parameters. Behind the auth and tenant middleware.
 * An unknown scenario, or another tenant's, is a 404 checked before anything else is read; a parameter the
 * tenant does not hold, or cannot be used, is a 422 that names it. The body is validated against `BusinessCase`.
 */
export function registerPlanRoutes(app: Hono<AppEnv>, deps: PlanRoutesDeps): void {
  const models = new ModelCache();

  app.get(planRoutes.planBusinessCase.path, async (c) => {
    TenantParams.parse(c.req.param());
    const { scenario } = PlanQuery.parse(c.req.query());
    const { tx } = c.get('tenant');
    const resolved = await loadResolvedInputs(tx, scenario);
    if (!resolved) throw ApiError.notFound(NO_SCENARIO);
    // The parameters are checked before the scenario is evaluated: a tenant without them gets the 422.
    const sourcing = await loadSourcingMembers(tx);
    const params: SourcingParamsLookup = guarded(() => {
      const lookup = readSourcingParams(sourcing.members['sourcing_param'] ?? []);
      businessCaseParams(lookup);
      return lookup;
    });
    const defs = await loadModelDefs(tx);
    if (!defs) throw new Error('the tenant pins no readable model version');
    const spec = await deps.specBundle(defs.modelVersion.semver);
    if (!spec) throw new BundleError(`no spec bundle for model version ${defs.modelVersion.semver}`);
    const members = await loadMembers(tx);
    const model = models.get(defs.modelVersion.id, members.membersHash, spec, members.members);
    const { values, overrides } = engineInputs(resolved);
    const ev = model.evaluate(values, overrides);
    const view = guarded(() => businessCase({ scenarioId: scenario, ev, members: members.members, params }));
    return c.json(BusinessCase.parse(view), 200, { 'cache-control': 'private, no-cache', vary: 'Cookie' });
  });
}
