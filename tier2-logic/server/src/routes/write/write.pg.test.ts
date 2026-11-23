import { PROBLEM_CONTENT_TYPE, UserId, assertContract, problemTypes } from '@glidepath/api-contract';
import type { ChangesetResult, Scenario } from '@glidepath/api-contract';
import { aaSeed, specBundle } from '@glidepath/testkit';
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../app/app';
import type { AppEnv } from '../../app/tenant';
import { captureLogger } from '../../app/testing/fixtures';
import type { Auth } from '../../auth/auth';
import { specBundleFromDir } from '../read/spec-source';
import { AA_ID, ANA, BOB, MINE, MV, asUser, presetId, startAaDatabase } from '../read/testing/aa-db';
import type { AaDatabase } from '../read/testing/aa-db';
import type { ChangeNotice, ScenarioNotice, SessionHub } from './hub';

let env: AaDatabase;
let app: Hono<AppEnv>;
const notices: { changes: ChangeNotice[]; scenarios: ScenarioNotice[]; seenVersions: (number | null)[] } = {
  changes: [],
  scenarios: [],
  seenVersions: [],
};

/** The scenario's version as another connection sees it: proves the notice came after the commit. */
async function committedVersion(scenarioId: string): Promise<number | null> {
  return asTenant(async (c) => {
    const r = await c.query<{ version: number }>('select version from scenario where id = $1', [scenarioId]);
    return r.rows[0]?.version ?? null;
  });
}

/** A superuser connection with the tenant's RLS context set (the tables are FORCE RLS). */
function asTenant<T>(fn: (c: { query: <R extends object>(sql: string, args?: unknown[]) => Promise<{ rows: R[] }> }) => Promise<T>): Promise<T> {
  return env.database.withClient(async (c) => {
    await c.query('begin');
    try {
      await c.query(`select set_config('app.tenant_id', $1, true)`, [AA_ID]);
      const out = await fn(c as never);
      await c.query('commit');
      return out;
    } catch (err) {
      await c.query('rollback');
      throw err;
    }
  });
}

const fakeHub: SessionHub = {
  async changeApplied(n) {
    notices.changes.push(n);
    notices.seenVersions.push(await committedVersion(n.result.scenarioId));
  },
  scenarioChanged(n) {
    notices.scenarios.push(n);
  },
};

const ana = asUser(ANA);
const json = (headers: Record<string, string>) => ({ ...headers, 'content-type': 'application/json' });
const send = (method: string, path: string, body: unknown, who = ana) =>
  app.request(path, { method, headers: json(who.headers), body: typeof body === 'string' ? body : JSON.stringify(body) });
const post = (path: string, body: unknown, who = ana) => send('POST', path, body, who);
const get = (path: string, who = ana) => app.request(path, { headers: who.headers });

const setVar = (key: string, value: number | null, member = '') => ({ target: 'variable', key, member, value });

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
    hub: fakeHub,
  });
}, 180_000);

afterAll(() => env?.close());

/** A fresh scenario of aa: a copy of preset C (no calc_run yet, version 0 or 1). */
async function freshCopy(label?: string): Promise<Scenario> {
  const res = await post('/api/t/aa/scenarios', { mode: 'copy', from: presetId('C'), ...(label ? { label } : {}) });
  expect(res.status).toBe(201);
  return assertContract('scenarioCreate', res);
}

const applyTo = async (s: { id: string; version: number }, changes: unknown[], extra: object = {}) =>
  post('/api/t/aa/changesets', { scenarioId: s.id, baseVersion: s.version, changes, ...extra });

