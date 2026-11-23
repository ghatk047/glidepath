import { ReconfigJob } from '@glidepath/api-contract';
import type { Problem, ReconfigStatus, RuleId } from '@glidepath/api-contract';
import { checked } from '../read/mappers';

/**
 * The worker's job state (`ai_reconfig_job.plan` = AI-06 `StoredReconfigJob`, whose review is the `@glidepath/ai`
 * `ReconfigReview`) as the contract's `ReconfigJob`. The server imports neither package, so the stored JSON is read
 * through the narrow, defensive shapes below; the result is checked against the contract schema.
 */

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** One line, never empty (contract `OneLine`). */
export const oneLine = (s: string, fallback = '-'): string => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t === '' ? fallback : t;
};

/** The AI package writes a scalar cell as `id`; the contract's CellKey is `id[]`. */
const cellKey = (cell: string): string => (cell.includes('[') ? cell : `${cell}[]`);

const RULES: ReadonlySet<string> = new Set<RuleId>(['VR01', 'VR02', 'VR03', 'VR04', 'VR05', 'VR06', 'VR07', 'VR08', 'VR09', 'VR10']);

/** Who and when, from the job's objects (`ai_reconfig_job` has no author or timestamp columns). */
export interface JobTimes {
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly createdBy: string | null;
}

/** The tenant that holds the job row. */
export interface JobHost {
  readonly slug: string;
  readonly currency: string;
}

export interface JobRow {
  readonly id: string;
  readonly prompt: string;
  readonly status: string;
  readonly plan: unknown;
}

/** Shown while the worker has not stored its own estimate yet (the job is queued; nothing was spent). */
const PENDING_ESTIMATE = { inputTokens: 0, outputTokens: 0, usd: 0, model: 'pending', maxTokens: 1 } as const;

const STEP_LINES: Readonly<Record<string, string>> = {
  scope: 'Read the request and plan the job',
  research: 'Research public sources (annual report, filings, press)',
  seed_draft: 'Draft the tenant seed from the facts',
  validate: 'Check the draft against the model rules',
  calibrate: 'Rebuild the last reported year and compare it with the filing',
  lever_tuning: 'Propose lever tuning as a separate changeset',
  review: 'Prepare the review: plan, sources, drafts and open questions',
};

function stepsOf(produce: readonly string[]): string[] {
  const seed = produce.includes('seed');
  const tuning = produce.includes('lever_tuning');
  const keys = ['scope', 'research', ...(seed ? ['seed_draft', 'validate', 'calibrate'] : []), ...(tuning ? ['lever_tuning'] : []), 'review'];
  return keys.map((k) => STEP_LINES[k]!);
}

/** Contract plan from the AI plan (step 1); the tenant record of a seed draft gives slug and currency when it has them. */
function planOf(plan: Rec, review: Rec, host: JobHost): unknown {
  if (Object.keys(plan).length === 0) return null;
  const tenant = rec(plan.tenant);
  const iata = str(tenant.iataCode);
  const name = str(tenant.name);
  if (iata === null || name === null) return null;
  const onboard = plan.intent === 'onboard';
  const record = rec(rec(review.tenant).record);
  const produce = arr(plan.produce).filter((p): p is string => typeof p === 'string');
  return {
    mode: onboard ? 'new_tenant' : 'existing_tenant',
    tenant: {
      name,
      slug: onboard ? (str(record.id) ?? iata.toLowerCase()) : host.slug,
      monogram: iata,
      ticker: str(tenant.ticker),
      // A plan without a currency (the prompt names none): the tenant record's, else the host tenant's.
      currency: str(tenant.currency) ?? str(record.currency) ?? host.currency,
    },
    baseYear: num(plan.baseYear) ?? 0,
    targetYear: num(plan.targetYear) ?? 0,
    produce,
    steps: stepsOf(produce),
  };
}

/** Validation entries that name a rule are rule results; the others (`members`, `engine`) become review notes. */
function violationsOf(entries: readonly unknown[]): unknown[] {
  const out: unknown[] = [];
  for (const e of entries) {
    const r = rec(e);
    const check = str(r.check);
    if (check === null || !RULES.has(check)) continue;
    out.push({
      rule: check,
      cells: arr(r.cells).filter((c): c is string => typeof c === 'string' && !c.includes('/')).map(cellKey),
      severity: r.severity === 'error' ? 'error' : 'warning',
      message: oneLine(String(r.message ?? '')),
    });
  }
  return out;
}

const hostOf = (url: string): string | null => {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
};

