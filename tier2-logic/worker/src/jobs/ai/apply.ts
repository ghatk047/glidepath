import {
  applyDraft,
  type ApplyTarget,
  type Deliverable,
  type ReconfigApplyPort,
  ReconfigApplyError,
  ReconfigReview,
  type ReconfigTenant,
} from '@glidepath/ai';
import { createChangesetStore, getAiReconfigJob, schema, sql, updateAiReconfigJob, withTenant } from '@glidepath/data-access';
import type { Db, TenantTx } from '@glidepath/data-access';
import type { JsonValue } from '@glidepath/domain';
import { seedIds } from '../../seed/ids';
import type { AiJobDeps } from './deps';
import { AiJobError, type AiJobContext, type AppliedReconfig, type ApplyPayload, type StoredReconfigJob } from './types';

/** `line_item_lever` rows per insert, as the seed loader writes them. */
const CHUNK = 500;

const text = (record: Readonly<Record<string, unknown>>, field: string): string => {
  const v = record[field];
  if (typeof v !== 'string' || v === '') throw new ReconfigApplyError(`The tenant record has no ${field}.`);
  return v;
};
const int = (record: Readonly<Record<string, unknown>>, field: string): number => {
  const v = record[field];
  if (typeof v !== 'number' || !Number.isInteger(v)) throw new ReconfigApplyError(`The tenant record's ${field} is not an integer.`);
  return v;
};

export interface ApplyPortOptions {
  readonly db: Db;
  /** The user accepting: tenant member (owner), changeset author. */
  readonly actor: string;
  /** The pinned model of the new tenant: the job's tenant's. */
  readonly modelVersionId: string;
  readonly now?: () => Date;
}

/** The tenant a seed creates gets the id the seed loader would give it, so a second run finds it. */
export const reconfigTenantId = (slug: string): string => seedIds.tenant(slug);

/**
 * `ReconfigApplyPort` over data-access (AI-05): `inTenant` is one `withTenant` transaction of the target tenant. For
 * `create` it first inserts the tenant row (status `active`, the pinned model of the job's tenant) and an owner
 * membership for the accepting user; `fn` then gets the tenant's ScenarioStore (`createChangesetStore` on the
 * transaction), its pinned model version and a writer for `line_item_lever`. A throw rolls the whole apply back.
 */
export function createApplyPort(o: ApplyPortOptions): ReconfigApplyPort {
  const now = o.now ?? (() => new Date());
  const open = (tenantId: string, tx: TenantTx, modelVersionId: string): ReconfigTenant => ({
    tenantId,
    modelVersionId,
    store: createChangesetStore(tx),
    writeLeverMappings: async (rows) => {
      for (let i = 0; i < rows.length; i += CHUNK) {
        await tx
          .insert(schema.line_item_lever)
          .values(rows.slice(i, i + CHUNK).map((r) => ({ tenant_id: tenantId, line_key: r.line_key, lever_code: r.lever_code, mapping_source: 'rule' as const })))
          .onConflictDoNothing();
      }
    },
  });
  return {
    inTenant: async <T>(target: ApplyTarget, fn: (tenant: ReconfigTenant) => Promise<T>): Promise<T> => {
      if (target.kind === 'existing') {
        return withTenant(o.db, target.tenantId, o.actor, async (tx) => {
          const [row] = await tx.select({ model_version_id: schema.tenant.model_version_id }).from(schema.tenant);
          if (row === undefined) throw new ReconfigApplyError('The tenant does not exist or is not yours.');
          return fn(open(target.tenantId, tx, row.model_version_id));
        });
      }
      const slug = text(target.record, 'id');
      const tenantId = reconfigTenantId(slug);
      return withTenant(o.db, tenantId, o.actor, async (tx) => {
        const found = await tx.select({ id: schema.tenant.id }).from(schema.tenant);
        if (found.length > 0) throw new ReconfigApplyError(`Tenant ${slug} already exists: the seed creates a new tenant.`);
        const ticker = target.record.ticker;
        await tx.insert(schema.tenant).values({
          id: tenantId,
          slug,
          name: text(target.record, 'name'),
          currency: text(target.record, 'currency'),
          base_year: int(target.record, 'base_year'),
          target_year: int(target.record, 'target_year'),
          fiscal_calendar: text(target.record, 'fiscal_calendar'),
          ticker: typeof ticker === 'string' ? ticker : null,
          model_version_id: o.modelVersionId,
          status: 'active',
          created_at: now(),
        });
        await tx.insert(schema.tenant_membership).values({ tenant_id: tenantId, user_id: o.actor, role: 'owner' });
        return fn(open(tenantId, tx, o.modelVersionId));
      });
    },
  };
}

