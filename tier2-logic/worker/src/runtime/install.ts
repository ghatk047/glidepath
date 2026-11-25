import { connectionConfig } from '@glidepath/data-access';
import { PgBoss } from './boss';
import { DEFAULT_BOSS_SCHEMA } from './config';
import type { QueueSettings } from './types';
import { isQueueName } from './types';

export interface InstallQueueSchemaOptions {
  /** DATABASE_URL_MIGRATE: the owner role (it may create schemas; the app role may not). */
  readonly ownerUrl: string;
  readonly schema?: string;
  /** Queues to create now, so the app role never needs DDL rights (`solver.*`, `excel.*`, `ai.*`). */
  readonly queues?: readonly string[];
  readonly queueSettings?: QueueSettings;
  /** Role that runs the worker and the server. Default `glidepath_app` (ADR-015); skipped when it does not exist. */
  readonly appRole?: string;
}

const ident = (s: string): string => `"${s.replace(/"/g, '""')}"`;

/**
 * Installs or upgrades the pg-boss schema as the owner role, creates `queues`, and grants the app role
 * what it needs on that schema (DML on its tables, sequences, functions) so the worker can run with
 * DATABASE_URL alone and RLS-bound credentials. The schema holds job envelopes (tenant, run ids), no
 * tenant tables. Idempotent; run it from the migrate step (DATA-08) or with `worker.ts` when
 * DATABASE_URL_MIGRATE is set.
 */
export async function installQueueSchema(opts: InstallQueueSchemaOptions): Promise<void> {
  const schema = opts.schema ?? DEFAULT_BOSS_SCHEMA;
  const role = opts.appRole ?? 'glidepath_app';
  for (const q of opts.queues ?? []) {
    if (!isQueueName(q)) throw new Error(`worker: '${q}' is not a queue name (solver.*, excel.* or ai.*)`);
  }
  const boss = new PgBoss({
    ...connectionConfig(opts.ownerUrl),
    schema,
    application_name: 'glidepath-worker-install',
    max: 2,
    supervise: false,
    schedule: false,
  });
  boss.on('error', () => undefined);
  try {
    await boss.start();
    for (const q of opts.queues ?? []) {
      if (!(await boss.getQueue(q))) {
        await boss.createQueue(q, {
          retryLimit: opts.queueSettings?.retryLimit ?? 0,
          ...(opts.queueSettings?.expireInSeconds === undefined ? {} : { expireInSeconds: opts.queueSettings.expireInSeconds }),
        });
      }
    }
    const db = boss.getDb();
    const exists = await db.executeSql('select 1 from pg_roles where rolname = $1', [role]);
    if (exists.rows.length > 0) {
      const s = ident(schema);
      const r = ident(role);
      for (const stmt of [
        `grant usage on schema ${s} to ${r}`,
        `grant select, insert, update, delete on all tables in schema ${s} to ${r}`,
        `grant usage, select on all sequences in schema ${s} to ${r}`,
        `grant execute on all functions in schema ${s} to ${r}`,
        `alter default privileges in schema ${s} grant select, insert, update, delete on tables to ${r}`,
        `alter default privileges in schema ${s} grant usage, select on sequences to ${r}`,
        `alter default privileges in schema ${s} grant execute on functions to ${r}`,
      ]) {
        await db.executeSql(stmt);
      }
    }
  } finally {
    await boss.stop({ graceful: true, close: true }).catch(() => undefined);
  }
}
