import { randomUUID } from 'node:crypto';
import {
  ReconfigApplyRequest,
  ReconfigList,
  ReconfigApplyResult,
  ReconfigParams,
  ReconfigRequest,
  UserId,
} from '@glidepath/api-contract';
import type { MembershipRole, ReconfigJob, TenantId, TenantParity } from '@glidepath/api-contract';
import { createAiReconfigJob, getAiReconfigJob, listAiReconfigJobs } from '@glidepath/data-access';
import type { AiReconfigJobRecord } from '@glidepath/data-access';
import type { Context, Hono } from 'hono';
import { ApiError } from '../../app/problem';
import type { AppEnv, Authenticator, WithTenant } from '../../app/tenant';
import { checked } from '../read/mappers';
import type { AiRoutesDeps, AiWho } from './jobs';
import { PARITY_KEY, parityOf } from './parity';
import { cacheOf, hasBlockingQuestion, hasWorkerState, oneLine, reviewOf, toReconfigJob } from './map';
import type { JobHost, JobTimes } from './map';

/** A tenant the caller belongs to, as the AI routes need it. */
export interface AiMembership {
  readonly tenantId: TenantId;
  readonly slug: string;
  readonly currency: string;
  readonly role: MembershipRole;
}

/** What `createApp` hands the AI routes besides the job port: identity, tenant transactions and memberships. */
export interface AiRoutesContext extends AiRoutesDeps {
  readonly authenticate: Authenticator;
  readonly withTenant: WithTenant;
  /** Every tenant the user belongs to (RLS shows a user only their own memberships). */
  readonly memberships: (userId: UserId) => Promise<readonly AiMembership[]>;
}

const DEFAULT_ESTIMATE_WAIT_MS = 5_000;
const ESTIMATE_POLL_MS = 100;
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const decoder = new TextDecoder();
const encoder = new TextEncoder();

/** The bucket key of the request record the route writes beside the worker's own `ai/<job-id>/` objects. */
const requestKey = (jobId: string): string => `${jobId}/request.json`;

interface RequestRecord {
  readonly createdAt: string;
  readonly createdBy: string;
  readonly tenant: string | null;
}

const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').trim();
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Worker-tier error codes (`AiJobError.code`) that are not a plain 422. */
const STATUS_BY_CODE: Readonly<Record<string, number>> = {
  not_found: 404,
  bad_state: 409,
  bad_payload: 400,
  no_bundle: 503,
};

/**
 * The jobs' own errors as problems, recognised by name (the server does not import the worker or the ai package):
 * `AiJobError` (code + a message the user can act on) and `ReconfigApplyError` (the accept cannot be applied).
 */
function mapJobError(err: unknown): unknown {
  if (!(err instanceof Error)) return err;
  if (err.name === 'AiJobError') {
    const status = STATUS_BY_CODE[(err as { code?: string }).code ?? ''] ?? 422;
    return new ApiError({ status, title: status === 404 ? 'Not found' : status === 409 ? 'Conflict' : status === 503 ? 'Service unavailable' : 'Validation failed', detail: oneLine(err.message) });
  }
  if (err.name === 'ReconfigApplyError') {
    const status = /already exists/i.test(err.message) ? 409 : 422;
    return new ApiError({ status, title: status === 409 ? 'Conflict' : 'Validation failed', detail: oneLine(err.message) });
  }
  return err;
}

const notReadable = (): ApiError => ApiError.notFound('No such reconfiguration job, or it is not in one of your tenants.');

/**
 * `POST /api/ai/reconfig`, `GET /api/ai/reconfig/:id`, `POST /api/ai/reconfig/:id/apply` (04 section 3, 06 section 3).
 *
 * The routes are not under `/api/t/:tenant`: a job for a new tenant has no tenant yet. Each request authenticates, then
 * works in the tenant that holds the job row (the existing tenant named in the request, else the first tenant the
 * caller owns) through its own `withTenant` transactions, so a committed row exists before a job is sent. The API-02
 * guards (same origin, CSRF) already ran on `/api/*`. Starting and applying need the owner role of that tenant; reading
 * needs membership.
 */
