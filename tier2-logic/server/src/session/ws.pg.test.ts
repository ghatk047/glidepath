import { PROBLEM_CONTENT_TYPE, Problem, WS_PROTOCOL_VERSION, problemTypes } from '@glidepath/api-contract';
import type { CellKey as WireCell, ServerMessage } from '@glidepath/api-contract';
import { loadMembers, withTenant } from '@glidepath/data-access';
import type { VariableDef } from '@glidepath/spec';
import { specBundle } from '@glidepath/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AA_ID, ANA, MINE, MV, ZZ_SCENARIO, presetId } from '../routes/read/testing/aa-db';
import { toEngineCell } from './cells';
import type { Session } from './session';
import { ORIGIN, startSessionHarness } from './testing/harness';
import type { SessionHarness } from './testing/harness';
import { goldenCells, matchesGolden } from './testing/seed';
import { openSocket } from './testing/ws-client';
import type { TestSocket } from './testing/ws-client';

/**
 * API-06 acceptance over a real socket: pg-local with the seed tenant `aa` (presets `rates`, A–D, a user
 * scenario with a pin), cookie auth through the magic link, the hub on a loopback port, the app's pool
 * spied from its first connection.
 */

const v = WS_PROTOCOL_VERSION;
type Delta = Extract<ServerMessage, { type: 'delta' }>;

let h: SessionHarness;
const cookies: Record<'ana' | 'bob' | 'carol', string> = { ana: '', bob: '', carol: '' };
let target: VariableDef;
let conf: VariableDef;
let lever: string;

const C = presetId('C');
const TARGET = 'g.target_net';
const CONF = 'lev.conf';

/** The k-th position of a variable's slider grid (registry min/step), wrapping before max. */
const grid = (def: VariableDef, k: number): number => {
  const steps = Math.round((def.max! - def.min!) / def.step!);
  return def.min! + (k % (steps + 1)) * def.step!;
};

/** The hub's session behind the most recently opened socket. */
const newest = (): Session => {
  const all = [...h.hub.sessions];
  const s = all[all.length - 1];
  if (!s) throw new Error('no session open');
  return s;
};

const opened: TestSocket[] = [];
async function openAs(cookie: string, scenario: string): Promise<{ socket: TestSocket; session: Session }> {
  const socket = await h.open({ cookie, scenario });
  opened.push(socket);
  return { socket, session: newest() };
}

beforeAll(async () => {
  h = await startSessionHarness();
  cookies.ana = await h.login('ana@example.test'); // owner of aa
  cookies.bob = await h.login('bob@example.test'); // editor of zz only
  cookies.carol = await h.login('carol@example.test'); // member of nothing
  const bundle = await specBundle();
  const def = (id: string) => {
    const d = bundle.variables.find((x) => x.id === id);
    if (!d || d.min === null || d.max === null || d.step === null) throw new Error(`no bounded variable ${id}`);
    return d;
  };
  target = def(TARGET);
  conf = def(CONF);
}, 180_000);

afterAll(async () => {
  for (const s of opened) await s.close();
  await h?.close();
});

