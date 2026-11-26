import {
  BenchmarkGap,
  RenewalCalendar,
  SourcingParams,
  SourcingParamsQuery,
  SourcingQuery,
  TenantParams,
  VendorSpend,
  sourcingRoutes,
} from '@glidepath/api-contract';
import {
  changesetTx,
  getScenario,
  getTenant,
  loadMembers,
  loadModelDefs,
  loadResolvedInputs,
  loadSourcingMembers,
} from '@glidepath/data-access';
import type { DimensionMembersRead, MembersSnapshot, TenantTx } from '@glidepath/data-access';
import {
  SourcingDataError,
  benchmarkGap,
  poolLeverSavings,
  readSourcingParams,
  renewalCalendar,
  sourcingLines,
  sourcingYears,
  vendorSpend,
} from '@glidepath/domain';
import type { LineItemColumns, SourcingLine, ViewEvaluation } from '@glidepath/domain';
import type { Context, Hono } from 'hono';
import { ApiError } from '../../app/problem';
import type { AppEnv } from '../../app/tenant';
import { engineInputs } from '../explain/explain';
import { ModelCache } from '../explain/model-cache';
import { BundleError } from '../read/bundle';
import type { SpecBundleSource } from '../read/spec-source';

/**
 * What the routes get from `createApp` (the same as the explain and market routes). The tenant transaction comes
 * from `c.get('tenant').tx`.
 */
export interface SourcingRoutesDeps {
  /** The spec bundle of the pinned model version (registry, formulas) for evaluating a scenario. */
  specBundle: SpecBundleSource;
}

const notYet = (): never => {
  throw new ApiError({
    status: 501,
    title: 'Not implemented',
    detail: 'The consolidation optimizer lands with SRC-10.',
  });
};

const NO_SCENARIO = 'No such scenario in this tenant. Check the scenario id.';

function json(c: Context<AppEnv>, body: unknown): Response {
  return c.json(body as never, 200, { 'cache-control': 'private, no-cache', vary: 'Cookie' });
}

/** Sourcing data the tenant holds is incomplete (a parameter or attribute missing): a problem, not a 500. */
async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof SourcingDataError) {
      throw new ApiError({ status: 422, title: 'Sourcing data incomplete', detail: `${err.message}.` });
    }
    throw err;
  }
}

/** Everything a sourcing view of one scenario reads. */
interface ScenarioSourcing {
  members: MembersSnapshot;
  sourcing: DimensionMembersRead;
  ev: ViewEvaluation;
  lines: SourcingLine[];
}

/**
 * The scenario's evaluation (its resolved inputs on the tenant's members, compiled once per members set), the
 * sourcing members, and the lines with their line_item columns. A scenario of another tenant, or none, is the
 * same 404 as on the read and explain routes, checked before anything else is read.
 */
async function loadScenario(tx: TenantTx, scenarioId: string, deps: SourcingRoutesDeps, models: ModelCache): Promise<ScenarioSourcing> {
  const resolved = await loadResolvedInputs(tx, scenarioId);
  if (!resolved) throw ApiError.notFound(NO_SCENARIO);
  const defs = await loadModelDefs(tx);
  if (!defs) throw new Error('the tenant pins no readable model version');
  const spec = await deps.specBundle(defs.modelVersion.semver);
  if (!spec) throw new BundleError(`no spec bundle for model version ${defs.modelVersion.semver}`);
  const members = await loadMembers(tx);
  const model = models.get(defs.modelVersion.id, members.membersHash, spec, members.members);
  const { values, overrides } = engineInputs(resolved);
  const ev = model.evaluate(values, overrides);
  const sourcing = await loadSourcingMembers(tx);
  // vendor_text, vendor_key, qty and unit are line_item columns the members view does not expose.
  const lineKeys = (members.members['line'] ?? []).map((l) => l.id);
  const rows = (await changesetTx(tx).loadMemberRows('line', lineKeys)) as ReadonlyMap<string, LineItemColumns>;
  return { members, sourcing, ev, lines: sourcingLines(members.members, rows, ev) };
}

/**
 * `/api/t/:tenant/sourcing/*` (SRC-07, contract `sourcingRoutes`): the vendor spend cube, the renewal calendar,
 * the should-cost benchmarks and the sourcing parameters of a scenario, computed by @glidepath/domain over the
 * scenario's evaluation and the tenant's `contract`, `benchmark` and `sourcing_param` members. Behind the auth
 * and tenant middleware; bodies are validated against their contract schemas before they are sent. The
 * consolidation optimizer (SRC-10) still answers 501.
 */
export function registerSourcingRoutes(app: Hono<AppEnv>, deps: SourcingRoutesDeps): void {
  const r = sourcingRoutes;
  const models = new ModelCache();

  app.get(r.sourcingVendors.path, async (c) => {
    TenantParams.parse(c.req.param());
    const { scenario } = SourcingQuery.parse(c.req.query());
    const { tx } = c.get('tenant');
    const s = await loadScenario(tx, scenario, deps, models);
    const view = await guarded(async () =>
      vendorSpend({
        scenarioId: scenario,
        lines: s.lines,
        members: s.members.members,
        contracts: s.sourcing.members['contract'] ?? [],
        buckets: s.sourcing.members['vendor_bucket'] ?? [],
      }),
    );
    return json(c, VendorSpend.parse(view));
  });

  app.get(r.sourcingRenewals.path, async (c) => {
    TenantParams.parse(c.req.param());
    const { scenario } = SourcingQuery.parse(c.req.query());
    const { tx } = c.get('tenant');
    const s = await loadScenario(tx, scenario, deps, models);
    const tenant = await getTenant(tx);
    if (!tenant) throw new Error('the tenant row is not readable');
    const view = await guarded(async () =>
      renewalCalendar({
        scenarioId: scenario,
        contracts: s.sourcing.members['contract'] ?? [],
        lines: s.lines,
        vendors: s.members.members['vendor'] ?? [],
        params: readSourcingParams(s.sourcing.members['sourcing_param'] ?? []),
        planYear: { key: sourcingYears(s.members.members).planYear, calendarYear: tenant.target_year },
      }),
    );
    return json(c, RenewalCalendar.parse(view));
  });

  app.get(r.sourcingBenchmarks.path, async (c) => {
    TenantParams.parse(c.req.param());
    const { scenario } = SourcingQuery.parse(c.req.query());
    const { tx } = c.get('tenant');
    const s = await loadScenario(tx, scenario, deps, models);
    const view = await guarded(async () =>
      benchmarkGap({
        scenarioId: scenario,
        benchmarks: s.sourcing.members['benchmark'] ?? [],
        lines: s.lines,
        params: readSourcingParams(s.sourcing.members['sourcing_param'] ?? []),
        leverSavingsByPool: poolLeverSavings(s.ev, s.members.members),
      }),
    );
    return json(c, BenchmarkGap.parse(view));
  });

  app.get(r.sourcingParams.path, async (c) => {
    TenantParams.parse(c.req.param());
    const { scenario } = SourcingParamsQuery.parse(c.req.query());
    const { tx } = c.get('tenant');
    // Parameters are tenant members, the same for every scenario; a named scenario must still be the tenant's.
    if (scenario !== undefined && !(await getScenario(tx, scenario))) throw ApiError.notFound(NO_SCENARIO);
    const sourcing = await loadSourcingMembers(tx);
    const { params } = await guarded(async () => readSourcingParams(sourcing.members['sourcing_param'] ?? []));
    return json(c, SourcingParams.parse({ params }));
  });

  app.post(r.sourcingConsolidation.path, notYet);
}
