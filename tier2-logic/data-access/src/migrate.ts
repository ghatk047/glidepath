import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { connectionConfig, requireUrl } from './config';

/**
 * migrate(DATABASE_URL_MIGRATE): applies tier3-data/migrations in order.
 *
 * Order: the generated files `<dir>/*.sql` sorted by name, then the manual files
 * `<dir>/manual/*.sql` sorted by name (ADR-023). Each file runs once, in its own
 * transaction together with its row in the tracking table, so a failed file leaves
 * no trace and a rerun is a no-op. Applied files are checksummed: changing an
 * applied file is an error, not a silent skip.
 *
 * Runs as the owner role (`glidepath_owner`), not a superuser: plain DDL only.
 * The only locking is `pg_advisory_xact_lock` inside the migration transaction
 * (released at commit, safe with poolers; no session-level locks).
 */

export const TRACKING_TABLE = 'schema_migration';
const LOCK_KEY_SQL = `hashtext('glidepath.migrate')`;

const here = dirname(fileURLToPath(import.meta.url));
export const defaultMigrationsDir = resolve(here, '..', '..', '..', 'tier3-data', 'migrations');

export interface MigrateOptions {
  /** Migrations directory. Default: tier3-data/migrations of this repository. */
  dir?: string;
  log?: (message: string) => void;
}

export interface MigrateResult {
  applied: string[];
  skipped: string[];
}

export interface MigrationFile {
  /** Tracking id: file name, or `manual/<name>`. */
  id: string;
  path: string;
}

function sqlFiles(dir: string, prefix: string): MigrationFile[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.sql'))
    .map((e) => e.name)
    .sort()
    .map((name) => ({ id: `${prefix}${name}`, path: join(dir, name) }));
}

/** Generated migrations first, then manual ones, each sorted by name. */
export function listMigrations(dir: string = defaultMigrationsDir): MigrationFile[] {
  if (!existsSync(dir)) throw new Error(`data-access: migrations directory not found: ${dir}`);
  return [...sqlFiles(dir, ''), ...sqlFiles(join(dir, 'manual'), 'manual/')];
}

const checksum = (sql: string): string => createHash('sha256').update(sql).digest('hex');

export async function migrate(databaseUrlMigrate: string, options: MigrateOptions = {}): Promise<MigrateResult> {
  const url = requireUrl('DATABASE_URL_MIGRATE', databaseUrlMigrate);
  const log = options.log ?? (() => undefined);
  const files = listMigrations(options.dir);
  const client = new pg.Client(connectionConfig(url));
  client.on('error', () => undefined);
  await client.connect();
  const result: MigrateResult = { applied: [], skipped: [] };
  try {
    await client.query('BEGIN');
    await client.query(`SELECT pg_advisory_xact_lock(${LOCK_KEY_SQL})`);
    await client.query(
      `CREATE TABLE IF NOT EXISTS ${TRACKING_TABLE} (
         id text PRIMARY KEY,
         checksum text NOT NULL,
         applied_at timestamptz NOT NULL DEFAULT now()
       )`,
    );
    await client.query('COMMIT');

    for (const f of files) {
      const sql = readFileSync(f.path, 'utf8');
      const sum = checksum(sql);
      try {
        await client.query('BEGIN');
        // Serialises concurrent migrators; the lock is released at COMMIT/ROLLBACK.
        await client.query(`SELECT pg_advisory_xact_lock(${LOCK_KEY_SQL})`);
        const done = await client.query<{ checksum: string }>(`SELECT checksum FROM ${TRACKING_TABLE} WHERE id = $1`, [f.id]);
        const row = done.rows[0];
        if (row) {
          if (row.checksum !== sum) {
            throw new Error(`already applied but the file has changed (checksum mismatch); write a new migration instead`);
          }
          await client.query('COMMIT');
          result.skipped.push(f.id);
          continue;
        }
        await client.query(sql);
        await client.query(`INSERT INTO ${TRACKING_TABLE} (id, checksum) VALUES ($1, $2)`, [f.id, sum]);
        await client.query('COMMIT');
        result.applied.push(f.id);
        log(`migrate: applied ${f.id}`);
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`data-access: migration ${f.id} failed: ${msg}`, { cause: err });
      }
    }
  } finally {
    await client.end();
  }
  return result;
}