describe('WS /ws/session?tenant&scenario: cookie, membership, Session(user, tenant, scenario), ModelCache', () => {
  it('authenticates the cookie and membership; opens Session(user, tenant, scenario) with a CompiledModel from ModelCache keyed (tenant, model_version, members_hash)', async () => {
    expect(h.models.stats().compiles).toBe(0);
    const c = await openAs(cookies.ana, C);
    const a = await openAs(cookies.ana, presetId('A'));

    expect(c.session.userId).toBe(ANA);
    expect(c.session.tenant).toMatchObject({ tenantId: AA_ID, slug: 'aa', role: 'owner' });
    expect(c.session.scenarioId).toBe(C);
    expect(a.session.scenarioId).toBe(presetId('A'));

    const { membersHash } = await withTenant(h.aa.app.db, AA_ID, ANA, (tx) => loadMembers(tx));
    const key = { tenantId: AA_ID, modelVersionId: MV, membersHash };
    expect(c.session.scenario.model.key).toEqual(key);
    expect(h.models.keys()).toEqual([key]);
    // The second scenario of the tenant reuses the compiled model: one compile for both sessions.
    expect(a.session.scenario.model).toBe(c.session.scenario.model);
    expect(h.models.stats()).toMatchObject({ misses: 1, compiles: 1 });
    expect(h.models.stats().hits).toBeGreaterThanOrEqual(1);
    expect(lines('session opened')).toBeGreaterThanOrEqual(2);
    lever = c.session.scenario.model.members.lever?.[0]?.id ?? '';
    expect(lever).not.toBe('');
  });

  it('refuses the upgrade with problem JSON before any socket: no or forged cookie 401, cross-site 403, bad query 400, not a member or unknown scenario 404', async () => {
    const refusals = [
      { opts: { scenario: C }, status: 401, type: problemTypes.unauthenticated },
      { opts: { cookie: 'gp_session=forged.signature', scenario: C }, status: 401, type: problemTypes.unauthenticated },
      { opts: { cookie: cookies.ana, scenario: C, origin: 'https://evil.example.test' }, status: 403, type: problemTypes.forbidden },
      { opts: { cookie: cookies.ana, scenario: C, origin: null }, status: 403, type: problemTypes.forbidden },
      { opts: { cookie: cookies.ana, query: 'tenant=aa' }, status: 400, type: problemTypes.badRequest },
      { opts: { cookie: cookies.bob, scenario: C }, status: 404, type: problemTypes.notFound },
      { opts: { cookie: cookies.carol, scenario: C }, status: 404, type: problemTypes.notFound },
      { opts: { cookie: cookies.ana, tenant: 'zz', scenario: ZZ_SCENARIO }, status: 404, type: problemTypes.notFound },
      { opts: { cookie: cookies.ana, scenario: ZZ_SCENARIO }, status: 404, type: problemTypes.notFound },
      { opts: { cookie: cookies.ana, scenario: 'not-a-uuid' }, status: 404, type: problemTypes.notFound },
    ];
    const sessionsBefore = h.hub.sessions.size;
    for (const r of refusals) {
      const res = await h.connect(r.opts);
      expect(res.ok, JSON.stringify(r.opts)).toBe(false);
      if (res.ok) continue;
      expect(res.status, JSON.stringify(r.opts)).toBe(r.status);
      expect(res.contentType).toBe(PROBLEM_CONTENT_TYPE);
      expect(Problem.parse(JSON.parse(res.body)).type).toBe(r.type);
    }
    expect(h.hub.sessions.size).toBe(sessionsBefore);
  });

  it('upgrades are served on /ws/session only', async () => {
    const res = await h.connect({ cookie: cookies.ana, scenario: C, query: `tenant=aa&scenario=${C}` });
    expect(res.ok).toBe(true);
    if (res.ok) opened.push(res.socket);
    const other = await openSocket(`${h.base.replace('http', 'ws')}/api/t/aa/bundle`, { cookie: cookies.ana, origin: ORIGIN });
    expect(other.ok).toBe(false);
    if (!other.ok) expect(other.status).toBe(404);
  });

  it('a plain GET /ws/session (no upgrade) answers 426', async () => {
    const res = await fetch(`${h.base}/ws/session?tenant=aa&scenario=${C}`);
    expect(res.status).toBe(426);
    expect(res.headers.get('content-type')).toBe(PROBLEM_CONTENT_TYPE);
  });
});