describe('POST changesets', () => {
  it('applies through applyChangeset and answers version, editsCount, inputHash, headline outputs and warnings', async () => {
    const s = await freshCopy();
    const res = await applyTo(s, [setVar('g.target_net', 110), setVar('g.head_start', 2)]);
    expect(res.status).toBe(200);
    const body = await assertContract('changesetApply', res);
    expect(body).toMatchObject({ scenarioId: s.id, version: s.version + 1, editsCount: 2 });
    // the seed itself holds a value past its registry max (VR04): warnings are warnings, never errors
    expect(body.warnings.every((w) => w.severity === 'warning')).toBe(true);
    expect(body.inputHash.length).toBeGreaterThan(8);
    expect(Object.keys(body.outputs).length).toBeGreaterThan(0);
    expect(Object.keys(body.outputs)).toContain('res.net[]');
    expect(body.forkedFrom).toBeUndefined();
    // written: the scenario's own values
    const inputs = await (await get(`/api/t/aa/scenarios/${s.id}/inputs`)).json() as { version: number; inputs: { var: string; value: number | null; from: string | null }[] };
    expect(inputs.version).toBe(s.version + 1);
    expect(inputs.inputs.find((i) => i.var === 'g.target_net')).toMatchObject({ value: 110, from: 'scenario' });
    // listed with the stored counter
    const list = (await (await get('/api/t/aa/scenarios')).json()) as { scenarios: Scenario[] };
    expect(list.scenarios.find((x) => x.id === s.id)).toMatchObject({ version: s.version + 1, editsCount: 2 });
  });

  it('clamps a typed value to the registry bounds (ui origin) and unset hands the cell back to inheritance', async () => {
    const s = await freshCopy();
    const r1 = await assertContract('changesetApply', await applyTo(s, [setVar('g.target_net', 5000)]));
    const inputs = async () => ((await (await get(`/api/t/aa/scenarios/${s.id}/inputs`)).json()) as { inputs: { var: string; value: number | null; from: string | null }[] }).inputs.find((i) => i.var === 'g.target_net');
    expect((await inputs())?.value).toBe(150);
    await assertContract('changesetApply', await applyTo({ id: s.id, version: r1.version }, [setVar('g.target_net', null)]));
    expect((await inputs())?.from).not.toBe('scenario');
  });

  it('409 carries the server version and the changes made since (nothing is applied)', async () => {
    const s = await freshCopy();
    const first = await assertContract('changesetApply', await applyTo(s, [setVar('g.head_start', 1)]));
    const stale = await applyTo(s, [setVar('g.target_net', 90)]); // still on the old version
    expect(stale.status).toBe(409);
    expect(stale.headers.get('content-type')).toContain(PROBLEM_CONTENT_TYPE);
    const body = await assertContract('changesetApply', stale, 409);
    expect(body).toMatchObject({ status: 409, type: problemTypes.versionConflict, serverVersion: first.version });
    expect(body.changesSince).toEqual([
      expect.objectContaining({ changesetId: first.changesetId, target: 'variable', key: 'g.head_start', member: '', op: expect.any(String), newValue: 1 }),
    ]);
    // the client re-sends on the server version and it applies
    const again = await applyTo({ id: s.id, version: body.serverVersion }, [setVar('g.target_net', 90)]);
    expect(again.status).toBe(200);
  });

  it('a retry with the same clientRequestId answers the first result and applies nothing twice', async () => {
    const s = await freshCopy();
    const key = { clientRequestId: 'retry-1' };
    const a = await assertContract('changesetApply', await applyTo(s, [setVar('g.head_start', 3)], key));
    const b = await assertContract('changesetApply', await applyTo(s, [setVar('g.head_start', 3)], key));
    expect({ ...b, warnings: [] }).toEqual({ ...a, warnings: [] });
    const list = (await (await get('/api/t/aa/scenarios')).json()) as { scenarios: Scenario[] };
    expect(list.scenarios.find((x) => x.id === s.id)?.version).toBe(a.version);
  });

  it('a rule error is a 422 problem with violations and nothing is written', async () => {
    const s = await freshCopy();
    const spec = await specBundle();
    const def = spec.variables.find((v) => v.id === 'org.dom_share');
    expect(def).toBeDefined();
    const seed = await aaSeed();
    const dom = (seed.dimensionMembers.domain ?? []).find((d) => d.id !== 'out_of_scope_memo')?.id as string;
    const vp = (seed.dimensionMembers.vp ?? [])[0]?.id as string;
    const byDim: Record<string, string> = { domain: dom, vp };
    const member = (def?.dims ?? []).map((d) => byDim[d]).join(',');
    const res = await applyTo(s, [setVar('org.dom_share', 0.123, member)]);
    expect(res.status).toBe(422);
    const p = await assertContract('changesetApply', res, 422);
    expect(p.violations?.[0]).toMatchObject({ rule: 'VR01', severity: 'error' });
    const list = (await (await get('/api/t/aa/scenarios')).json()) as { scenarios: Scenario[] };
    expect(list.scenarios.find((x) => x.id === s.id)?.version).toBe(s.version);
  });

  it('bad requests: invalid body 422, malformed JSON 400, unknown scenario 404, another tenant 404', async () => {
    expect((await post('/api/t/aa/changesets', { scenarioId: MINE, baseVersion: 0, changes: [] })).status).toBe(422);
    expect((await post('/api/t/aa/changesets', '{nope')).status).toBe(400);
    const missing = await post('/api/t/aa/changesets', { scenarioId: '00000000-0000-4000-8000-00000000dead', baseVersion: 0, changes: [setVar('g.head_start', 1)] });
    expect(missing.status).toBe(404);
    const unknownVar = await applyTo({ id: MINE, version: 4 }, [setVar('no.such_var', 1)]);
    expect(unknownVar.status).toBe(422);
    expect((await post('/api/t/aa/changesets', { scenarioId: MINE, baseVersion: 4, changes: [setVar('g.head_start', 1)] }, asUser(BOB))).status).toBe(404);
  });
});

