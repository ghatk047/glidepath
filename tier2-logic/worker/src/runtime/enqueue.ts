import type { PgBoss } from './boss';
import { parsePayload } from './run-job';
import type { JobPayload } from './types';

/**
 * Enqueues a job on `queue` (`solver.*`, `excel.*`, `ai.*`) after checking that its data carries what the
 * runtime needs (tenantId, userId, runId for solver queues). Returns the pg-boss job id, or null when
 * pg-boss dropped it (singleton rules).
 */
export async function enqueueJob(boss: PgBoss, queue: string, payload: JobPayload): Promise<string | null> {
  parsePayload(queue, payload);
  return boss.send(queue, payload);
}
