import { BusinessCase, PROBLEM_CONTENT_TYPE, UserId, planRoutes } from '@glidepath/api-contract';
import type { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../app/app';
import type { AppEnv } from '../../app/tenant';
import { captureLogger } from '../../app/testing/fixtures';
import { specBundleFromDir } from '../read/spec-source';
import { AA_ID, ANA, BOB, CAROL, MINE, ZZ_SCENARIO, asUser, presetId, startAaDatabase } from '../read/testing/aa-db';
import type { AaDatabase } from '../read/testing/aa-db';
import { seedAaSourcing } from '../sourcing/testing/sourcing-seed';
import type { SourcingSeedDims } from '../sourcing/testing/sourcing-seed';

/** SRC-17 acceptance on the seeded AA tenant (pg-local, app role, RLS on). */
let env: AaDatabase;
let app: Hono<AppEnv>;
let dims: SourcingSeedDims;

const ana = asUser(ANA);
const get = (path: string, who = ana) => app.request(path, { headers: who.headers });
const path = (scenario?: string, tenant = 'aa') =>
  `${planRoutes.planBusinessCase.path.replace(':tenant', tenant)}${scenario === undefined ? '' : `?scenario=${scenario}`}`;
const C = () => presetId('C');
const param = (k: string) => Number(dims.sourcing_param.find((m) => m.id === k)!.value);

async function body(res: Response): Promise<BusinessCase> {
  expect(res.status, await res.clone().text()).toBe(200);
  return BusinessCase.parse(await res.json());
}

/** A structural change on a `sourcing_param` member through POST /changesets (applyChangeset). */
async function editParam(key: string, patch: Record<string, unknown>, active = true): Promise<Response> {
  const scenarios = (await (await get('/api/t/aa/scenarios')).json()) as { scenarios: { id: string; version: number }[] };
  const mine = scenarios.scenarios.find((s) => s.id === MINE)!;
  const i = dims.sourcing_param.findIndex((m) => m.id === key);
  const { label, ...rest } = dims.sourcing_param[i]!;
  const attrs = Object.fromEntries(Object.entries(rest).filter(([k]) => k !== 'id'));
  return app.request('/api/t/aa/changesets', {
    method: 'POST',
    headers: { ...ana.headers, 'content-type': 'application/json' },
    body: JSON.stringify({
      scenarioId: MINE,
      baseVersion: mine.version,
      changes: [{ target: 'structural', key: 'sourcing_param', member: key, value: { label, attrs: { ...attrs, ...patch }, sort: i + 1, active } }],
    }),
  });
}

beforeAll(async () => {
  env = await startAaDatabase();
  dims = await seedAaSourcing(env.database.url, AA_ID, ANA);
  const { logger } = captureLogger();
  app = createApp({
    logger,
    db: env.app,
    authenticate: (c) => {
      const u = c.req.header('x-test-user');
      return u ? UserId.parse(u) : null;
    },
    membership: env.membership,
    specBundle: specBundleFromDir(),
  });
}, 180_000);

afterAll(() => env?.close());

describe('SRC-17 GET plan/business-case', () => {
  it('answers the contract schema for scenario C at the business_case parameters', async () => {
    const b = await body(await get(path(C())));
    expect(b.scenarioId).toBe(C());
    expect(b.discountRate).toBe(param('discount_rate'));
    expect(b.years).toHaveLength(param('horizon_years'));
    expect(b.years[0]).toBe('fy27');
    expect(b.levers.map((l) => l.lever)).toEqual(Array.from({ length: 17 }, (_, i) => `L${String(i + 1).padStart(2, '0')}`));
    for (const l of b.levers) expect(Object.keys(l.savings)).toEqual(b.years);
    // the portfolio is the sum of the levers' cash flows
    const sum = (f: (l: (typeof b.levers)[number]) => number) => b.levers.reduce((s, l) => s + f(l), 0);
    expect(b.totals.oneTime).toBeCloseTo(sum((l) => l.oneTime), 9);
    expect(b.totals.npv).toBeCloseTo(sum((l) => l.npv), 9);
    for (const y of b.years) expect(b.totals.savings[y]).toBeCloseTo(sum((l) => l.savings[y]!), 9);
    // no one-time cost: payback 0, IRR and ROI not applicable
    expect(b.levers.find((l) => l.lever === 'L17')).toMatchObject({ oneTime: 0, paybackMonths: 0, irr: null, roi: null });
    expect(b.totals.npv).toBeGreaterThan(0);
  });

  it('prints the case', async () => {
    const b = await body(await get(path(C())));
    const pct = (x: number | null) => (x === null ? 'n/a' : `${(x * 100).toFixed(1)}%`);
    const rows = [...b.levers, { lever: 'TOTAL', ...b.totals }].map(
      (l) => `${l.lever.padEnd(6)} npv ${l.npv.toFixed(3).padStart(9)} payback ${l.paybackMonths === null ? 'never' : l.paybackMonths.toFixed(2)} irr ${pct(l.irr)} roi ${pct(l.roi)}`,
    );
    console.log(rows.join('\n'));
    expect(rows).toHaveLength(18);
  });

  it('an unknown scenario and another tenant\'s scenario are the same 404 problem', async () => {
    for (const id of ['00000000-0000-4000-8000-00000000dead', ZZ_SCENARIO]) {
      const res = await get(path(id));
      expect(res.status).toBe(404);
      expect(res.headers.get('content-type')).toContain(PROBLEM_CONTENT_TYPE);
    }
  });

  it('a missing ?scenario= is a 422 problem; a non-member gets 404; no session gets 401', async () => {
    const res = await get(path());
    expect(res.status).toBe(422);
    expect(res.headers.get('content-type')).toContain(PROBLEM_CONTENT_TYPE);
    expect((await get(path(C()), asUser(BOB))).status).toBe(404);
    expect((await get(path(C()), asUser(CAROL))).status).toBe(404);
    expect((await app.request(path(C()))).status).toBe(401);
  });

  it('a tenant without the business_case parameters gets a 422 problem that names the parameter', async () => {
    const res = await get(path(ZZ_SCENARIO, 'zz'), asUser(BOB));
    expect(res.status, await res.clone().text()).toBe(422);
    expect(res.headers.get('content-type')).toContain(PROBLEM_CONTENT_TYPE);
    expect(await res.text()).toMatch(/discount_rate/);
  });
});

describe('SRC-17 edits (last: they change the tenant\'s parameters)', () => {
  it('a discount-rate edit (structural change on the sourcing_param member) changes NPV, not payback or ROI', async () => {
    const before = await body(await get(path(C())));
    const rate = param('discount_rate') + 0.02; // within the member's [min, max]
    const res = await editParam('discount_rate', { value: rate });
    expect(res.status, await res.clone().text()).toBe(200);
    const after = await body(await get(path(C())));
    expect(after.discountRate).toBeCloseTo(rate, 12);
    // a higher rate discounts the same positive savings more
    expect(after.totals.npv).toBeLessThan(before.totals.npv);
    for (const [i, l] of after.levers.entries()) {
      const was = before.levers[i]!;
      if (l.savings[after.years[0]!]! > 0) expect(l.npv).toBeLessThan(was.npv);
      expect(l.paybackMonths).toBe(was.paybackMonths);
      expect(l.roi).toBe(was.roi);
      expect(l.irr).toBe(was.irr);
      expect(l.savings).toEqual(was.savings);
    }
  });

  it('a missing horizon (the member deactivated) is a 422 problem that names it, not a 500', async () => {
    const res = await editParam('horizon_years', {}, false);
    expect(res.status, await res.clone().text()).toBe(200);
    const b = await get(path(C()));
    expect(b.status).toBe(422);
    expect(b.headers.get('content-type')).toContain(PROBLEM_CONTENT_TYPE);
    expect(await b.text()).toMatch(/horizon_years/);
  });
});