describe('locked preset: the first edit forks', () => {
  it('returns forkedFrom and the new scenario; the preset is untouched', async () => {
    const preset = presetId('B');
    const before = ((await (await get('/api/t/aa/scenarios')).json()) as { scenarios: Scenario[] }).scenarios;
    const res = await post('/api/t/aa/changesets', { scenarioId: preset, baseVersion: 0, changes: [setVar('g.head_start', 2)] });
    expect(res.status).toBe(200);
    const body = await assertContract('changesetApply', res);
    expect(body.forkedFrom).toBe(preset);
    expect(body.scenarioId).not.toBe(preset);
    expect(body.version).toBeGreaterThan(0);
    const after = ((await (await get('/api/t/aa/scenarios')).json()) as { scenarios: Scenario[] }).scenarios;
    expect(after.length).toBe(before.length + 1);
    const fork = after.find((s) => s.id === body.scenarioId);
    expect(fork).toMatchObject({ kind: 'user', label: 'Custom (from B)', locked: false, editsCount: 1 });
    expect(after.find((s) => s.id === preset)).toMatchObject({ version: 0, locked: true });
    const note = notices.changes.at(-1);
    expect(note?.result.forkedFrom).toBe(preset);
  });
});

describe('revert (undo)', () => {
  it('undoes an applied changeset, answers the contract with reverts, and a redo is the revert of the undo', async () => {
    const s = await freshCopy();
    const edit = await assertContract('changesetApply', await applyTo(s, [setVar('g.head_start', 3)]));
    const undo = await post(`/api/t/aa/changesets/${edit.changesetId}/revert`, { baseVersion: edit.version });
    expect(undo.status).toBe(200);
    const u = await assertContract('changesetRevert', undo);
    expect(u).toMatchObject({ reverts: edit.changesetId, scenarioId: s.id, version: edit.version + 1, editsCount: 0 });
    expect(u.inputHash).toBe((await assertContract('scenarioCalc', await get(`/api/t/aa/scenarios/${s.id}/calc`))).inputHash);
    const redo = await assertContract('changesetRevert', await post(`/api/t/aa/changesets/${u.changesetId}/revert`, { baseVersion: u.version }));
    expect(redo).toMatchObject({ reverts: u.changesetId, editsCount: 1 });
  });

  it('409 on a stale baseVersion, 404 for an unknown changeset, 422 when it was already undone', async () => {
    const s = await freshCopy();
    const edit = await assertContract('changesetApply', await applyTo(s, [setVar('g.head_start', 1)]));
    const stale = await post(`/api/t/aa/changesets/${edit.changesetId}/revert`, { baseVersion: edit.version - 1 });
    expect(stale.status).toBe(409);
    const body = await assertContract('changesetRevert', stale, 409);
    expect(body.serverVersion).toBe(edit.version);
    expect(body.changesSince.length).toBeGreaterThan(0);
    expect((await post('/api/t/aa/changesets/00000000-0000-4000-8000-00000000beef/revert', { baseVersion: 1 })).status).toBe(404);
    await post(`/api/t/aa/changesets/${edit.changesetId}/revert`, { baseVersion: edit.version });
    const twice = await post(`/api/t/aa/changesets/${edit.changesetId}/revert`, { baseVersion: edit.version + 1 });
    expect(twice.status).toBe(422);
  });
});