describe('subscribe → snapshot', () => {
  it('answers a snapshot of only the subscribed cells; on aa preset C the headline cells equal golden C within 1e-6', async () => {
    const { socket } = await openAs(cookies.ana, C);
    const golden = goldenCells('C');
    socket.send({ v, type: 'subscribe', cells: [...golden.keys()] });
    const snap = await socket.expect('snapshot');
    expect(snap.scenarioId).toBe(C);
    expect(snap.version).toBe(0);
    expect(Object.keys(snap.cells).sort()).toEqual([...golden.keys()].sort());
    const misses = [...golden].filter(([cell, g]) => {
      const got = snap.cells[cell];
      return got === null || got === undefined || !matchesGolden(got, g);
    });
    expect(misses).toEqual([]);

    socket.send({ v, type: 'subscribe', cells: ['res.net[]', `${TARGET}[]`] });
    const second = await socket.expect('snapshot');
    expect(Object.keys(second.cells).sort()).toEqual(['g.target_net[]', 'res.net[]']);
    expect(second.cells['res.net[]' as WireCell]).toBe(snap.cells['res.net[]' as WireCell]);
  });

  it('carries the scenario’s own values and node pins as resolved by tier 3 (user scenario)', async () => {
    const bundle = await specBundle();
    const pinned = bundle.nodes.find((n) => n.dims.length === 0 && n.output);
    if (!pinned) throw new Error('no scalar output node');
    const { socket } = await openAs(cookies.ana, MINE);
    socket.send({ v, type: 'subscribe', cells: [`${pinned.id}[]`, `${TARGET}[]`] });
    const snap = await socket.expect('snapshot');
    expect(snap).toMatchObject({ scenarioId: MINE, version: 4 });
    expect(snap.cells).toEqual({ [`${pinned.id}[]`]: 99.5, [`${TARGET}[]`]: 120 });
  });
});

describe('preview coalescing (100 rapid previews)', () => {
  it('latest seq per cell wins; rerun on a scratch copy; delta carries only subscribed cells whose value changed', async () => {
    const { socket, session } = await openAs(cookies.ana, C);
    const subscribed = ['res.target[]', 'res.gap[]', 'res.net[]', 'base.total[]', `${TARGET}[]`, `${CONF}[${lever}]`] as WireCell[];
    socket.send({ v, type: 'subscribe', cells: subscribed });
    const known = new Map(Object.entries((await socket.expect('snapshot')).cells));
    const committed = session.scenario.committed;
    const committedTarget = committed.get(TARGET);

    let lastTarget = NaN;
    let lastConf = NaN;
    for (let seq = 1; seq <= 100; seq++) {
      const changes =
        seq % 10 === 0
          ? [
              { var: TARGET, member: '', value: (lastTarget = grid(target, seq)) },
              { var: CONF, member: lever, value: (lastConf = grid(conf, seq)) },
            ]
          : seq % 2 === 1
            ? [{ var: TARGET, member: '', value: (lastTarget = grid(target, seq)) }]
            : [{ var: CONF, member: lever, value: (lastConf = grid(conf, seq)) }];
      socket.send({ v, type: 'preview', seq, changes });
    }
    const frames = await socket.until((m) => m.type === 'delta' && m.seq === 100);
    // Deltas, and the scratch's rule results (API-07) whenever a check found no newer preview queued.
    expect(frames.every((m) => m.type === 'delta' || m.type === 'warnings')).toBe(true);
    const deltas = frames.filter((m): m is Delta => m.type === 'delta');

    // Coalesced: fewer answers than previews, each with a higher seq, the last one 100.
    expect(deltas.length).toBeLessThan(100);
    expect(session.counters).toMatchObject({ previews: 100, reruns: deltas.length, rejected: 0 });
    const seqs = deltas.map((d) => d.seq!);
    expect(seqs).toEqual([...seqs].sort((x, y) => x - y));
    expect(new Set(seqs).size).toBe(seqs.length);

    // Every delta: subscribed cells only, each a change against the value last pushed.
    for (const d of deltas) {
      for (const [cell, value] of Object.entries(d.cells)) {
        expect(subscribed).toContain(cell);
        expect(value, `${cell} at seq ${d.seq}`).not.toBe(known.get(cell));
        known.set(cell, value);
      }
    }
    // What the client holds now is, bitwise, a full evaluate of the committed inputs + the latest cells.
    const values = new Map(committed.values);
    values.set(TARGET, lastTarget);
    values.set(`${CONF}[${lever}]`, lastConf);
    const full = session.scenario.model.model.evaluate(values, committed.overrides);
    for (const cell of subscribed) expect(known.get(cell), cell).toBe(full.get(toEngineCell(cell)));
    expect(known.get(`${TARGET}[]`)).toBe(lastTarget);
    expect(known.get('base.total[]')).toBe(committed.get('base.total'));

    // The scratch copy moved; the committed evaluation (shared through the ModelCache) did not.
    expect(session.current.get(TARGET)).toBe(lastTarget);
    expect(session.scenario.committed).toBe(committed);
    expect(committed.get(TARGET)).toBe(committedTarget);

    // cancelPreview sends back exactly the cells that differ from the committed state.
    socket.send({ v, type: 'cancelPreview', seq: 101 });
    const back = (await socket.until((m) => m.type === 'delta' && m.seq === 101)).at(-1) as Delta; // after the warnings of seq 100
    expect(back.seq).toBe(101);
    for (const cell of subscribed) {
      const c = committed.get(toEngineCell(cell));
      if (Object.is(c, known.get(cell))) expect(back.cells).not.toHaveProperty([cell]);
      else expect(back.cells[cell], cell).toBe(c);
    }
  });
});