export function registerAiRoutes(app: Hono<AppEnv>, deps: AiRoutesContext): void {
  const newId = deps.newId ?? randomUUID;
  const waitMs = deps.estimateWaitMs ?? DEFAULT_ESTIMATE_WAIT_MS;

  const userOf = async (c: Context<AppEnv>): Promise<UserId> => {
    const user = await deps.authenticate(c);
    if (user === null) throw ApiError.unauthenticated();
    return user;
  };
  const whoOf = (m: AiMembership, userId: UserId): AiWho => ({ tenantId: m.tenantId, userId });
  const readJob = (m: AiMembership, userId: UserId, id: string): Promise<AiReconfigJobRecord | null> =>
    deps.withTenant(m.tenantId, userId, (tx) => getAiReconfigJob(tx, id));

  /** The tenant the request works in: the named existing tenant (owner), else the first tenant the caller owns. */
  const hostFor = (mine: readonly AiMembership[], slug: string | null): AiMembership => {
    if (slug !== null) {
      const m = mine.find((x) => x.slug === slug);
      if (m === undefined) throw ApiError.notFound('No such tenant, or you are not a member of it.');
      if (m.role !== 'owner') throw ApiError.forbidden('Only a tenant owner can start an AI reconfiguration. Ask a tenant owner.');
      return m;
    }
    const owned = mine.filter((x) => x.role === 'owner').sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
    if (owned[0] === undefined) throw ApiError.forbidden('Only a tenant owner can set up a new tenant. Ask a tenant owner.');
    return owned[0];
  };

  /** The job and the tenant that holds it, searched over the caller's tenants (a job id names no tenant). */
  const locate = async (userId: UserId, id: string): Promise<{ host: AiMembership; row: AiReconfigJobRecord }> => {
    for (const m of await deps.memberships(userId)) {
      const row = await readJob(m, userId, id);
      if (row !== null) return { host: m, row };
    }
    throw notReadable();
  };

  /** Author and time of a job: its request record, and the newest object under `ai/<job-id>/` as last activity. */
  const timesOf = async (host: AiMembership, userId: UserId, row: AiReconfigJobRecord): Promise<JobTimes & { requestedTenant: string | null }> => {
    const objects = deps.objects(whoOf(host, userId));
    const listed = await objects.list('ai', `${row.id}/`);
    const request = await objects.get('ai', requestKey(row.id));
    let record: Partial<RequestRecord> = {};
    if (request !== null) {
      try {
        record = JSON.parse(decoder.decode(request.bytes)) as Partial<RequestRecord>;
      } catch {
        record = {};
      }
    }
    const stamps = listed.map((o) => o.createdAt.getTime());
    const rehearsedAt = cacheOf(row.plan)?.rehearsedAt ?? null;
    const first = stamps.length > 0 ? Math.min(...stamps) : Date.now();
    const last = stamps.length > 0 ? Math.max(...stamps) : first;
    const created = rehearsedAt ?? record.createdAt ?? new Date(first).toISOString();
    const updated = new Date(Math.max(last, Date.parse(created))).toISOString();
    return { createdAt: created, updatedAt: updated, createdBy: record.createdBy ?? null, requestedTenant: record.tenant ?? null };
  };

  const present = async (host: AiMembership, userId: UserId, row: AiReconfigJobRecord) => {
    const times = await timesOf(host, userId, row);
    const jobHost: JobHost = { slug: host.slug, currency: host.currency };
    return toReconfigJob({ id: row.id, prompt: row.prompt, status: row.status, plan: row.plan }, jobHost, times, times.requestedTenant);
  };

  /** A cached rehearsal (06 section 3) that answers this request: same prompt, or a new-tenant prompt that names the airline. */
  const findCached = async (host: AiMembership, userId: UserId, prompt: string, tenant: string | null): Promise<AiReconfigJobRecord | null> => {
    const rows = await deps.withTenant(host.tenantId, userId, (tx) => listAiReconfigJobs(tx, 'review'));
    for (const row of rows) {
      const cache = cacheOf(row.plan);
      if (cache === null) continue;
      if (norm(row.prompt) === norm(prompt)) return row;
      if (tenant !== null) continue;
      const names = cache.name !== null && new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(cache.name)}($|[^\\p{L}\\p{N}])`, 'iu').test(prompt);
      const code = cache.iata !== null && new RegExp(`(^|[^A-Za-z0-9])${escapeRe(cache.iata)}($|[^A-Za-z0-9])`).test(prompt);
      if (names || code) return row;
    }
    return null;
  };

  /** Waits (bounded) until the worker has stored its state with the cost estimate, so the answer carries it. */
  const awaitEstimate = async (host: AiMembership, userId: UserId, id: string): Promise<AiReconfigJobRecord> => {
    const deadline = Date.now() + waitMs;
    for (;;) {
      const row = await readJob(host, userId, id);
      if (row === null) throw notReadable();
      if (hasWorkerState(row.plan) || Date.now() >= deadline) return row;
      await sleep(ESTIMATE_POLL_MS);
    }
  };

  app.post('/api/ai/reconfig', async (c) => {
    const userId = await userOf(c);
    const req = ReconfigRequest.parse(await c.req.json());
    const host = hostFor(await deps.memberships(userId), req.tenant);
    c.header('cache-control', 'private, no-store');

    // The rehearsed job of the demo (UA): shown at once, nothing is queued or spent.
    const cached = await findCached(host, userId, req.prompt, req.tenant);
    if (cached !== null) return c.json(await present(host, userId, cached), 201);

    const jobId = newId();
    await deps.withTenant(host.tenantId, userId, (tx) => createAiReconfigJob(tx, { id: jobId, prompt: req.prompt, status: 'queued' }));
    const record: RequestRecord = { createdAt: new Date().toISOString(), createdBy: userId, tenant: req.tenant };
    await deps.objects(whoOf(host, userId)).put('ai', requestKey(jobId), encoder.encode(JSON.stringify(record)), { contentType: 'application/json' });
    const who = whoOf(host, userId);

    if (req.dryRun === true) {
      try {
        await deps.jobs.estimateReconfig(who, { jobId });
      } catch (err) {
        if (err instanceof ApiError) throw err; // queue unavailable, timeout: the caller's to retry
        // The job ended failed or over budget: its row says why, and the answer shows it.
      }
    } else {
      await deps.jobs.startReconfig(who, { jobId });
      await awaitEstimate(host, userId, jobId);
    }
    const row = await readJob(host, userId, jobId);
    if (row === null) throw notReadable();
    return c.json(await present(host, userId, row), 201);
  });

  /** The newest first: `createdAt` (the cached rehearsal: its rehearsal time), the id breaking a tie. */
  const newestFirst = (a: ReconfigJob, b: ReconfigJob): number => (a.createdAt === b.createdAt ? (a.id < b.id ? -1 : 1) : a.createdAt < b.createdAt ? 1 : -1);

  // Declared with the other `/api/ai/reconfig` routes; `:id` does not match the bare path.
  app.get('/api/ai/reconfig', async (c) => {
    const userId = await userOf(c);
    const jobs: ReconfigJob[] = [];
    const parity: TenantParity[] = [];
    for (const m of await deps.memberships(userId)) {
      // A dry run (`estimated`) only priced a request: nothing was queued, so it is not a job to continue.
      const rows = await deps.withTenant(m.tenantId, userId, (tx) => listAiReconfigJobs(tx));
      for (const row of rows) if (row.status !== 'estimated') jobs.push(await present(m, userId, row));
      const stored = await deps.objects(whoOf(m, userId)).get('ai', PARITY_KEY);
      const found = stored === null ? null : parityOf(stored.bytes, m.slug);
      if (found !== null) parity.push(found);
    }
    jobs.sort(newestFirst);
    parity.sort((a, b) => (a.tenant < b.tenant ? -1 : a.tenant > b.tenant ? 1 : 0));
    c.header('cache-control', 'private, no-store');
    return c.json(checked('reconfig list', ReconfigList, { jobs, parity }), 200);
  });

  app.get('/api/ai/reconfig/:id', async (c) => {
    const userId = await userOf(c);
    const { id } = ReconfigParams.parse(c.req.param());
    const { host, row } = await locate(userId, id);
    c.header('cache-control', 'private, no-store');
    return c.json(await present(host, userId, row), 200);
  });

  app.post('/api/ai/reconfig/:id/apply', async (c) => {
    const userId = await userOf(c);
    const { id } = ReconfigParams.parse(c.req.param());
    const req = ReconfigApplyRequest.parse(await c.req.json());
    const { host, row } = await locate(userId, id);
    if (host.role !== 'owner') throw ApiError.forbidden('Only a tenant owner can apply an AI reconfiguration. Ask a tenant owner.');

    const accept = [...new Set(req.drafts)];
    if (row.status !== 'review' && row.status !== 'applied') {
      throw new ApiError({ status: 409, title: 'Conflict', detail: `This job is ${row.status}: only a job in review can be applied.` });
    }
    if (row.status === 'review') {
      if (hasBlockingQuestion(row.plan)) {
        throw new ApiError({ status: 422, title: 'Validation failed', detail: 'This job has a blocking open question. Resolve it before applying.' });
      }
      const review = reviewOf(row.plan);
      const missing = accept.filter((k) => !review.drafts.includes(k));
      if (missing.length > 0) {
        throw new ApiError({ status: 422, title: 'Validation failed', detail: `This job has no ${missing.join(' or ')} draft to apply.` });
      }
      if (review.intent === 'onboard' && !accept.includes('seed')) {
        throw new ApiError({ status: 422, title: 'Validation failed', detail: 'A new tenant needs its seed: accept the seed draft.' });
      }
    }
    let done;
    try {
      done = await deps.jobs.applyReconfig(whoOf(host, userId), {
        jobId: row.id,
        accept,
        ...(req.clientRequestId === undefined ? {} : { clientRequestId: req.clientRequestId }),
      });
    } catch (err) {
      throw mapJobError(err);
    }
    const body = checked('reconfig apply result', ReconfigApplyResult, {
      jobId: done.jobId,
      tenantId: done.tenantId,
      tenant: done.tenant,
      applied: done.applied.map((a) => ({ kind: a.kind, changesetId: a.changesetId, editsCount: a.editsCount })),
    });
    return c.json(body, 200);
  });
}