describe('scenarios: create (copy, blend, empty child) and PATCH (rename, lock, archive)', () => {
  it('copy: same values as its source, a user scenario, unlocked, with the default label', async () => {
    const s = await freshCopy();
    expect(s).toMatchObject({ kind: 'user', locked: false, archived: false, editsCount: 0, label: expect.stringContaining('Copy of') });
    const a = ((await (await get(`/api/t/aa/scenarios/${s.id}/inputs`)).json()) as { inputs: { var: string; member: string; value: number | null }[] }).inputs;
    const c = ((await (await get(`/api/t/aa/scenarios/${presetId('C')}/inputs`)).json()) as { inputs: { var: string; member: string; value: number | null }[] }).inputs;
    expect(a.map((i) => [i.var, i.member, i.value])).toEqual(c.map((i) => [i.var, i.member, i.value]));
    const named = await freshCopy('My plan');
    expect(named.label).toBe('My plan');
  });

  it('child: an empty child that inherits from its parent', async () => {
    const res = await post('/api/t/aa/scenarios', { mode: 'child', parentId: presetId('D'), label: 'Child of D' });
    expect(res.status).toBe(201);
    const s = await assertContract('scenarioCreate', res);
    expect(s).toMatchObject({ kind: 'user', parentId: presetId('D'), label: 'Child of D', version: 0, editsCount: 0 });
    const inputs = ((await (await get(`/api/t/aa/scenarios/${s.id}/inputs`)).json()) as { inputs: { from: string | null }[] }).inputs;
    expect(inputs.some((i) => i.from === 'parent')).toBe(true);
    expect(inputs.some((i) => i.from === 'scenario')).toBe(false);
  });

  it('blend: kind blend, weights between the parts; fewer than two parts is a 422', async () => {
    const res = await post('/api/t/aa/scenarios', {
      mode: 'blend',
      parts: [{ scenarioId: presetId('A'), weight: 1 }, { scenarioId: presetId('D'), weight: 3 }],
    });
    expect(res.status).toBe(201);
    const s = await assertContract('scenarioCreate', res);
    expect(s.kind).toBe('blend');
    const one = await post('/api/t/aa/scenarios', { mode: 'blend', parts: [{ scenarioId: presetId('A'), weight: 1 }] });
    expect(one.status).toBe(422);
    const missing = await post('/api/t/aa/scenarios', { mode: 'copy', from: '00000000-0000-4000-8000-00000000dead' });
    expect(missing.status).toBe(404);
  });

  it('PATCH renames, locks and archives; a locked scenario cannot be edited; an empty patch is a 422', async () => {
    const s = await freshCopy();
    const patch = (body: unknown) => send('PATCH', `/api/t/aa/scenarios/${s.id}`, body);
    const renamed = await assertContract('scenarioPatch', await patch({ label: 'Board plan' }));
    expect(renamed.label).toBe('Board plan');
    const locked = await assertContract('scenarioPatch', await patch({ locked: true }));
    expect(locked.locked).toBe(true);
    // locked: the next edit forks instead of writing in place
    const fork = await assertContract('changesetApply', await applyTo({ id: s.id, version: locked.version }, [setVar('g.head_start', 1)]));
    expect(fork.forkedFrom).toBe(s.id);
    const unlocked = await assertContract('scenarioPatch', await patch({ locked: false, archived: true }));
    expect(unlocked).toMatchObject({ locked: false, archived: true, label: 'Board plan', version: s.version });
    const list = ((await (await get('/api/t/aa/scenarios')).json()) as { scenarios: Scenario[] }).scenarios;
    expect(list.find((x) => x.id === s.id)).toMatchObject({ archived: true });
    expect((await patch({})).status).toBe(422);
    expect((await send('PATCH', '/api/t/aa/scenarios/00000000-0000-4000-8000-00000000dead', { label: 'x' })).status).toBe(404);
  });
});

