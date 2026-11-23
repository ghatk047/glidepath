import { randomUUID } from 'node:crypto';
import type { DbHandle } from '@glidepath/data-access';
import { Hono } from 'hono';
import type { Auth } from '../auth/auth';
import { tenantWriteGuard } from '../auth/guard';
import { dbMemberships } from '../auth/memberships';
import { requestSecrets } from './logger';
import type { Logger } from './logger';
import { registerExcelRoutes } from '../routes/excel';
import type { ExcelRoutesDeps } from '../routes/excel';
import { registerExplainRoutes } from '../routes/explain';
import { registerReadRoutes } from '../routes/read';
import { afterCommitMiddleware, registerWriteRoutes } from '../routes/write';
import type { SessionHub as CommitNotifier } from '../routes/write';
import { specBundleFromDir } from '../routes/read/spec-source';
import type { SpecBundleSource } from '../routes/read/spec-source';
import type { SessionHub } from '../session/hub';
import { errorHandler, notFoundHandler, problemResponse } from './problem';
import { bindWithTenant, noAuthentication, tenantMiddleware } from './tenant';
import type { AppEnv, Authenticator, MembershipResolver, WithTenant } from './tenant';

export const HEALTH_TIMEOUT_MS = 2_000;

export interface AppDeps {
  logger: Logger;
  /** Database handle from `createDb(DATABASE_URL)`. */
  db: DbHandle;
  /**
   * Sign-in, cookie sessions, same-origin + CSRF guard, `/api/me`, `/api/tenants` (API-02, `authFromConfig`).
   * Absent (some tests): no auth routes, and nobody is authenticated unless `authenticate` says so.
   */
  auth?: Auth;
  /** Caller identity; default: the cookie session of `auth`, else nobody. Tests may substitute their own. */
  authenticate?: Authenticator;
  /** Membership lookup; default: tenant_membership through DATA-05 `withUser` + `findMyMembership`. */
  membership?: MembershipResolver;
  /** Tenant-scoped transaction; default: local stand-in with the same signature as DATA-05's. */
  withTenant?: WithTenant;
  /** Spec bundle of a model version (bundle route); default: `SPEC_DIR`, else the repository's `docs/spec`. */
  specBundle?: SpecBundleSource;
  /** Told after each committed write; default: `sessions` (the WS session hub, API-07), else nobody. */
  hub?: CommitNotifier;
  /** Excel and file routes (API-10): the job runner and object store; absent = the routes are not mounted. */
  excel?: ExcelRoutesDeps;
  /** Health probe timeout in ms. */
  healthTimeoutMs?: number;
  /** What-if sessions (API-06): mounts the `GET /ws/session` handshake; `listen` wires the upgrades. */
  sessions?: SessionHub;
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

/**
 * The Hono app: request logging, `/healthz`, problem-JSON errors, auth (guard on `/api/*`, auth routes),
 * the tenant-scoped `/api/t/:tenant/*` mount and its role guard (state-changing requests need owner or editor).
 */
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

  if (deps.auth) {
    // Before every /api route: state-changing requests must be same-origin and carry the session's CSRF token.
    app.use('/api/*', deps.auth.guard);
    app.route('/', deps.auth.routes);
  }

  // Outside the tenant transaction: write routes queue hub notices that run once it has committed.
  app.use('/api/t/:tenant/*', afterCommitMiddleware());
  // WS /ws/session: the upgrade handshake (cookie, origin, membership, scenario) before any socket opens.
  deps.sessions?.route(app);

  app.use(
    '/api/t/:tenant/*',
    tenantMiddleware({
      authenticate: deps.authenticate ?? deps.auth?.authenticate ?? noAuthentication,
      membership: deps.membership ?? deps.auth?.membership ?? dbMemberships(db.db),
      withTenant: deps.withTenant ?? bindWithTenant(db.db),
    }),
  );
  // Viewers (and advisors) are read-only: every state-changing tenant route needs owner or editor.
  app.use('/api/t/:tenant/*', tenantWriteGuard());

  const specBundle = deps.specBundle ?? specBundleFromDir();
  registerReadRoutes(app, { specBundle });
  // Committed writes reach the open sessions (API-07): the session hub, unless a test hands its own.
  const hub = deps.hub ?? deps.sessions;
  registerWriteRoutes(app, { specBundle, ...(hub ? { hub } : {}) });
  registerExplainRoutes(app, { specBundle });
  if (deps.excel) registerExcelRoutes(app, deps.excel);

  app.onError(errorHandler());
  app.notFound(notFoundHandler);
  return app;
}
