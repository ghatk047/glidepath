import type {
  ChangesetAuthor,
  ChangesetId,
  ChangesetOrigin,
  ChangesetResult,
  Scenario,
  TenantId,
} from '@glidepath/api-contract';
import type { Context, MiddlewareHandler } from 'hono';
import type { AppEnv } from '../../app/tenant';

/**
 * What the session hub (API-07) is told after a write has committed. The hub fans it out as the WS
 * `changeset` message (and a `delta`) to every session open on the scenario. Interface only: the real
 * hub is API-07; `noSessionHub` stands in until then and in tests that do not care.
 */
export interface ChangeNotice {
  readonly tenantId: TenantId;
  /** `apply` for POST changesets, `revert` for an undo or redo. */
  readonly kind: 'apply' | 'revert';
  /** The contract result the client got: `scenarioId` is the fork when a locked preset was forked. */
  readonly result: ChangesetResult;
  readonly origin: ChangesetOrigin;
  /** The author as the toast and history show them; null when the name is unknown. */
  readonly author: ChangesetAuthor | null;
  /** The changeset an undo or redo reverted. */
  readonly reverts?: ChangesetId;
}

export interface ScenarioNotice {
  readonly tenantId: TenantId;
  readonly change: 'created' | 'updated';
  readonly scenario: Scenario;
}

export interface SessionHub {
  /** A changeset or revert committed. Never throws into the request: failures are logged. */
  changeApplied(notice: ChangeNotice): void | Promise<void>;
  /** A scenario was created, renamed, locked or archived (invalidates the scenario list). */
  scenarioChanged(notice: ScenarioNotice): void | Promise<void>;
}

export const noSessionHub: SessionHub = {
  changeApplied: () => undefined,
  scenarioChanged: () => undefined,
};

type Thunk = () => void | Promise<void>;
const pending = new WeakMap<Request, Thunk[]>();

/** Run `fn` once the request's transaction has committed (and only when the request succeeded). */
export function afterCommit(c: Context<AppEnv>, fn: Thunk): void {
  const list = pending.get(c.req.raw) ?? [];
  list.push(fn);
  pending.set(c.req.raw, list);
}

/**
 * Mount on `/api/t/:tenant/*` BEFORE the tenant middleware, so `next()` returns after `withTenant` has
 * committed: queued notifications then run in order. A request that ended in an error (rolled back)
 * notifies nobody; a hub that throws is logged and never fails the request.
 */
export function afterCommitMiddleware(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    await next();
    const list = pending.get(c.req.raw);
    pending.delete(c.req.raw);
    if (!list || c.error || c.res.status >= 400) return;
    for (const fn of list) {
      try {
        await fn();
      } catch (err) {
        c.get('log').warn('session hub notification failed', { err });
      }
    }
  };
}