describe('GET calc', () => {
  it('answers the latest calc_run: outputs, inputHash, versions, not stale; 404 before the first calculation', async () => {
    const child = await assertContract('scenarioCreate', await post('/api/t/aa/scenarios', { mode: 'child', parentId: presetId('A') }));
    const none = await get(`/api/t/aa/scenarios/${child.id}/calc`);
    expect(none.status).toBe(404);
    await assertContract('scenarioCalc', none, 404);

    const s = await freshCopy();
    const edit = await assertContract('changesetApply', await applyTo(s, [setVar('g.target_net', 95)]));
    const res = await get(`/api/t/aa/scenarios/${s.id}/calc`);
    expect(res.status).toBe(200);
    const calc = await assertContract('scenarioCalc', res);
    expect(calc).toMatchObject({ scenarioId: s.id, scenarioVersion: edit.version, modelVersionId: MV, inputHash: edit.inputHash, stale: false });
    expect(calc.outputs).toEqual(edit.outputs);
  });

  it('is stale when the scenario moved past its calc_run', async () => {
    const s = await freshCopy();
    await assertContract('changesetApply', await applyTo(s, [setVar('g.target_net', 96)]));
    // a version bump without a recalculation (as a failed or skipped job would leave it)
    await asTenant((c) => c.query('update scenario set version = version + 1 where id = $1', [s.id]));
    const calc = await assertContract('scenarioCalc', await get(`/api/t/aa/scenarios/${s.id}/calc`));
    expect(calc.stale).toBe(true);
  });

  it('another tenant sees 404', async () => {
    expect((await get(`/api/t/aa/scenarios/${MINE}/calc`, asUser(BOB))).status).toBe(404);
    expect((await get(`/api/t/zz/scenarios/${MINE}/calc`, asUser(BOB))).status).toBe(404);
  });
});

describe('after commit the session hub is told', () => {
  it('notifies once per committed write, after the commit, and never for a rolled-back or conflicting one', async () => {
    notices.changes.length = 0;
    notices.seenVersions.length = 0;
    notices.scenarios.length = 0;
    const s = await freshCopy();
    expect(notices.scenarios.map((n) => n.change)).toEqual(['created']);
    expect(notices.scenarios[0]?.scenario.id).toBe(s.id);

    const ok = (await assertContract('changesetApply', await applyTo(s, [setVar('g.head_start', 2)]))) as ChangesetResult;
    expect(notices.changes).toHaveLength(1);
    expect(notices.changes[0]).toMatchObject({ kind: 'apply', origin: 'ui', author: { id: ANA, name: 'Ana' }, result: ok });
    expect(notices.seenVersions[0]).toBe(ok.version);

    await applyTo(s, [setVar('g.head_start', 1)]); // 409
    await applyTo({ id: s.id, version: ok.version }, [setVar('no.such_var', 1)]); // 422
    expect(notices.changes).toHaveLength(1);

    const undo = await assertContract('changesetRevert', await post(`/api/t/aa/changesets/${ok.changesetId}/revert`, { baseVersion: ok.version }));
    expect(notices.changes).toHaveLength(2);
    expect(notices.changes[1]).toMatchObject({ kind: 'revert', reverts: ok.changesetId, result: undo });

    await send('PATCH', `/api/t/aa/scenarios/${s.id}`, { label: 'Renamed' });
    expect(notices.scenarios.map((n) => n.change)).toEqual(['created', 'updated']);
    await send('PATCH', `/api/t/aa/scenarios/${s.id}`, { label: 'Renamed' }); // no change, no notice
    expect(notices.scenarios).toHaveLength(2);
  });

  it('a hub that throws never fails the request', async () => {
    const { logger, lines } = captureLogger();
    const angry = createApp({
      logger,
      db: env.app,
      authenticate: () => UserId.parse(ANA),
      membership: env.membership,
      specBundle: specBundleFromDir(),
      hub: { changeApplied: () => Promise.reject(new Error('hub down')), scenarioChanged: () => { throw new Error('hub down'); } },
    });
    const res = await angry.request('/api/t/aa/scenarios', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'copy', from: presetId('C') }),
    });
    expect(res.status).toBe(201);
    expect(lines.join('\n')).toContain('session hub notification failed');
  });
});

