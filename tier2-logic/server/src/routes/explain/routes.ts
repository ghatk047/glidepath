import { ExplainParams, ExplainQuery, SearchQuery, TenantParams } from '@glidepath/api-contract';
import { loadMembers, loadModelDefs, loadResolvedInputs } from '@glidepath/data-access';
import { EngineError } from '@glidepath/engine';
import type { Context, Hono } from 'hono';
import { ApiError } from '../../app/problem';
import type { AppEnv } from '../../app/tenant';
import { BundleError, buildBundle } from '../read/bundle';
import type { SpecBundleSource } from '../read/spec-source';
import { buildExplain, engineInputs } from './explain';
import { toEngineKey } from './keys';
import { ModelCache } from './model-cache';
import { buildIndex, search } from './search';

export interface ExplainRoutesDeps {
  /** The spec bundle of a model version: the engine compiles it, search takes its labels. */
  specBundle: SpecBundleSource;
}

function json(c: Context<AppEnv>, body: unknown): Response {
  return c.json(body as never, 200, { 'cache-control': 'private, no-cache', vary: 'Cookie' });
}

/**
 * `GET nodes/:cell/explain?scenario=` and `GET search?q=` of 04 §3, on `/api/t/:tenant/*` after the tenant
 * middleware (authenticated, tenant resolved against memberships, handler inside `withTenant`). Bodies are
 * validated against their contract schemas before they are sent.
 */
export function registerExplainRoutes(app: Hono<AppEnv>, deps: ExplainRoutesDeps): void {
  const models = new ModelCache();

  // The trace drawer: what a number is, from the engine's explain over the scenario's resolved inputs.
  app.get('/api/t/:tenant/nodes/:cell/explain', async (c) => {
    const { cell } = ExplainParams.parse(c.req.param());
    const { scenario } = ExplainQuery.parse(c.req.query());
    const target = toEngineKey(cell);
    if (!target) throw ApiError.badRequest('The cell must look like id[member], for example res.net[].');
    const { tx } = c.get('tenant');

    const defs = await loadModelDefs(tx);
    if (!defs) throw new Error('the tenant pins no readable model version');
    const spec = await deps.specBundle(defs.modelVersion.semver);
    if (!spec) throw new BundleError(`no spec bundle for model version ${defs.modelVersion.semver}`);
    // The scenario before its inputs: a scenario of another tenant is "not found", as on the read routes.
    const resolved = await loadResolvedInputs(tx, scenario);
    if (!resolved) throw ApiError.notFound('No such scenario in this tenant. Check the scenario id.');
    const members = await loadMembers(tx);

    const model = models.get(defs.modelVersion.id, members.membersHash, spec, members.members);
    const { values, overrides } = engineInputs(resolved);
    try {
      const at = model.evaluate(values, overrides);
      return json(c, buildExplain({ model, bundle: spec, at, resolved, engineKey: target.key }));
    } catch (err) {
      if (err instanceof EngineError && err.code === 'UNKNOWN_CELL') {
        throw ApiError.notFound(`No cell ${cell} in this model. Check the node id and member.`);
      }
      throw err;
    }
  });

  // ⌘K: inputs, levers, output nodes, the tenant's lines and the screens, ranked, at most 9.
  app.get('/api/t/:tenant/search', async (c) => {
    TenantParams.parse(c.req.param());
    const { q, limit } = SearchQuery.parse(c.req.query());
    const { tx } = c.get('tenant');
    const defs = await loadModelDefs(tx);
    if (!defs) throw new Error('the tenant pins no readable model version');
    const spec = await deps.specBundle(defs.modelVersion.semver);
    if (!spec) throw new BundleError(`no spec bundle for model version ${defs.modelVersion.semver}`);
    const index = buildIndex(buildBundle(defs, spec), await loadMembers(tx));
    return json(c, search(index, q, limit));
  });
}
