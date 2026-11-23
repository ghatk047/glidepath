import {
  applyChangeset,
  type ApplyBundle,
  type ApplyResult,
  type ChangesetDraft,
  type JsonObject,
  patchScenario,
  PRESET_KIND,
  type Recompute,
  type ScenarioId,
  type ScenarioRow,
  type ScenarioStore,
  type TenantRole,
  type Timestamp,
  type UserId,
} from '@glidepath/domain';
import type { Deliverable } from '../schemas/plan';
import { type ChangesetPart, type DraftOrigin, ReconfigReview, type TenantPlan } from '../schemas/review';

/**
 * Step 8 (06 §2): the user's accept is the only write of a reconfiguration. Every change goes through
 * `applyChangeset` of `@glidepath/domain`; the AI's drafted changes with origin `ai_reconfig`. Pure apart from the
 * port: the worker implements it over data-access, tests over an in-memory store.
 */

/** A tenant opened for the apply, inside the port's transaction. */
export interface ReconfigTenant {
  readonly tenantId: string;
  /** The tenant's pinned model version (the presets' `model_version_id`). */
  readonly modelVersionId: string;
  /** The changeset store in this tenant's context. */
  readonly store: ScenarioStore;
  /** line_item_lever rows of the seed's lines (the changeset store has no write for them), as the seed loader writes them. */
  writeLeverMappings(rows: TenantPlan['leverMappings']): Promise<void>;
}

/** `create`: insert the tenant row from the seed's record (status per the worker). `existing`: open that tenant. */
export type ApplyTarget =
  | { readonly kind: 'create'; readonly record: TenantPlan['record'] }
  | { readonly kind: 'existing'; readonly tenantId: string };

export interface ReconfigApplyPort {
  /**
   * Run `fn` in one transaction of the tenant (the worker: `withTenant`), creating the tenant row first for `create`.
   * Everything commits together, or nothing does if `fn` throws.
   */
  inTenant<T>(target: ApplyTarget, fn: (tenant: ReconfigTenant) => Promise<T>): Promise<T>;
}

export interface ApplyDraftRequest<R = undefined> {
  /** The drafts the user accepted. A new tenant needs `seed`; `lever_tuning` applies only when listed. */
  readonly accept: readonly Deliverable[];
  /** The user accepting: changeset.created_by, audit_log.actor, the presets' created_by. */
  readonly actor: UserId;
  /** The tenant's pinned model. */
  readonly bundle: ApplyBundle;
  /** The contract's idempotency key; each changeset gets `<key>/<kind>/<n>`. */
  readonly clientRequestId?: string;
  readonly recompute?: Recompute<R>;
  readonly newId?: () => string;
  readonly now?: () => Timestamp;
}

/** One changeset applied. */
export interface AppliedChangeset<R = undefined> {
  readonly kind: Deliverable;
  /** null = tenant defaults, else the scenario key. */
  readonly scope: string | null;
  readonly origin: DraftOrigin;
  readonly result: ApplyResult<R>;
}

export interface ApplyDraftResult<R = undefined> {
  readonly tenantId: string;
  /** In apply order: the seed's changesets, then the tuning's. */
  readonly applied: readonly AppliedChangeset<R>[];
  /** Scenario key → id of the presets the seed created (empty when tuning an existing tenant). */
  readonly presets: Readonly<Record<string, ScenarioId>>;
}

/** The accept cannot be applied as asked: nothing was written. */
export class ReconfigApplyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReconfigApplyError';
  }
}

/** The role a tenant's creator holds; it locks the presets the seed created. */
const CREATOR_ROLE: TenantRole = 'owner';

/** Checks that need no state: what is accepted exists and fits the plan. Throws before anything is opened. */
function checkAccept(review: ReconfigReview, accept: readonly Deliverable[]): void {
  if (accept.length === 0) throw new ReconfigApplyError('Nothing accepted: accept the seed, the lever tuning or both.');
  if (new Set(accept).size !== accept.length) throw new ReconfigApplyError('A draft is accepted twice.');
  for (const kind of accept)
    if (review.drafts[kind] === null) throw new ReconfigApplyError(`This job has no ${kind} draft to accept.`);
  if (review.plan.intent === 'onboard' && !accept.includes('seed'))
    throw new ReconfigApplyError('A new tenant needs its seed: accept the seed to apply the lever tuning.');
  if (accept.includes('seed')) {
    if (review.tenant === null) throw new ReconfigApplyError('The seed draft has no tenant record.');
    if (review.validation !== null && !review.validation.ok)
      throw new ReconfigApplyError('The seed draft fails validation: fix the errors before applying.');
  }
  if (!accept.includes('seed') && review.plan.tenant.existingTenantId === null)
    throw new ReconfigApplyError('The lever tuning has no tenant to go on.');
}