describe('guards stay on every write route', () => {
  it('state-changing requests need the CSRF token; reads do not; viewers cannot write', async () => {
    const { logger } = captureLogger();
    const guard = (async (c, next) => {
      if (c.req.method !== 'GET' && c.req.header('x-csrf-token') !== 'tok') {
        return new Response(JSON.stringify({ status: 403 }), { status: 403 });
      }
      await next();
    }) as Auth['guard'];
    const auth = {
      guard,
      routes: new Hono<AppEnv>(),
      authenticate: (c: import('hono').Context) => { const u = c.req.header('x-test-user'); return u ? UserId.parse(u) : null; },
      membership: env.membership,
    } as unknown as Auth;
    const guarded = createApp({ logger, db: env.app, auth, specBundle: specBundleFromDir() });
    const body = JSON.stringify({ scenarioId: MINE, baseVersion: 4, changes: [setVar('g.head_start', 1)] });
    const base = { 'content-type': 'application/json', ...ana.headers };
    const noToken = (path: string, method: string, b: string) => guarded.request(path, { method, headers: base, body: b });
    expect((await noToken('/api/t/aa/changesets', 'POST', body)).status).toBe(403);
    expect((await noToken(`/api/t/aa/changesets/${'x'}/revert`, 'POST', '{"baseVersion":1}')).status).toBe(403);
    expect((await noToken('/api/t/aa/scenarios', 'POST', '{"mode":"copy","from":"x"}')).status).toBe(403);
    expect((await noToken(`/api/t/aa/scenarios/${MINE}`, 'PATCH', '{"label":"x"}')).status).toBe(403);
    expect((await guarded.request(`/api/t/aa/scenarios/${MINE}/calc`, { headers: ana.headers })).status).not.toBe(403);
    // with the token it goes through to the handler (here a 422 for the unknown var, not a guard answer)
    const withToken = await guarded.request('/api/t/aa/changesets', { method: 'POST', headers: { ...base, 'x-csrf-token': 'tok' }, body: JSON.stringify({ scenarioId: MINE, baseVersion: 4, changes: [setVar('no.such_var', 1)] }) });
    expect(withToken.status).toBe(422);
  });
});

describe('bench api.commit (G8: commit p95 < 150 ms on the seeded DB)', () => {
  it('p95 of a typed-entry commit, warm model, is under budget', async () => {
    const s = await freshCopy();
    let version = s.version;
    const timed: number[] = [];
    for (let i = 0; i < 44; i++) {
      const t0 = performance.now();
      const res = await applyTo({ id: s.id, version }, [setVar('g.target_net', 60 + i)]);
      const ms = performance.now() - t0;
      expect(res.status).toBe(200);
      version = (await res.json() as ChangesetResult).version;
      if (i >= 4) timed.push(ms); // the first commits compile the model and warm the pool
    }
    timed.sort((a, b) => a - b);
    const p95 = timed[Math.ceil(timed.length * 0.95) - 1] as number;
    console.info(`api.commit: n=${timed.length} p50=${timed[Math.floor(timed.length / 2)]?.toFixed(1)}ms p95=${p95.toFixed(1)}ms max=${timed.at(-1)?.toFixed(1)}ms`);
    expect(p95).toBeLessThan(150);
  }, 120_000);
});
