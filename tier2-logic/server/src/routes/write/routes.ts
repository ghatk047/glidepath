import {
  CalcResponse,
  ChangesetId,
  ChangesetRequest,
  CreateScenarioRequest,
  PatchScenarioRequest,
  RevertRequest,
  RevertResult,
  ScenarioParams,
  TenantParams,
  TenantSlug,
} from '@glidepath/api-contract';
import type { Change as ContractChange } from '@glidepath/api-contract';
import { getLatestCalcRun, getScenario } from '@glidepath/data-access';
import {
  ChangesetConflictError,
  applyChangeset,
  createScenario,
  patchScenario,
  revert,
} from '@glidepath/domain';
import type {
  Change,
  ChangesetDraft,
  ChangesetStore,
  CreateScenarioSpec,
  JsonObject,
  ScenarioPatch,
} from '@glidepath/domain';
import type { Context, Hono } from 'hono';
import { z } from 'zod';
import { ApiError } from '../../app/problem';
import type { AppEnv } from '../../app/tenant';
import { checked } from '../read/mappers';
import type { SpecBundleSource } from '../read/spec-source';
import { guarded } from './errors';
import { afterCommit, noSessionHub } from './hub';
import type { SessionHub } from './hub';
import { LruModelCache } from './model-cache';
import { authorOf, loadScenario, pinnedModel, scenarioStore, toChangesetResult, writeContext } from './support';

export interface WriteRoutesDeps {
  /** The spec bundle of the pinned model version: the registry bounds, rules and the engine's formulas. */
  specBundle: SpecBundleSource;
  /** Told after each commit (the WS session hub, API-07); `noSessionHub` by default. */
  hub?: SessionHub;
}

const RevertParams = z.object({ tenant: TenantSlug, id: ChangesetId });

const noSuchScenario = (): ApiError => ApiError.notFound('No such scenario in this tenant. Check the scenario id.');

/** The request body as JSON; an empty or malformed one is a 400 (the error handler maps the SyntaxError). */
const bodyOf = (c: Context<AppEnv>): Promise<unknown> => c.req.json();

/**
 * Contract changes as domain changes. A value change is a `set` of the value or, for `null`, an `unset`
 * (the scenario inherits again / the pin goes). A structural change is a `delete` for `null`, else an
 * `insert` of a member the tenant does not have and a `set` (replace) of one it has; the value is the
 * row content, as history and the 409 body show it (`ChangeRecord.oldValue` / `newValue`).
 */
async function toDraftChanges(store: ChangesetStore, changes: readonly ContractChange[]): Promise<Change[]> {
  const dims = new Map<string, Set<string>>();
  for (const ch of changes) if (ch.target === 'structural') (dims.get(ch.key) ?? dims.set(ch.key, new Set()).get(ch.key)!).add(ch.member);
  const exists = new Set<string>();
  if (dims.size > 0) {
    await store.transaction(async (tx) => {
      for (const [dim, members] of dims) {
        const rows = await tx.loadMemberRows(dim, [...members]);
        for (const m of rows.keys()) exists.add(`${dim}\u0000${m}`);
      }
    });
  }
  return changes.map((ch): Change => {
    if (ch.target !== 'structural') {
      return {
        target: ch.target,
        key: ch.key,
        member_key: ch.member,
        op: ch.value === null ? 'unset' : 'set',
        new_value: ch.value,
        ...(ch.note === undefined ? {} : { note: ch.note }),
      };
    }
    const k = `${ch.key}\u0000${ch.member}`;
    const op = ch.value === null ? 'delete' : exists.has(k) ? 'set' : 'insert';
    if (op === 'delete') exists.delete(k);
    else exists.add(k);
    return {
      target: 'structural',
      key: ch.key,
      member_key: ch.member,
      op,
      new_value: ch.value as JsonObject | null,
      ...(ch.note === undefined ? {} : { note: ch.note }),
    };
  });
}

/**
 * The write half of 04 section 3, on `/api/t/:tenant/*` after the tenant middleware (authenticated,
 * member, handler inside `withTenant`; the CSRF and role guards already ran for these state-changing
 * routes). Every write goes through the domain's one write path; this layer only maps the contract onto
 * it and its errors onto problems. Mount `afterCommitMiddleware()` before the tenant middleware so the
 * hub hears of a write only once it has committed.
 */