/**
 * Step 8 (06 §2): apply the accepted drafts of a review payload (step 7) in one tenant transaction of the port.
 *
 * - Seed (`accept` has `seed`): the port creates the tenant row; the preset scenarios are created unlocked; the seed's
 *   changesets go through `applyChangeset` in order (drafted members and values with origin `ai_reconfig`, the
 *   global presets copied unchanged with origin `seed`); the line-lever links are written; finally the presets are
 *   locked (`patchScenario`).
 * - Lever tuning (`accept` has `lever_tuning`): its own changesets, origin `ai_reconfig`, after the seed (before the
 *   presets lock, so a new tenant's presets take it in place). On an existing tenant a locked preset forks, as for any
 *   edit (`applyChangeset` step 2). Not accepted, nothing of it is written.
 *
 * Nothing is written before the accept is checked (`ReconfigApplyError`), and a rejected changeset (bounds, input
 * rules, a stale version) rolls back the whole apply through the port's transaction.
 */
export async function applyDraft<R = undefined>(
  port: ReconfigApplyPort,
  payload: ReconfigReview | unknown,
  request: ApplyDraftRequest<R>,
): Promise<ApplyDraftResult<R>> {
  const review = ReconfigReview.parse(payload);
  checkAccept(review, request.accept);
  const now = request.now ?? (() => new Date().toISOString());
  const newId = request.newId ?? (() => crypto.randomUUID());
  const withSeed = request.accept.includes('seed');
  const target: ApplyTarget = withSeed
    ? { kind: 'create', record: review.tenant!.record }
    : { kind: 'existing', tenantId: review.plan.tenant.existingTenantId! };

  return port.inTenant(target, async (tenant) => {
    const { store } = tenant;
    const applied: AppliedChangeset<R>[] = [];
    const presets: Record<string, ScenarioId> = {};

    if (withSeed) {
      const rows: ScenarioRow[] = review.tenant!.presets.map((p) => ({
        id: newId(),
        key: p.key,
        label: p.label,
        kind: PRESET_KIND,
        parent_id: null,
        model_version_id: tenant.modelVersionId,
        version: 0,
        locked: false,
        created_by: request.actor,
        created_at: now(),
      }));
      await store.transaction(async (tx) => {
        for (const row of rows) await tx.createScenario(row);
      });
      for (const row of rows) presets[row.key] = row.id;
    }

    const scenarioIds = new Map<string, ScenarioId>(
      (await store.transaction((tx) => tx.loadScenarios())).map((s) => [s.key, s.id]),
    );
    const applyPart = async (kind: Deliverable, part: ChangesetPart, n: number): Promise<void> => {
      const scenarioId = part.scope === null ? null : scenarioIds.get(part.scope);
      if (scenarioId === undefined) throw new ReconfigApplyError(`The tenant has no scenario ${part.scope}.`);
      const base = await store.transaction(async (tx) =>
        scenarioId === null ? (await tx.changesSince(null, 0)).length : ((await tx.loadScenarioForUpdate(scenarioId))?.version ?? 0),
      );
      const draft: ChangesetDraft = {
        origin: part.origin,
        scenario_id: scenarioId,
        base_scenario_version: base,
        changes: part.changes.map((c) => (c.target === 'structural' ? { ...c, new_value: c.new_value as JsonObject | null } : c)),
      };
      const result = await applyChangeset(store, draft, {
        actor: request.actor,
        bundle: request.bundle,
        ...(request.clientRequestId === undefined ? {} : { clientRequestId: `${request.clientRequestId}/${kind}/${n}` }),
        ...(request.recompute === undefined ? {} : { recompute: request.recompute }),
        newId,
        now,
      });
      applied.push({ kind, scope: part.scope, origin: part.origin, result });
    };

    if (withSeed) {
      const parts = review.drafts.seed!.changeset.parts;
      for (const [n, part] of parts.entries()) await applyPart('seed', part, n);
      if (review.tenant!.leverMappings.length > 0) await tenant.writeLeverMappings(review.tenant!.leverMappings);
    }
    if (request.accept.includes('lever_tuning')) {
      const parts = review.drafts.lever_tuning!.changeset.parts;
      for (const [n, part] of parts.entries()) await applyPart('lever_tuning', part, n);
    }
    if (withSeed) {
      for (const id of Object.values(presets))
        await patchScenario(store, id, { locked: true }, { actor: request.actor, role: CREATOR_ROLE, now });
    }
    return { tenantId: tenant.tenantId, applied, presets };
  });
}
