import { PROBLEM_CONTENT_TYPE, Problem, UserId, assertContract, problemTypes } from '@glidepath/api-contract';
import type { ApiRouteId, DimKey, MembersResponse } from '@glidepath/api-contract';
import { membersHash } from '@glidepath/spec';
import { aaSeed, specBundle } from '@glidepath/testkit';
import type { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../app/app';
import type { AppEnv } from '../../app/tenant';
import { captureLogger } from '../../app/testing/fixtures';
import { specBundleFromDir } from './spec-source';
import { ANA, BOB, CAROL, CS, MINE, MV, ZZ_SCENARIO, applyStoredStep, asUser, createUserScenario, presetId, startAaDatabase } from './testing/aa-db';
import type { AaDatabase, StoredStep } from './testing/aa-db';

let env: AaDatabase;
let app: Hono<AppEnv>;

const ana = asUser(ANA);
const dimOf = (b: MembersResponse, dim: string) => b.dimensions[dim as DimKey] ?? [];
const bob = asUser(BOB);
const get = (path: string, init: { headers: Record<string, string> } = ana, extra: Record<string, string> = {}) =>
  app.request(path, { headers: { ...init.headers, ...extra } });

beforeAll(async () => {
  env = await startAaDatabase();
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

/** Route id and path of every read route of aa, for the table-driven checks. */
const routes: { id: ApiRouteId; path: (t: string, s?: string) => string }[] = [
  { id: 'bundle', path: (t) => `/api/t/${t}/bundle` },
  { id: 'members', path: (t) => `/api/t/${t}/members` },
  { id: 'scenarios', path: (t) => `/api/t/${t}/scenarios` },
  { id: 'scenarioInputs', path: (t, s) => `/api/t/${t}/scenarios/${s}/inputs` },
  { id: 'changesetHistory', path: (t, s) => `/api/t/${t}/scenarios/${s}/changesets` },
];

describe('GET bundle (variables, nodes, dims of the pinned model_version) with ETag / 304', () => {
  it('answers the contract with the pinned model version, spec-ordered lists and an ETag', async () => {
    const res = await get('/api/t/aa/bundle');
    const body = await assertContract('bundle', res);
    const spec = await specBundle();
    expect(res.headers.get('etag')).toMatch(/^"[0-9a-f]{64}"$/);
    expect(body.modelVersion).toEqual({ id: MV, semver: spec.specVersion });
    expect(body.variables.map((v) => v.id)).toEqual(spec.variables.map((v) => v.id));
    expect(body.nodes.map((n) => n.id)).toEqual(spec.nodes.map((n) => n.id));
    expect(body.dimensions.map((d) => d.id)).toEqual(spec.dimensions.map((d) => d.id));
  });

  it('takes the fields the tables lack from the spec bundle and the rest from the database', async () => {
    const body = await assertContract('bundle', await get('/api/t/aa/bundle'));
    const spec = await specBundle();
    for (const s of spec.variables) {
      const v = body.variables.find((x) => x.id === s.id);
      expect(v, s.id).toBeDefined();
      expect([v?.kind, v?.scenarioVaries, v?.confidence, v?.source, v?.note]).toEqual([
        s.kind, s.scenario_varies, s.confidence, s.source ?? '', s.note ?? '',
      ]);
      expect([v?.label, v?.unit, v?.type, v?.dims, v?.min, v?.max, v?.step, v?.group, v?.layer, v?.role, v?.ui]).toEqual([
        s.label, s.unit, s.type, s.dims, s.min, s.max, s.step, s.group ?? '', s.layer, s.role, s.ui,
      ]);
    }
    for (const s of spec.dimensions) {
      expect(body.dimensions.find((d) => d.id === s.id)).toEqual({ id: s.id, label: s.label, scope: s.scope, attributes: [...s.attributes] });
    }
  });

  it('carries no formula: nodes expose label, unit, dims, layer, output, overridable, percentScale only', async () => {
    const text = await (await get('/api/t/aa/bundle')).text();
    const body = JSON.parse(text) as { nodes: Record<string, unknown>[] };
    for (const n of body.nodes) {
      expect(Object.keys(n).sort()).toEqual([
        'dims',
        'id',
        'label',
        'layer',
        'output',
        'overridable',
        'percentScale',
        'unit',
      ]);
    }
    expect(text).not.toContain('"expr"');
    expect(text).not.toContain('"cases"');
  });

  it('answers 304 with no body when If-None-Match carries the ETag, and 200 for a stale one', async () => {
    const first = await get('/api/t/aa/bundle');
    const etag = first.headers.get('etag') as string;
    expect(etag).toBeTruthy();
    for (const header of [etag, `W/${etag}`, `"stale", ${etag}`, '*']) {
      const res = await get('/api/t/aa/bundle', ana, { 'if-none-match': header });
      expect(res.status, header).toBe(304);
      expect(res.headers.get('etag')).toBe(etag);
      expect(await res.text()).toBe('');
    }
    const stale = await get('/api/t/aa/bundle', ana, { 'if-none-match': '"stale"' });
    expect(stale.status).toBe(200);
    expect(stale.headers.get('etag')).toBe(etag);
    await assertContract('bundle', stale);
  });

  it('the ETag is the same on every request and the same for every tenant of the model version', async () => {
    const a = (await get('/api/t/aa/bundle')).headers.get('etag');
    const b = (await get('/api/t/aa/bundle')).headers.get('etag');
    const z = (await get('/api/t/zz/bundle', bob)).headers.get('etag');
    expect(a).toBe(b);
    expect(z).toBe(a);
  });

  it('a pinned model version the server holds no spec bundle for answers a generic 500 problem', async () => {
    const { logger } = captureLogger();
    const noSpec = createApp({
      logger, db: env.app, authenticate: () => UserId.parse(ANA), membership: env.membership, specBundle: () => Promise.resolve(null),
    });
    const res = await noSpec.request('/api/t/aa/bundle');
    expect(res.status).toBe(500);
    const p = await assertContract('bundle', res, 500);
    expect(p.detail).not.toContain(MV);
  });
});

describe('GET members with members_hash', () => {
  it('answers the contract: every member of the pinned model dimensions in spec order, with the hash', async () => {
    const body = await assertContract('members', await get('/api/t/aa/members'));
    const seed = await aaSeed();
    expect(body.membersHash).toMatch(/^[0-9a-f]{64}$/);
    expect(dimOf(body, 'line')).toHaveLength(seed.dimensionMembers.line?.length ?? -1);
    expect(dimOf(body, 'pool').map((m) => m.key)).toEqual(seed.dimensionMembers.pool?.map((m) => m.id));
    expect(dimOf(body, 'vp').map((m) => m.key)).toEqual(seed.dimensionMembers.vp?.map((m) => m.id));
    expect(dimOf(body, 'lever')[0]).toMatchObject({ key: 'L01', label: expect.any(String), sort: 1, active: true });
    expect(dimOf(body, 'pool')[0]?.attrs).toEqual({ third_party: 0, order: 1 });
    // global and system dimensions the tenant does not store are served too
    expect(dimOf(body, 'year').map((m) => m.key)).toEqual(['fy25', 'fy26', 'fy27b', 'fy27it']);
  });

  it('members_hash is the spec hash of the active members as the engine takes them', async () => {
    const body = await assertContract('members', await get('/api/t/aa/members'));
    const asEngine = Object.fromEntries(
      Object.entries(body.dimensions).map(([dim, ms]) => [
        dim,
        ms.filter((m) => m.active).map((m) => ({ ...m.attrs, id: m.key, label: m.label })),
      ]),
    );
    expect(body.membersHash).toBe(membersHash(asEngine as never));
    expect((await assertContract('members', await get('/api/t/aa/members'))).membersHash).toBe(body.membersHash);
  });

  it('another tenant gets its own members and hash (RLS), never aa lines', async () => {
    const z = await assertContract('members', await get('/api/t/zz/members', bob));
    const a = await assertContract('members', await get('/api/t/aa/members'));
    expect(dimOf(z, 'vp').map((m) => m.key)).toEqual(['vp_zz']);
    expect(dimOf(z, 'line')).toEqual([]);
    expect(z.membersHash).not.toBe(a.membersHash);
  });
});

describe('GET scenarios (kind, parent, version, locked)', () => {
  it('lists every scenario of the tenant with kind, parent, version, locked and the edits counter', async () => {
    const { scenarios } = await assertContract('scenarios', await get('/api/t/aa/scenarios'));
    const seed = await aaSeed();
    expect(scenarios.map((s) => s.key)).toEqual([...seed.scenarios.scenarios.map((s) => s.id), 'custom-c']);
    const c = scenarios.find((s) => s.key === 'C');
    expect(c).toMatchObject({ id: presetId('C'), kind: 'preset', parentId: null, version: 0, locked: true, archived: false, editsCount: 0, modelVersionId: MV });
    expect(scenarios.find((s) => s.key === 'custom-c')).toMatchObject({
      id: MINE, kind: 'user', parentId: presetId('C'), version: 4, locked: false, createdBy: ANA, label: 'Custom (from C)',
    });
  });

  it('editsCount is the stored counter of the changeset at version - 1 (c4: 3; not the rejected c5 at the next base), 0 for presets', async () => {
    const { scenarios } = await assertContract('scenarios', await get('/api/t/aa/scenarios'));
    expect(scenarios.find((s) => s.id === MINE)?.editsCount).toBe(3);
    expect(scenarios.filter((s) => s.kind === 'preset').map((s) => s.editsCount)).toEqual([0, 0, 0, 0, 0]);
  });

  it('a tenant sees only its own scenarios', async () => {
    const { scenarios } = await assertContract('scenarios', await get('/api/t/zz/scenarios', bob));
    expect(scenarios.map((s) => s.id)).toEqual([ZZ_SCENARIO]);
    expect(scenarios[0]).toMatchObject({ version: 7, editsCount: 0 });
  });
});

describe('GET scenarios/:id/inputs', () => {
  it('resolves tenant default, parent and own values with provenance, and the scenario own overrides', async () => {
    const body = await assertContract('scenarioInputs', await get(`/api/t/aa/scenarios/${MINE}/inputs`));
    expect(body).toMatchObject({ scenarioId: MINE, version: 4 });
    const cell = (v: string, m = '') => body.inputs.find((i) => i.var === v && i.member === m);
    // own value
    expect(cell('g.target_net')).toMatchObject({ value: 120, from: 'scenario', fromScenarioId: MINE, confidence: null });
    // inherited from preset C
    const seed = await aaSeed();
    const c = seed.scenarios.scenarios.find((s) => s.id === 'C');
    const inherited = Object.entries(c?.values ?? {}).find(([k, v]) => typeof v === 'number' && k !== 'g.target_net');
    expect(inherited).toBeDefined();
    expect(cell(inherited?.[0] as string)).toMatchObject({ value: inherited?.[1], from: 'parent', fromScenarioId: presetId('C') });
    // tenant default none of the presets sets
    const defaults = Object.keys(seed.variableValues).find((k) => !(k in (c?.values ?? {})));
    expect(cell(defaults as string)).toMatchObject({ from: 'tenant', fromScenarioId: null, confidence: expect.stringMatching(/^[HML]$/) });
    expect(body.overrides).toEqual([{ node: expect.any(String), member: '', value: 99.5, reason: 'CFO pin' }]);
  });

  it('a preset resolves itself and has no overrides', async () => {
    const body = await assertContract('scenarioInputs', await get(`/api/t/aa/scenarios/${presetId('rates')}/inputs`));
    expect(body.version).toBe(0);
    expect(body.overrides).toEqual([]);
    expect(body.inputs.find((i) => i.var === 'g.target_net')).toMatchObject({ value: 100, from: 'tenant' });
    expect(body.inputs.find((i) => i.var === 'lev.L03.tc')).toMatchObject({ value: 0.055, from: 'scenario', fromScenarioId: presetId('rates') });
  });

  it('answers values of this tenant only (RLS): zz sees its own default 777', async () => {
    const body = await assertContract('scenarioInputs', await get(`/api/t/zz/scenarios/${ZZ_SCENARIO}/inputs`, bob));
    expect(body.inputs).toEqual([
      { var: 'g.target_net', member: '', value: 777, from: 'tenant', fromScenarioId: null, confidence: 'L', note: 'zz only' },
    ]);
  });

  it('unknown, other-tenant and malformed scenario ids are 404 problems', async () => {
    for (const id of ['00000000-0000-4000-8000-0000000000ff', ZZ_SCENARIO, 'not-a-uuid', "x'; drop table scenario;--"]) {
      const res = await get(`/api/t/aa/scenarios/${encodeURIComponent(id)}/inputs`);
      expect(res.status, id).toBe(404);
      expect((await assertContract('scenarioInputs', res, 404)).type).toBe(problemTypes.notFound);
    }
  });
});

describe('GET scenarios/:id/changesets', () => {
  const path = (q = '') => `/api/t/aa/scenarios/${MINE}/changesets${q}`;

  it('lists the history newest first with changes in seq order, author names and the API vocabulary', async () => {
    const body = await assertContract('changesetHistory', await get(path()));
    expect(body.scenarioId).toBe(MINE);
    expect(body.nextCursor).toBeNull();
    expect(body.changesets.map((c) => c.id)).toEqual([CS.c5, CS.c4, CS.c3, CS.c2, CS.c1]);
    const [c5, c4, c3, c2, c1] = body.changesets;
    expect(c5).toMatchObject({ status: 'rejected', baseVersion: 4, editsCount: 1, createdByName: 'Ana', revertsId: null, summary: null });
    expect(c4?.changes).toEqual([
      { seq: 0, target: 'structural', key: 'vp', member: 'vp_commercial', op: 'update', oldValue: { label: 'Commercial Technology' }, newValue: { label: 'Commercial Tech' } },
    ]);
    expect(c3).toMatchObject({ revertsId: CS.c2, createdBy: CAROL, createdByName: 'Carol', summary: 'Undo: import' });
    expect(c2).toMatchObject({ status: 'reverted', origin: 'excel_import' });
    expect(c1?.editsCount).toBe(2);
    expect(c1?.changes.map((c) => [c.seq, c.target])).toEqual([[0, 'variable'], [1, 'override']]);
    expect(c1?.changes[0]).toMatchObject({ key: 'g.target_net', member: '', oldValue: 100, newValue: 120 });
  });

  it('pages with a keyset cursor and limit, then ends with nextCursor null', async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const q: string = `?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const body = await assertContract('changesetHistory', await get(path(q)));
      expect(body.changesets.length).toBeLessThanOrEqual(2);
      seen.push(...body.changesets.map((c) => c.id));
      cursor = body.nextCursor;
      pages += 1;
    } while (cursor !== null && pages < 10);
    expect(pages).toBe(3);
    expect(seen).toEqual([CS.c5, CS.c4, CS.c3, CS.c2, CS.c1]);
  });

  it('a malformed cursor is a 400 problem, an invalid limit a 422 problem', async () => {
    const bad = await get(path('?cursor=nonsense'));
    expect(bad.status).toBe(400);
    expect((await assertContract('changesetHistory', bad, 400)).type).toBe(problemTypes.badRequest);
    for (const q of ['?limit=0', '?limit=abc', '?limit=-3']) {
      const res = await get(path(q));
      expect(res.status, q).toBe(422);
      await assertContract('changesetHistory', res, 422);
    }
  });

  it('a scenario without history is an empty list; a scenario of another tenant is 404', async () => {
    const empty = await assertContract('changesetHistory', await get(`/api/t/aa/scenarios/${presetId('A')}/changesets`));
    expect(empty).toEqual({ scenarioId: presetId('A'), changesets: [], nextCursor: null });
    const other = await get(`/api/t/aa/scenarios/${ZZ_SCENARIO}/changesets`);
    expect(other.status).toBe(404);
    await assertContract('changesetHistory', other, 404);
  });
});

describe('path tenant not in memberships: 404 problem', () => {
  it('is 404 on every read route for a user who is not a member, and for a tenant that does not exist', async () => {
    const cases: [string, { headers: Record<string, string> }][] = [
      ['aa', bob], // bob belongs to zz only
      ['zz', ana], // ana belongs to aa only
      ['nope', ana],
      ['aa', asUser(CAROL)], // member of nothing
    ];
    for (const r of routes) {
      for (const [tenant, who] of cases) {
        const res = await get(r.path(tenant, MINE), who);
        expect(res.status, `${r.id} ${tenant}`).toBe(404);
        expect(res.headers.get('content-type')).toContain(PROBLEM_CONTENT_TYPE);
        const p = await assertContract(r.id, res, 404);
        expect(Problem.parse(p).type).toBe(problemTypes.notFound);
        // the answer is the same for a tenant that exists and one that does not: nothing is revealed
        expect(p.detail).toBe('No such tenant, or you are not a member of it.');
      }
    }
  });

  it('is 401 without a session, and a tenant slug is case-sensitive', async () => {
    const res = await app.request('/api/t/aa/bundle');
    expect(res.status).toBe(401);
    await assertContract('bundle', res, 401);
    expect((await get('/api/t/Aa/bundle')).status).toBe(404);
  });
});

describe('every response passes assertContract', () => {
  it.each(routes.map((r) => [r.id, r] as const))('%s answers its route schema for both tenants', async (_id, r) => {
    await assertContract(r.id, await get(r.path('aa', MINE)));
    await assertContract(r.id, await get(r.path('zz', ZZ_SCENARIO), bob));
  });

  it('serves JSON with a private, revalidated cache policy and no cookies', async () => {
    for (const r of routes) {
      const res = await get(r.path('aa', MINE));
      expect(res.headers.get('content-type')).toMatch(/^application\/json/);
      expect(res.headers.get('cache-control')).toBe('private, no-cache');
      expect(res.headers.get('set-cookie')).toBeNull();
    }
  });
});

describe('SQL stays parameterised through the routes', () => {
  it('a scenario id with SQL in it does not reach the database as text (404, tables intact)', async () => {
    const res = await get(`/api/t/aa/scenarios/${encodeURIComponent("' or 1=1 --")}/changesets`);
    expect(res.status).toBe(404);
    const { scenarios } = await assertContract('scenarios', await get('/api/t/aa/scenarios'));
    expect(scenarios).toHaveLength(6);
  });

  it('every read runs in a transaction with app.tenant_id set (none leaks to the pool)', async () => {
    await get('/api/t/aa/scenarios');
    const r = await env.app.pool.query("select current_setting('app.tenant_id', true) as t");
    expect(r.rows[0]?.t === null || r.rows[0]?.t === '').toBe(true);
  });
});

describe('editsCount has one source: the domain counter changeset.summary.edits_count (DOM-03)', () => {
  const SEQ = '00000000-0000-4000-8000-000000000553';
  const editsOf = async (): Promise<number | undefined> =>
    (await assertContract('scenarios', await get('/api/t/aa/scenarios'))).scenarios.find((s) => s.id === SEQ)?.editsCount;

  // The sequence of the domain's counter test (apply.test.ts): edit 1, edit 2, undo it, redo it. `returned` is the
  // `editsCount` applyChangeset gave for each step; the API must report the same number after each of them.
  const steps: { step: StoredStep; returned: number }[] = [
    { step: { base: 0, changes: 1, edits: 1, editsCount: 1 }, returned: 1 },
    { step: { base: 1, changes: 2, edits: 2, editsCount: 3 }, returned: 3 },
    { step: { base: 2, changes: 2, edits: -2, editsCount: 1, reverts: 2 }, returned: 1 }, // undo of step 2
    { step: { base: 3, changes: 2, edits: 2, editsCount: 3, reverts: 3 }, returned: 3 }, // redo: undo of the undo
  ];

  it('equals what applyChangeset returned after edits, an undo and a redo; the history keeps its own per-changeset change-row count', async () => {
    await createUserScenario(env.database, SEQ, 'seq');
    expect(await editsOf()).toBe(0);
    for (const [i, { step, returned }] of steps.entries()) {
      await applyStoredStep(env.database, SEQ, i + 1, step);
      expect(await editsOf(), `after step ${i + 1}`).toBe(returned);
    }
    const history = await assertContract('changesetHistory', await get(`/api/t/aa/scenarios/${SEQ}/changesets`));
    expect(history.changesets.map((c) => c.editsCount)).toEqual([2, 2, 2, 1]);
  });

  it('is not recounted from change rows: the stored counter is what the API reports', async () => {
    await applyStoredStep(env.database, SEQ, 5, { base: 4, changes: 1, edits: 0, editsCount: 3 }); // e.g. a write that counts none
    expect(await editsOf()).toBe(3);
  });
});
