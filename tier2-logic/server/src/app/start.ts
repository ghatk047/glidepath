import { serve } from '@hono/node-server';
import type { ServerType } from '@hono/node-server';
import { createDb, dbOptionsFromEnv } from '@glidepath/data-access';
import { authFromConfig } from '../auth/auth';
import { allowedOrigin } from '../auth/guard';
import type { Mailer } from '../auth/mailer';
import { specBundleFromDir } from '../routes/read/spec-source';
import { createSessionHub, dbScenarioLoader } from '../session';
import type { SessionHub } from '../session';
import { createApp } from './app';
import type { AppDeps } from './app';
import { loadConfig } from './config';
import type { Config } from './config';
import { createLogger, secretsFrom } from './logger';
import type { Logger } from './logger';
import { bindWithTenant } from './tenant';

export interface RunningServer {
  config: Config;
  logger: Logger;
  /** Port actually bound (differs from `config.PORT` when that is 0). */
  port: number;
  /** The what-if sessions open on `WS /ws/session`. */
  sessions: SessionHub;
  close(): Promise<void>;
}

const MS_PER_MIN = 60_000;

export type StartOverrides = Pick<AppDeps, 'authenticate' | 'membership' | 'withTenant'> & {
  write?: (line: string) => void;
  /** Replaces the SMTP_URL transport (tests). */
  mailer?: Mailer | null;
};

/**
 * Loads config (throws `ConfigError` naming every missing variable), opens the pool from DATABASE_URL,
 * and listens on PORT. DB tuning (`DB_POOL_MAX`, `DB_PREPARED_STATEMENTS`) is optional.
 */
export async function startServer(
  env: Record<string, string | undefined> = process.env,
  overrides: StartOverrides = {},
): Promise<RunningServer> {
  const config = loadConfig(env);
  const logger = createLogger({
    level: config.LOG_LEVEL,
    secrets: secretsFrom(config),
    base: { service: 'logic' },
    ...(overrides.write ? { write: overrides.write } : {}),
  });
  const db = createDb(config.DATABASE_URL, dbOptionsFromEnv(env));
  const { write: _write, mailer, ...deps } = overrides;
  void _write;
  const auth = authFromConfig(config, { db: db.db, ...(mailer !== undefined ? { mailer } : {}) });
  // One spec source for the bundle route and the sessions' compiled models.
  const specBundle = specBundleFromDir();
  const sessions = createSessionHub({
    logger,
    authenticate: deps.authenticate ?? auth.authenticate,
    membership: deps.membership ?? auth.membership,
    allowedOrigin: (url) => allowedOrigin(auth.settings, url),
    loader: dbScenarioLoader({ withTenant: deps.withTenant ?? bindWithTenant(db.db), specBundle }),
    idleMs: config.SESSION_IDLE_MIN * MS_PER_MIN,
  });
  // `sessions` is also the write routes' hub: committed changesets reach every open session (API-07).
  const app = createApp({ logger, db, auth, specBundle, sessions, ...deps });

  const server = await new Promise<ServerType>((resolve, reject) => {
    const s = serve({ fetch: app.fetch, port: config.PORT }, () => resolve(s));
    s.once('error', reject);
  }).catch(async (err: unknown) => {
    await sessions.close();
    await auth.close();
    await db.close();
    throw err;
  });
  sessions.listen(server, app.fetch);
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : config.PORT;
  logger.info('listening', { port });

  return {
    config,
    logger,
    port,
    sessions,
    async close() {
      await sessions.close();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        if ('closeAllConnections' in server) (server as { closeAllConnections(): void }).closeAllConnections();
      });
      await auth.close();
      await db.close();
    },
  };
}
