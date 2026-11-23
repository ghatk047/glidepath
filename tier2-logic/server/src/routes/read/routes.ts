import { ChangesetHistoryQuery, ScenarioParams, TenantParams } from '@glidepath/api-contract';
import {
  InvalidCursorError,
  getScenario,
  listChangesetHistory,
  listScenarios,
  loadEditsCounts,
  loadMembers,
  loadModelDefs,
  loadResolvedInputs,
} from '@glidepath/data-access';
import type { Context, Hono } from 'hono';
import { ApiError } from '../../app/problem';
import type { AppEnv } from '../../app/tenant';
import { BundleError, buildBundle } from './bundle';
import { etagOf, ifNoneMatch } from './etag';
import {
  toHistoryResponse,
  toInputsResponse,
  toMembersResponse,
  toScenario,
  toScenariosResponse,
} from './mappers';
import type { SpecBundleSource } from './spec-source';

export interface ReadRoutesDeps {
  /** The spec bundle of a model version, for the bundle fields the database does not hold. */
  specBundle: SpecBundleSource;
}

/** A scenario that is not one of the tenant's (or not a valid id) is "not found", same as another tenant's. */
const noSuchScenario = (): ApiError => ApiError.notFound('No such scenario in this tenant. Check the scenario id.');

function json(c: Context<AppEnv>, body: unknown): Response {
  return c.json(body as never, 200, { 'cache-control': 'private, no-cache' });
}

/**
 * The read routes of 04 §3: bundle, members, scenarios, scenario inputs and changeset history. Mount
 * after the tenant middleware on `/api/t/:tenant/*` (path tenant checked against memberships, handler
 * inside `withTenant`). Every body is validated against its `@glidepath/api-contract` schema before it
 * is sent; one that fails is a server bug and answers 500, never a client error.
 */
export function registerReadRoutes(app: Hono<AppEnv>, deps: ReadRoutesDeps): void {
  // Bundle of the pinned model_version: ETag over the body, 304 on If-None-Match.
  app.get('/api/t/:tenant/bundle', async (c) => {
    TenantParams.parse(c.req.param());
    const { tx } = c.get('tenant');
    const defs = await loadModelDefs(tx);
    if (!defs) throw new Error('the tenant pins no readable model version');
    const spec = await deps.specBundle(defs.modelVersion.semver);
    if (!spec) throw new BundleError(`no spec bundle for model version ${defs.modelVersion.semver}`);
    const body = JSON.stringify(buildBundle(defs, spec));
    const etag = etagOf(body);
    const headers = { etag, 'cache-control': 'private, no-cache', vary: 'Cookie' };
    if (ifNoneMatch(c.req.header('if-none-match'), etag)) return c.body(null, 304, headers);
    return c.body(body, 200, { ...headers, 'content-type': 'application/json' });
  });

  app.get('/api/t/:tenant/members', async (c) => {
    TenantParams.parse(c.req.param());
    return json(c, toMembersResponse(await loadMembers(c.get('tenant').tx)));
  });

  app.get('/api/t/:tenant/scenarios', async (c) => {
    TenantParams.parse(c.req.param());
    const { tx } = c.get('tenant');
    const records = await listScenarios(tx);
    // The domain's stored counter (changeset.summary.edits_count), all scenarios in one query.
    const edits = await loadEditsCounts(tx, records.map((s) => s.id));
    return json(c, toScenariosResponse(records.map((s) => toScenario(s, edits.get(s.id) ?? 0))));
  });

  app.get('/api/t/:tenant/scenarios/:id/inputs', async (c) => {
    const { id } = ScenarioParams.parse(c.req.param());
    const { tx } = c.get('tenant');
    // The scenario first: the version reported is never newer than the inputs read after it.
    const scenario = await getScenario(tx, id);
    if (!scenario) throw noSuchScenario();
    const inputs = await loadResolvedInputs(tx, id);
    if (!inputs) throw noSuchScenario();
    return json(c, toInputsResponse(scenario, inputs));
  });

  app.get('/api/t/:tenant/scenarios/:id/changesets', async (c) => {
    const { id } = ScenarioParams.parse(c.req.param());
    const { cursor, limit } = ChangesetHistoryQuery.parse(c.req.query());
    const { tx } = c.get('tenant');
    const scenario = await getScenario(tx, id);
    if (!scenario) throw noSuchScenario();
    try {
      const page = await listChangesetHistory(tx, scenario.id, { ...(limit !== undefined ? { limit } : {}), cursor: cursor ?? null });
      return json(c, toHistoryResponse(scenario.id, page));
    } catch (err) {
      if (err instanceof InvalidCursorError) throw ApiError.badRequest('The page cursor is not valid. Start again from the first page.');
      throw err;
    }
  });
}
