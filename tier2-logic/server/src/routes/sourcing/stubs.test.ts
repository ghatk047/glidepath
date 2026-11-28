import { PROBLEM_CONTENT_TYPE, planRoutes, sourcingRoutes } from '@glidepath/api-contract';
import type { TenantTx } from '@glidepath/data-access';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../app/app';
import { staticMemberships } from '../../app/tenant';
import type { WithTenant } from '../../app/tenant';
import { aa, aaId, ana, captureLogger, unreachableDb } from '../../app/testing/fixtures';

/**
 * SRC-05: the sourcing and plan routers mount behind auth + tenant middleware. Every route needs a session. No
 * route is a stub any more: SRC-07's GETs and the consolidation optimizer (SRC-10) are covered by
 * sourcing.pg.test.ts, the business case (SRC-17) by routes/plan/plan.pg.test.ts.
 */
const withTenant: WithTenant = (_t, _u, fn) => fn({} as TenantTx);

function app(signedIn: boolean) {
  const { logger } = captureLogger();
  return createApp({
    logger,
    db: unreachableDb(),
    authenticate: () => (signedIn ? ana : null),
    membership: staticMemberships([{ userId: ana, tenantId: aaId, slug: aa, role: 'owner' }]),
    withTenant,
  });
}

const routes = [...Object.values(sourcingRoutes), ...Object.values(planRoutes)];
const urlOf = (path: string) => `http://localhost${path.replace(':tenant', aa)}?scenario=sc-1`;
const request = (method: string, path: string) =>
  new Request(urlOf(path), {
    method,
    headers: { 'content-type': 'application/json' },
    ...(method === 'POST' ? { body: JSON.stringify({ scenarioId: 'sc-1' }) } : {}),
  });

describe('SRC-05 sourcing and plan routers', () => {
  it.each(routes.map((r) => [r.method, r.path] as const))('%s %s: unauthenticated -> 401', async (method, path) => {
    const res = await app(false).fetch(request(method, path));
    expect(res.status).toBe(401);
    expect(res.headers.get('content-type')).toContain(PROBLEM_CONTENT_TYPE);
  });

  it('a non-member gets 404', async () => {
    for (const path of ['/api/t/zz/sourcing/vendors', '/api/t/zz/plan/business-case']) {
      const res = await app(true).fetch(request('GET', path));
      expect(res.status).toBe(404);
    }
  });
});
