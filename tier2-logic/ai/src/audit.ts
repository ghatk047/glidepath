/**
 * AuditSink port (06 §2: every model response and source list is stored under `ai/<job-id>/`).
 *
 * Shaped like `ObjectStore.put` in data-access (ADR-025) so the worker can pass a tenant-bound object
 * store straight in; this package cannot import data-access (02 §1), hence its own port.
 */
export const AUDIT_BUCKET = 'ai';
export type AuditBucket = typeof AUDIT_BUCKET;

export interface AuditSink {
  put(
    bucket: AuditBucket,
    key: string,
    body: Uint8Array,
    options: { contentType: string },
  ): Promise<unknown>;
}

const JOB_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const STEP_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function assertJobId(jobId: string): void {
  if (!JOB_ID.test(jobId))
    throw new Error('job id must be 1..128 of [A-Za-z0-9._-], starting alphanumeric');
}

export function assertStepId(stepId: string): void {
  if (!STEP_ID.test(stepId))
    throw new Error(`step id must be a lowercase slug: ${JSON.stringify(stepId)}`);
}

/** Audit key within the bucket: `<job-id>/<seq>-<step>-<part>.json`; seq keeps list() order = call order. */
export function auditKey(jobId: string, seq: number, stepId: string, part: string): string {
  return `${jobId}/${String(seq).padStart(3, '0')}-${stepId}-${part}.json`;
}

/** Full path as the architecture names it: `ai/<job-id>/...`. */
export const auditPath = (key: string): string => `${AUDIT_BUCKET}/${key}`;

const encoder = new TextEncoder();

export async function writeAudit(sink: AuditSink, key: string, record: unknown): Promise<string> {
  await sink.put(AUDIT_BUCKET, key, encoder.encode(JSON.stringify(record, null, 2)), {
    contentType: 'application/json',
  });
  return auditPath(key);
}

/** In-memory sink for tests and the rehearse CLI. */
export class MemoryAuditSink implements AuditSink {
  readonly objects = new Map<string, { contentType: string; body: Uint8Array }>();

  async put(
    bucket: AuditBucket,
    key: string,
    body: Uint8Array,
    options: { contentType: string },
  ): Promise<void> {
    this.objects.set(`${bucket}/${key}`, { contentType: options.contentType, body });
  }

  json(path: string): unknown {
    const o = this.objects.get(path);
    if (!o) throw new Error(`no audit object at ${path}`);
    return JSON.parse(new TextDecoder().decode(o.body));
  }

  paths(): string[] {
    return [...this.objects.keys()].sort();
  }
}
