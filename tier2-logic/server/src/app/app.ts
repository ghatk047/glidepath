import { randomUUID } from 'node:crypto';
import type { DbHandle } from '@glidepath/data-access';
import { Hono } from 'hono';
import { requestSecrets } from './logger';
import type { Logger } from './logger';
import { errorHandler, notFoundHandler, problemResponse } from './problem';
import { bindWithTenant, noAuthentication, noMemberships, tenantMiddleware } from './tenant';
import type { AppEnv, Authenticator, MembershipResolver, WithTenant } from './tenant';

export const HEALTH_TIMEOUT_MS = 2_000;

export interface AppDeps {
  logger: Logger;
  /** Database handle from `createDb(DATABASE_URL)`. */
  db: DbHandle;
  /** Caller identity; default: nobody (API-02 supplies cookie sessions). */
  authenticate?: Authenticator;
  /** Membership lookup; default: stub with no memberships (DATA-05 supplies the repository). */
  membership?: MembershipResolver;
  /** Tenant-scoped transaction; default: local stand-in with the same signature as DATA-05's. */
  withTenant?: WithTenant;
  /** Health probe timeout in ms. */
  healthTimeoutMs?: number;
}

async function probeDb(db: DbHandle, timeoutMs: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const query = db.pool.query('select 1');
  query.catch(() => undefined); // a late failure after the timeout must not be unhandled
  try {
    await Promise.race([
      query,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('database did not answer in time')), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** The Hono app: request logging, `/healthz`, problem-JSON errors and the tenant-scoped `/api/t/:tenant/*` mount. */
export function createApp(deps: AppDeps): Hono<AppEnv> {
  const { logger, db } = deps;
  const app = new Hono<AppEnv>();

  app.use('*', async (c, next) => {
    const requestId = randomUUID();
    c.set('requestId', requestId);
    // Per-request logger that also scrubs this request's cookie and authorization values.
    const log = logger.child({ requestId }, requestSecrets(c.req.raw.headers));
    c.set('log', log);
    const started = performance.now();
    await next();
    c.header('x-request-id', requestId);
    // Only method, path, status and timing: never headers, cookies or bodies.
    log.info('request', {
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      ms: Math.round(performance.now() - started),
    });
  });

  app.get('/healthz', async (c) => {
    try {
      await probeDb(db, deps.healthTimeoutMs ?? HEALTH_TIMEOUT_MS);
      return c.json({ status: 'ok' });
    } catch (err) {
      c.get('log').warn('health check failed', { err });
      return problemResponse(
        {
          status: 503,
          title: 'Service unavailable',
          detail: 'The database is not answering. Check DATABASE_URL and that Postgres is up.',
        },
        c.req.path,
      );
    }
  });

  app.use(
    '/api/t/:tenant/*',
    tenantMiddleware({
      authenticate: deps.authenticate ?? noAuthentication,
      membership: deps.membership ?? noMemberships,
      withTenant: deps.withTenant ?? bindWithTenant(db.db),
    }),
  );

  app.onError(errorHandler());
  app.notFound(notFoundHandler);
  return app;
}
