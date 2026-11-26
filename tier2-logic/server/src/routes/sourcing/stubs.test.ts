import { PROBLEM_CONTENT_TYPE, Problem, planRoutes, sourcingRoutes } from '@glidepath/api-contract';
import type { TenantTx } from '@glidepath/data-access';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../app/app';
import { staticMemberships } from '../../app/tenant';
import type { WithTenant } from '../../app/tenant';
import { aa, aaId, ana, captureLogger, unreachableDb } from '../../app/testing/fixtures';

/**
 * SRC-05: the sourcing and plan routers mount behind auth + tenant middleware. Every route needs a session; the
 * routes not yet built (consolidation, SRC-10; the business case, SRC-17) answer 501. SRC-07's GETs are covered by
 * sourcing.pg.test.ts.
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
const stubs = [sourcingRoutes.sourcingConsolidation, ...Object.values(planRoutes)];
const urlOf = (path: string) => `http://localhost${path.replace(':tenant', aa)}?scenario=sc-1`;
const request = (method: string, path: string) =>
  new Request(urlOf(path), {
    method,
    headers: { 'content-type': 'application/json' },
    ...(method === 'POST' ? { body: JSON.stringify({ scenarioId: 'sc-1' }) } : {}),
  });

describe('SRC-05 sourcing and plan routers (stubs)', () => {
  it.each(routes.map((r) => [r.method, r.path] as const))('%s %s: unauthenticated -> 401', async (method, path) => {
    const res = await app(false).fetch(request(method, path));
    expect(res.status).toBe(401);
    expect(res.headers.get('content-type')).toContain(PROBLEM_CONTENT_TYPE);
  });

  it.each(stubs.map((r) => [r.method, r.path] as const))('%s %s: authenticated member -> 501 problem', async (method, path) => {
    const res = await app(true).fetch(request(method, path));
    expect(res.status).toBe(501);
    expect(res.headers.get('content-type')).toContain(PROBLEM_CONTENT_TYPE);
    const problem = Problem.parse(await res.json());
    expect(problem.detail).toMatch(/lands with SRC-(10|17)/);
  });

  it('a non-member gets 404, not the stub', async () => {
    const res = await app(true).fetch(request('GET', '/api/t/zz/sourcing/vendors'));
    expect(res.status).toBe(404);
  });
});