function sourcesOf(review: Rec, retrievedAt: string): { sources: unknown[]; idOfUrl: Map<string, string> } {
  const idOfUrl = new Map<string, string>();
  const sources: unknown[] = [];
  for (const s of arr(review.sources)) {
    const r = rec(s);
    const url = str(r.url);
    if (url === null || !/^https?:\/\//i.test(url) || idOfUrl.has(url)) continue; // only public web pages are citations
    const id = `S${sources.length + 1}`;
    idOfUrl.set(url, id);
    sources.push({ id, title: oneLine(str(r.title) ?? url), publisher: hostOf(url), url, publishedAt: null, retrievedAt });
  }
  return { sources, idOfUrl };
}

function factsOf(review: Rec, idOfUrl: Map<string, string>): unknown[] {
  return arr(review.facts).map((f) => {
    const r = rec(f);
    const url = str(r.sourceUrl);
    return {
      id: String(r.id ?? ''),
      item: String(r.step ?? ''),
      label: String(r.label ?? ''),
      value: typeof r.value === 'number' ? r.value : String(r.value ?? ''),
      unit: String(r.unit ?? ''),
      sourceId: url === null ? null : (idOfUrl.get(url) ?? null),
      asOf: str(r.date),
      confidence: r.confidence === 'H' || r.confidence === 'M' ? r.confidence : 'L',
    };
  });
}

/** The impact of the tenant defaults (`scope` null) when there is one, else of the first scope that evaluated. */
function impactOf(previews: readonly unknown[]): unknown[] {
  const ok = previews.map(rec).filter((p) => p.error === null || p.error === undefined);
  const chosen = ok.find((p) => p.scope === null) ?? ok[0];
  if (chosen === undefined) return [];
  return arr(chosen.rows).flatMap((row) => {
    const r = rec(row);
    const after = num(r.after);
    return after === null ? [] : [{ cell: cellKey(String(r.cell ?? '')), before: num(r.before), after }];
  });
}

function draftOf(kind: 'seed' | 'lever_tuning', d: unknown): unknown {
  const r = rec(d);
  return {
    kind,
    title: oneLine(String(r.title ?? kind)),
    summary: oneLine(String(r.summary ?? kind)),
    changes: num(r.changes) ?? 0,
    sections: arr(r.sections).map((s) => ({ section: String(rec(s).section ?? ''), changes: num(rec(s).changes) ?? 0 })),
    warnings: violationsOf(arr(r.warnings)),
    impact: impactOf(arr(r.impact)),
  };
}

function calibrationOf(cal: Rec, lastReportedYear: number | null): unknown {
  if (Object.keys(cal).length === 0) return null;
  const rounds = arr(cal.rounds).map(rec);
  const last = rounds[rounds.length - 1] ?? {};
  const repairRounds = rounds.reduce((m, r) => Math.max(m, num(r.round) ?? 0), 0);
  const yearText = str(cal.year);
  const fromMember = yearText === null ? null : /^fy(\d{2}|\d{4})$/.exec(yearText);
  const fiscalYear = lastReportedYear ?? (fromMember ? (fromMember[1]!.length === 2 ? 2000 : 0) + Number(fromMember[1]) : 0);
  const lines = arr(last.metrics).flatMap((m) => {
    const r = rec(m);
    const reported = num(r.reported);
    const model = num(r.model);
    if (reported === null || model === null) return []; // a missing figure is a review flag, not a comparison line
    return [
      {
        metric: oneLine(String(r.metric ?? '')),
        cell: str(r.cell) === null ? null : cellKey(str(r.cell)!),
        reported,
        model,
        residual: num(r.relative) ?? 0,
        ok: r.status === 'tied',
      },
    ];
  });
  return { fiscalYear, tolerance: num(cal.tolerance) ?? 0, passed: cal.tied === true, repairRounds, lines };
}

/** Model questions, review flags and non-rule validation entries, as open questions. Only a blocking one stops apply. */
function questionsOf(review: Rec): unknown[] {
  const out: unknown[] = [];
  for (const q of arr(review.openQuestions)) {
    const r = rec(q);
    out.push({ id: String(r.id ?? ''), question: oneLine(String(r.question ?? '')), context: str(r.origin), item: str(r.item), blocking: r.blocking === true });
  }
  for (const f of arr(review.flags)) {
    const r = rec(f);
    out.push({
      id: `flag:${String(r.kind ?? '')}:${String(r.target ?? '')}`,
      question: oneLine(String(r.message ?? '')),
      context: str(r.kind),
      item: str(r.step),
      blocking: false,
    });
  }
  const entries = arr(rec(review.validation).entries);
  for (const e of entries) {
    const r = rec(e);
    const check = str(r.check);
    if (check === null || RULES.has(check)) continue;
    out.push({
      id: `check:${check}:${out.length}`,
      question: oneLine(String(r.message ?? '')),
      context: check,
      item: null,
      blocking: false,
    });
  }
  return out;
}

const STATUSES: ReadonlySet<string> = new Set<ReconfigStatus>(['estimated', 'queued', 'running', 'review', 'applied', 'failed', 'budget_exceeded', 'cancelled']);

function errorOf(stored: Rec, status: string): Problem | null {
  const e = rec(stored.error);
  const message = str(e.message);
  if (message === null) return status === 'failed' ? { type: 'about:blank', title: 'AI job failed', status: 502, detail: 'The job failed. Start a new reconfiguration.' } : null;
  const budget = status === 'budget_exceeded';
  return {
    type: 'about:blank',
    title: budget ? 'Token budget reached' : 'AI job failed',
    status: budget ? 422 : 502,
    detail: oneLine(message),
  };
}

/** The contract's `ReconfigJob` for a stored job. `tenant` is the tenant the request named, else the existing tenant of a tune plan, else null. */
export function toReconfigJob(row: JobRow, host: JobHost, times: JobTimes, requestedTenant: string | null = null): ReconfigJob {
  const stored = rec(row.plan);
  const known = stored.format === 1;
  const review = rec(stored.review);
  const plan = rec(stored.plan);
  const aiPlan = Object.keys(review).length > 0 ? rec(review.plan) : plan;
  const retrievedAt = str(rec(stored.cache).rehearsedAt) ?? times.updatedAt;
  const { sources, idOfUrl } = sourcesOf(review, retrievedAt);
  const drafts = rec(review.drafts);
  const usage = rec(stored.usage);
  const estimate = rec(stored.estimate);
  const tune = aiPlan.intent === 'tune';
  const lastReported = num(aiPlan.lastReportedYear);
  return checked('reconfig job', ReconfigJob, {
    id: row.id,
    prompt: row.prompt,
    tenant: requestedTenant ?? (tune ? host.slug : null),
    status: STATUSES.has(row.status) ? row.status : 'failed',
    step: known ? str(stored.step) : null,
    progress: known ? Math.min(1, Math.max(0, num(stored.progress) ?? 0)) : 0,
    progressNote: known ? oneLine(str(stored.note) ?? '', '') || null : null,
    plan: planOf(aiPlan, review, host),
    sources,
    facts: factsOf(review, idOfUrl),
    drafts: (['seed', 'lever_tuning'] as const).flatMap((k) => (drafts[k] === null || drafts[k] === undefined ? [] : [draftOf(k, drafts[k])])),
    validation: violationsOf(arr(rec(review.validation).entries)),
    calibration: calibrationOf(rec(review.calibration), lastReported),
    openQuestions: questionsOf(review),
    costEstimate: known && Object.keys(estimate).length > 0 ? estimate : PENDING_ESTIMATE,
    usage: Object.keys(usage).length === 0 ? null : { inputTokens: num(usage.inputTokens) ?? 0, outputTokens: num(usage.outputTokens) ?? 0, usd: num(usage.usd) ?? 0 },
    error: errorOf(stored, row.status),
    createdBy: times.createdBy,
    createdAt: times.createdAt,
    updatedAt: times.updatedAt,
  });
}

/** True when the stored review carries an open question that blocks apply. */
export const hasBlockingQuestion = (plan: unknown): boolean =>
  arr(rec(rec(plan).review).openQuestions).some((q) => rec(q).blocking === true);

/** The drafts a stored review holds (`seed`, `lever_tuning`), and the plan's intent. */
export function reviewOf(plan: unknown): { drafts: readonly string[]; intent: string | null; hasReview: boolean } {
  const review = rec(rec(plan).review);
  const drafts = rec(review.drafts);
  return {
    hasReview: Object.keys(review).length > 0,
    intent: str(rec(review.plan).intent),
    drafts: (['seed', 'lever_tuning'] as const).filter((k) => drafts[k] !== null && drafts[k] !== undefined),
  };
}

/** The estimate the worker stored, once it has (`format: 1`). */
export const hasWorkerState = (plan: unknown): boolean => rec(plan).format === 1;

/** The cache marker of an imported rehearsal, with the plan it shows. */
export function cacheOf(plan: unknown): { rehearsedAt: string | null; name: string | null; iata: string | null; tenant: string | null } | null {
  const stored = rec(plan);
  const cache = stored.cache;
  if (cache === null || cache === undefined || typeof cache !== 'object') return null;
  const ai = rec(rec(stored.review).plan);
  const tenant = rec(ai.tenant);
  return { rehearsedAt: str(rec(cache).rehearsedAt), name: str(tenant.name), iata: str(tenant.iataCode), tenant: str(rec(cache).rehearsedTenant) };
}
