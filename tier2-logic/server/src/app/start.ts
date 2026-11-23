import { serve } from '@hono/node-server';
import type { ServerType } from '@hono/node-server';
import { createDb, dbOptionsFromEnv } from '@glidepath/data-access';
import { authFromConfig } from '../auth/auth';
import type { Mailer } from '../auth/mailer';
import { createApp } from './app';
import type { AppDeps } from './app';
import { loadConfig } from './config';
import type { Config } from './config';
import { createLogger, secretsFrom } from './logger';
import type { Logger } from './logger';

export interface RunningServer {
  config: Config;
  logger: Logger;
  /** Port actually bound (differs from `config.PORT` when that is 0). */
  port: number;
  close(): Promise<void>;
}

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
  const app = createApp({ logger, db, auth, ...deps });

  const server = await new Promise<ServerType>((resolve, reject) => {
    const s = serve({ fetch: app.fetch, port: config.PORT }, () => resolve(s));
    s.once('error', reject);
  }).catch(async (err: unknown) => {
    await auth.close();
    await db.close();
    throw err;
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : config.PORT;
  logger.info('listening', { port });

  return {
    config,
    logger,
    port,
    async close() {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        if ('closeAllConnections' in server) (server as { closeAllConnections(): void }).closeAllConnections();
      });
      await auth.close();
      await db.close();
    },
  };
}