/** What `ai.apply` answers: the contract's `ReconfigApplyResult`. */
export interface ApplyJobResult {
  readonly jobId: string;
  readonly tenantId: string;
  readonly tenant: string;
  readonly applied: AppliedReconfig['applied'];
}

const asJson = (v: unknown): JsonValue => JSON.parse(JSON.stringify(v)) as JsonValue;

/**
 * Applies the accepted drafts of a job in `review` (06 section 2 step 8): `applyDraft` of `@glidepath/ai` through
 * `createApplyPort`, every changeset origin `ai_reconfig` (the global presets copied unchanged: `seed`). Then the
 * job becomes `applied` with the result in `plan.applied`.
 *
 * - The contract's `changesetId` is per kind, a seed is several changesets: `applied[kind].changesetId` is the first
 *   changeset of that kind (the new tenant's defaults, or the tuning's first scope) and `editsCount` the draft's change
 *   count; all ids are in `plan.applied.changesets`.
 * - `ai_reconfig_job.changeset_id` is the lever tuning's first changeset when accepted, else the seed's first, but only when the changesets
 *   are in the job's own tenant (the column's foreign key is per tenant): a new tenant's changesets live in that
 *   tenant, so the column stays null there.
 * - A repeat of an applied job returns the stored result.
 */
export async function runApply(ctx: AiJobContext, payload: ApplyPayload, deps: AiJobDeps): Promise<ApplyJobResult> {
  const job = await ctx.withTenant((tx) => getAiReconfigJob(tx, payload.jobId));
  if (job === null) throw new AiJobError('not_found', `No reconfiguration job ${payload.jobId}.`);
  const stored = job.plan as unknown as StoredReconfigJob;
  if (job.status === 'applied' && stored.applied !== null)
    return { jobId: job.id, tenantId: stored.applied.tenantId, tenant: stored.applied.tenant, applied: stored.applied.applied };
  if (job.status !== 'review' || stored.review === null)
    throw new AiJobError('bad_state', `Job ${job.id} is ${job.status}: only a job in review can be applied.`);
  const review = ReconfigReview.parse(stored.review);

  const spec = await deps.spec();
  const db = deps.db();
  const home = await ctx.withTenant(async (tx) => {
    const [row] = await tx
      .select({ model_version_id: schema.tenant.model_version_id, semver: schema.model_version.semver })
      .from(schema.tenant)
      .innerJoin(schema.model_version, sql`${schema.model_version.id} = ${schema.tenant.model_version_id}`);
    return row ?? null;
  });
  if (home === null) throw new AiJobError('bad_state', 'The job\'s tenant has no pinned model version.');
  if (spec.bundle.specVersion !== home.semver)
    throw new AiJobError('no_bundle', `This worker has the model ${spec.bundle.specVersion}, the tenant is pinned to ${home.semver}.`);

  const port = createApplyPort({ db, actor: ctx.userId, modelVersionId: home.model_version_id, now: deps.now });
  const result = await applyDraft(port, review, {
    accept: payload.accept,
    actor: ctx.userId,
    bundle: spec.bundle,
    ...(payload.clientRequestId === undefined ? {} : { clientRequestId: payload.clientRequestId }),
    newId: deps.newId,
    now: () => deps.now().toISOString(),
  });

  const kinds: Deliverable[] = (['seed', 'lever_tuning'] as const).filter((k) => payload.accept.includes(k));
  const applied = kinds.map((kind) => {
    const first = result.applied.find((a) => a.kind === kind);
    return { kind, changesetId: first!.result.changesetId, editsCount: review.drafts[kind]?.changes ?? 0 };
  });
  const slug = await withTenant(db, result.tenantId, ctx.userId, async (tx) => {
    const [row] = await tx.select({ slug: schema.tenant.slug }).from(schema.tenant);
    return row?.slug ?? '';
  });
  const done: AppliedReconfig = {
    tenantId: result.tenantId,
    tenant: slug,
    applied,
    changesets: result.applied.map((a) => ({
      kind: a.kind,
      scope: a.scope,
      changesetId: a.result.changesetId,
      origin: a.origin,
      editsCount: a.result.editsCount,
    })),
  };
  const own = result.tenantId === ctx.tenantId;
  const head = applied.find((a) => a.kind === 'lever_tuning') ?? applied[0]!;
  await ctx.withTenant((tx) =>
    updateAiReconfigJob(tx, job.id, {
      status: 'applied',
      plan: asJson({ ...stored, applied: done, step: 'apply', progress: 1, note: 'Applied' } satisfies StoredReconfigJob),
      ...(own ? { changeset_id: head.changesetId } : {}),
    }),
  );
  return { jobId: job.id, tenantId: done.tenantId, tenant: done.tenant, applied: done.applied };
}