describe('a preview issues no SQL (query spy)', () => {
  it('previews, deltas and a cancel run no statement and check out no connection', async () => {
    const statementsAtStart = h.queries.statements.length;
    const { socket } = await openAs(cookies.ana, presetId('D'));
    // Control: the handshake reads tier 3 (scenario, tenant, members, inputs), and the spy sees it.
    expect(h.queries.statements.length).toBeGreaterThan(statementsAtStart);
    socket.send({ v, type: 'subscribe', cells: ['res.net[]', 'res.gap[]'] });
    await socket.expect('snapshot');

    const before = { statements: h.queries.statements.length, checkouts: h.queries.checkouts };
    for (let seq = 1; seq <= 100; seq++) {
      socket.send({ v, type: 'preview', seq, changes: [{ var: TARGET, member: '', value: grid(target, seq) }] });
    }
    await socket.until((m) => m.type === 'delta' && m.seq === 100);
    socket.send({ v, type: 'cancelPreview', seq: 101 });
    await socket.until((m) => m.type === 'delta' && m.seq === 101);

    expect(h.queries.statements.slice(before.statements)).toEqual([]);
    expect(h.queries.checkouts).toBe(before.checkouts);
  });
});

describe('open{scenarioId} through tier 3', () => {
  it('switches the session to another scenario with a snapshot of the subscribed cells; an unknown one is an error', async () => {
    const { socket, session } = await openAs(cookies.ana, C);
    socket.send({ v, type: 'subscribe', cells: ['res.net[]'] });
    await socket.expect('snapshot');
    socket.send({ v, type: 'open', scenarioId: presetId('rates') });
    const snap = await socket.expect('snapshot');
    expect(snap.scenarioId).toBe(presetId('rates'));
    expect(matchesGolden(snap.cells['res.net[]' as WireCell]!, goldenCells('rates').get('res.net[]' as WireCell)!)).toBe(true);
    socket.send({ v, type: 'open', scenarioId: ZZ_SCENARIO }); // another tenant's: not visible
    expect(await socket.expect('error')).toMatchObject({ problem: { status: 404 } });
    expect(session.scenarioId).toBe(presetId('rates'));
  });
});

function lines(msg: string): number {
  return h.lines.filter((l) => (JSON.parse(l) as { msg?: string }).msg === msg).length;
}