export function registerWriteRoutes(app: Hono<AppEnv>, deps: WriteRoutesDeps): void {
  const hub = deps.hub ?? noSessionHub;
  const cache = new LruModelCache();
  const ctxOf = (c: Context<AppEnv>) => writeContext(c, { specBundle: deps.specBundle, cache });

  // Apply a changeset: one write path, then recompute and store calc_run; a locked preset is forked.
  app.post('/api/t/:tenant/changesets', (c) =>
    guarded(c, async () => {
      TenantParams.parse(c.req.param());
      const req = ChangesetRequest.parse(await bodyOf(c));
      const t = c.get('tenant');
      const ctx = await ctxOf(c);
      const draft: ChangesetDraft = {
        origin: 'ui',
        scenario_id: req.scenarioId,
        base_scenario_version: req.baseVersion,
        changes: await toDraftChanges(ctx.store, req.changes),
      };
      const applied = await applyChangeset(ctx.store, draft, {
        actor: t.userId,
        bundle: ctx.bundle,
        recompute: ctx.recompute,
        ...(req.clientRequestId === undefined ? {} : { clientRequestId: req.clientRequestId }),
      });
      const result = await toChangesetResult(t.tx, applied);
      if (!applied.replayed) {
        const author = await authorOf(t.tx, t.userId);
        afterCommit(c, () => hub.changeApplied({ tenantId: t.tenantId, kind: 'apply', result, origin: applied.changeset.origin, author }));
      }
      return c.json(result, 200);
    }),
  );

  // Undo (and redo, which is the revert of an undo) of one changeset, at the version the client saw.
  app.post('/api/t/:tenant/changesets/:id/revert', (c) =>
    guarded(c, async () => {
      const { id } = RevertParams.parse(c.req.param());
      const { baseVersion } = RevertRequest.parse(await bodyOf(c));
      const t = c.get('tenant');
      const ctx = await ctxOf(c);
      // The client's baseVersion first (locks the scenario for the rest of the transaction): a stale one is the 409.
      await ctx.store.transaction(async (tx) => {
        const cs = await tx.loadChangeset(id);
        if (cs === null) return; // revert() answers the 404
        let version: number;
        if (cs.scenario_id === null) {
          await tx.lockTenantDefaults();
          version = (await tx.changesSince(null, 0)).length;
        } else {
          const s = await tx.loadScenarioForUpdate(cs.scenario_id);
          if (s === null) return;
          version = s.version;
        }
        if (version !== baseVersion) {
          throw new ChangesetConflictError(baseVersion, version, await tx.changesSince(cs.scenario_id, baseVersion));
        }
      });
      const applied = await revert(ctx.store, id, { actor: t.userId, bundle: ctx.bundle, recompute: ctx.recompute });
      const base = await toChangesetResult(t.tx, applied);
      const result = checked('revert result', RevertResult, { ...base, reverts: id });
      const author = await authorOf(t.tx, t.userId);
      afterCommit(c, () =>
        hub.changeApplied({ tenantId: t.tenantId, kind: 'revert', result, origin: applied.changeset.origin, author, reverts: result.reverts }),
      );
      return c.json(result, 200);
    }),
  );

  // Create by copy, blend or empty child.
  app.post('/api/t/:tenant/scenarios', (c) =>
    guarded(c, async () => {
      TenantParams.parse(c.req.param());
      const req = CreateScenarioRequest.parse(await bodyOf(c));
      const t = c.get('tenant');
      const ctx = await ctxOf(c);
      const label = req.label === undefined ? {} : { label: req.label };
      const spec: CreateScenarioSpec =
        req.mode === 'copy'
          ? { mode: 'copy', from: req.from, ...label }
          : req.mode === 'child'
            ? { mode: 'child', parent_id: req.parentId, ...label }
            : { mode: 'blend', parts: req.parts.map((p) => ({ scenario_id: p.scenarioId, weight: p.weight })), ...label };
      const created = await createScenario(ctx.store, spec, { actor: t.userId, bundle: ctx.bundle, recompute: ctx.recompute });
      const scenario = await loadScenario(t.tx, created.scenario.id);
      afterCommit(c, () => hub.scenarioChanged({ tenantId: t.tenantId, change: 'created', scenario }));
      return c.json(scenario, 201);
    }),
  );

  // Rename, lock, archive: scenario metadata, not inputs, so no changeset (audited by the domain).
  app.patch('/api/t/:tenant/scenarios/:id', (c) =>
    guarded(c, async () => {
      const { id } = ScenarioParams.parse(c.req.param());
      const req = PatchScenarioRequest.parse(await bodyOf(c));
      const t = c.get('tenant');
      const patch: ScenarioPatch = {
        ...(req.label === undefined ? {} : { label: req.label }),
        ...(req.locked === undefined ? {} : { locked: req.locked }),
        ...(req.archived === undefined ? {} : { archived: req.archived }),
      };
      const before = await loadScenario(t.tx, id);
      await patchScenario(scenarioStore(t.tx), id, patch, { actor: t.userId, role: t.role });
      const scenario = await loadScenario(t.tx, id);
      if (JSON.stringify(before) !== JSON.stringify(scenario)) {
        afterCommit(c, () => hub.scenarioChanged({ tenantId: t.tenantId, change: 'updated', scenario }));
      }
      return c.json(scenario, 200);
    }),
  );

  // Latest stored calc_run: cold start, printing, export. `stale` when it predates the scenario or the pinned model.
  app.get('/api/t/:tenant/scenarios/:id/calc', async (c) => {
    const { id } = ScenarioParams.parse(c.req.param());
    const { tx, tenantId } = c.get('tenant');
    const scenario = await getScenario(tx, id);
    if (!scenario) throw noSuchScenario();
    const run = await getLatestCalcRun(tx, scenario.id);
    if (!run) throw ApiError.notFound('This scenario has no calculation yet. Make an edit to calculate it.');
    const pin = await pinnedModel(tx, tenantId);
    const body = checked('calc', CalcResponse, {
      scenarioId: scenario.id,
      scenarioVersion: run.scenario_version,
      modelVersionId: run.model_version_id,
      inputHash: run.input_hash,
      ms: run.ms,
      createdAt: run.created_at,
      stale: run.scenario_version < scenario.version || run.model_version_id !== pin.id,
      outputs: run.outputs,
    });
    return c.json(body, 200, { 'cache-control': 'private, no-cache' });
  });
}
