import { randomUUID } from 'node:crypto';
import { BaselineGroupBy, WS_PROTOCOL_VERSION, viewNames } from '@glidepath/api-contract';
import { createAiReconfigJob, schema, sql, withTenant } from '@glidepath/data-access';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/server';
import { VirtualAuthenticator } from '../../src/auth/testing/virtual-authenticator';
import type { TestSocket } from '../../src/session/testing/ws-client';
import { bytesOf, cellValues, loadBook, setDefault } from './book';
import type { Book } from './book';
import { Browser, LeakClient } from './client';
import type { Body, Captured } from './client';
import { Markers, digest, globalRowsOf, leaves, rowsOfTenant, tenantTables } from './oracle';
import type { Leaf, TenantTable } from './oracle';
import { OTHERS, Probe, requestTokens } from './probe';
import type { Other, World } from './probe';
import { COPY_NAME, ORIGIN, SLUG, TENANT_ID, USERS, openLeakStack, presetOf } from './stack';
import type { LeakStack, TenantName, UserName } from './stack';

/**
 * G7 at the route level (QA-03; 04 section 1 "cross-tenant leak test", 06 section 4 "three tenants"). Three
 * tenants are seeded as the migrate step seeds a tenant (test/leak/stack.ts): `aa` (tenant A), `zz` (B) and a
 * copy of `aa` (C). B and C first use the same routes on their own data, so every tenant table holds rows of
 * both. Then every route of the server's router, and the WS session, is called as tenant A:
 *
 * - on tenant A's own data (it must work), by tenant A's owner and by a user who is also a member of the copy;
 * - aimed at B's and C's rows (their ids under tenant A's path, and their own paths by a non-member): refused
 *   with the same 404 as an id or tenant that does not exist;
 *
 * and every answer and WS frame is looked through for values only B or C have, while B's and C's rows, read by a
 * superuser after every call, must stay exactly as they were (probe.ts, oracle.ts). The route list is read from
 * the composed server's router: a route without a case here fails the discovery test.
 */

let stack: LeakStack;
let w: World;
let tables: { tenant: TenantTable[]; global: TenantTable[] };

/** An idempotency key B and C used: tenant A sending it must get its own commit, never their replay. */
const SHARED_REQUEST = 'rq-leak-shared';
/** MAX's key, used in the copy first and then in tenant A. */
const MAX_REQUEST = 'rq-leak-max';

/** Each tenant's edits: numbers with enough digits to be recognised wherever they surface. */
const EDIT: Record<TenantName, { net: number; pct: number; pin: number; tmp: number; def: number; again: number }> = {
  A: { net: 112.34571, pct: 0.064217, pin: 71.246813, tmp: 0.057913, def: 109.87651, again: 113.57913 },
  B: { net: 104.32179, pct: 0.073109, pin: 77.123456, tmp: 0.061137, def: 101.23457, again: 103.98761 },
  C: { net: 96.873117, pct: 0.051713, pin: 81.543219, tmp: 0.044419, def: 98.765437, again: 97.13579 },
};
/** Tenant A's own edits. */
const OWN = { net: 117.25931, again: 116.41327, pct: 0.088813, def: 107.31337, preview: 111.11923 };

/** Ids of B's and C's rows, made through the routes by their own users. */
interface OtherIds {
  presetC: string;
  fork: string;
  copy: string;
  changesets: { edit: string; pin: string; tmp: string; revert: string; import: string };
  quickRun: string;
  saveRun: string;
  queuedRun: string;
  exportId: string;
  importId: string;
  aiJob: string;
}
const other = {} as Record<Other, OtherIds>;

/** Tenant A's ids, filled by its own calls in route order. */
const A = {
  presetC: presetOf('A', 'C'),
  presetD: presetOf('A', 'D'),
  fork: '',
  version: 0,
  created: '',
  run: '',
  queuedRun: '',
  exportId: '',
  importId: '',
  aiJob: '',
  book: null as Book | null,
  outputs: [] as string[],
  passkey: null as { authenticator: VirtualAuthenticator; options: PublicKeyCredentialCreationOptionsJSON } | null,
  passkeyBrowser: null as Browser | null,
  loginOptions: null as PublicKeyCredentialRequestOptionsJSON | null,
};

const at = (slug: string, path: string): string => `/api/t/${slug}${path}`;
const own = (path: string): string => at(SLUG.A, path);
const json = (v: unknown): Body => ({ json: v });

function okJson<T = Record<string, unknown>>(c: Captured, ...statuses: number[]): T {
  if (!statuses.includes(c.status)) throw new Error(`setup: ${c.method} ${c.path} answered ${c.status}: ${c.text.slice(0, 600)}`);
  return c.json as T;
}

/** The latest sign-in link sent to `email` after `before` links. */
async function linkFor(email: string, before: number): Promise<string> {
  for (let i = 0; i < 300; i++) {
    const found = stack.links.slice(before).find((l) => l.includes('token='));
    if (found) return found;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`no sign-in link for ${email}`);
}

/**
 * A tenant uses the routes on its own data, as its own user: edits, a pin, a relabel, an undo, a copy, solver
 * runs, an export, an upload and its apply, and the two tables no route writes yet.
 *
 * Tenant A runs it too, before the markers are built (`preset: 'D'`, no idempotency key): what makes a value a
 * marker of B or C is then that B or C hold it and tenant A does not, not that tenant A has not yet done the same
 * kind of work. Without it the vocabulary of those rows (`application/json` of a stored file, the `user` actor of
 * an audit row, `solver` of a job) would count as another tenant's, and every answer would look like a leak.
 */
async function act(client: LeakClient, b: Browser, t: TenantName, o: { preset: string; requestId?: string }): Promise<OtherIds> {
  const slug = SLUG[t];
  const req = (method: string, path: string, body?: Body) => client.request(b, method, at(slug, path), body);
  const presetC = presetOf(t, o.preset);
  const { scenarios } = okJson<{ scenarios: { id: string; version: number }[] }>(await req('GET', '/scenarios'), 200);
  const v = scenarios.find((s) => s.id === presetC)!.version;
  type Result = { changesetId: string; scenarioId: string; version: number };
  const edit = okJson<Result>(
    await req('POST', '/changesets', json({
      scenarioId: presetC,
      baseVersion: v,
      ...(o.requestId === undefined ? {} : { clientRequestId: o.requestId }),
      changes: [{ target: 'variable', key: 'g.target_net', member: '', value: EDIT[t].net }],
    })),
    200,
  );
  const fork = edit.scenarioId;
  type Member = { key: string; label: string; attrs: Record<string, unknown>; sort: number | null; active: boolean };
  const members = okJson<{ dimensions: Record<string, Member[]> }>(await req('GET', '/members'), 200);
  // A structural change replaces the member's whole row, so its attributes are carried over with the new label.
  const vendor = members.dimensions.vendor![0]!;
  const relabelled = { label: `${slug}-only vendor`, attrs: vendor.attrs, sort: vendor.sort, active: vendor.active };
  const pin = okJson<Result>(
    await req('POST', '/changesets', json({
      scenarioId: fork,
      baseVersion: edit.version,
      changes: [
        { target: 'override', key: 'res.net', member: '', value: EDIT[t].pin, note: `${slug}-only pin` },
        { target: 'variable', key: 'g.target_pct', member: '', value: EDIT[t].pct },
        { target: 'structural', key: 'vendor', member: vendor.key, value: relabelled },
      ],
    })),
    200,
  );
  const tmp = okJson<Result>(
    await req('POST', '/changesets', json({ scenarioId: fork, baseVersion: pin.version, changes: [{ target: 'variable', key: 'g.target_pct', member: '', value: EDIT[t].tmp }] })),
    200,
  );
  const revert = okJson<Result>(await req('POST', `/changesets/${tmp.changesetId}/revert`, json({ baseVersion: tmp.version })), 200);
  const copy = okJson<{ id: string }>(await req('POST', '/scenarios', json({ mode: 'copy', from: fork, label: `${slug}-only scenario` })), 201);
  okJson(await req('PATCH', `/scenarios/${copy.id}`, json({ label: `${slug}-only renamed` })), 200);
  const sensitivity = okJson<{ id: string; result: { metrics: Record<string, number> } }>(
    await req('POST', '/solver-runs/quick', json({ scenarioId: fork, spec: { problem: 'sensitivity', params: { method: 'tornado', outputs: ['res.net[]'] } } })),
    200,
  );
  // The run's own metric for the output cell, as the wire keys it (`res.net[]`, API-13's `wireMetricKey`).
  const net = sensitivity.result.metrics['res.net[]'];
  if (net === undefined) throw new Error(`setup: the ${slug} tornado run reported no res.net[]: ${JSON.stringify(sensitivity.result.metrics)}`);
  const seek = okJson<{ id: string }>(
    await req('POST', '/solver-runs/quick', json({
      scenarioId: fork,
      save: true,
      spec: { problem: 'goal_seek', params: { var: 'lev.L01.cut[]', output: 'res.net[]', target: net } },
    })),
    200,
  );
  const queued = okJson<{ id: string }>(await req('POST', '/solver-runs', json({ scenarioId: fork, spec: { problem: 'min_risk_mix', params: {} } })), 201);
  const exported = okJson<{ id: string; file: { id: string } }>(await req('POST', '/exports', json({ scenarioIds: [fork], sheets: ['Targets'] })), 201);
  const file = await req('GET', `/files/${exported.file.id}`);
  okJson(file, 200);
  const book = await loadBook(file.bytes);
  setDefault(book, 'g.target_net', EDIT[t].def);
  const upload = okJson<{ id: string }>(
    await req('POST', `/imports?filename=${encodeURIComponent(`${slug}-only edits.xlsx`)}`, { bytes: await bytesOf(book), contentType: 'application/octet-stream' }),
    201,
  );
  await stack.settled();
  const preview = okJson<{ status: string }>(await req('GET', `/imports/${upload.id}`), 200);
  if (preview.status !== 'awaiting_review') throw new Error(`setup: the ${slug} import preview ended ${JSON.stringify(preview)}`);
  const applied = okJson<{ changesetId: string }>(await req('POST', `/imports/${upload.id}/apply`, json({ accept: 'all', decisions: [] })), 200);

  // Tables no route writes yet (AI reconfiguration, market snapshots): rows of the tenant, as its own user.
  const user = { A: USERS.ana, B: USERS.bob, C: USERS.cleo }[t];
  let aiJob = '';
  await withTenant(stack.app.db, TENANT_ID[t], user.id, async (tx) => {
    aiJob = (await createAiReconfigJob(tx, { prompt: `${slug}-only prompt`, plan: { note: `${slug}-only plan` }, status: 'review' })).id;
    const source = randomUUID();
    await tx.insert(schema.source).values({
      tenant_id: TENANT_ID[t], id: source, code: `${slug}-only-feed`, kind: 'market', title: `${slug}-only market feed`, url: null, as_of: '2026-11-20',
    });
    await tx.insert(schema.market_snapshot).values({
      tenant_id: TENANT_ID[t], id: randomUUID(), as_of: '2026-11-20', payload: { feed: `${slug}-only feed`, px: EDIT[t].again }, source_id: source, applied_changeset_id: null,
    });
  });

  return {
    presetC,
    fork,
    copy: copy.id,
    changesets: { edit: edit.changesetId, pin: pin.changesetId, tmp: tmp.changesetId, revert: revert.changesetId, import: applied.changesetId },
    quickRun: sensitivity.id,
    saveRun: seek.id,
    queuedRun: queued.id,
    exportId: exported.id,
    importId: upload.id,
    aiJob,
  };
}

/**
 * What each side holds that the other never held, in both directions: the values of B's and C's rows for the
 * answers tenant A gets, and the values of tenant A's rows for the frames B's and C's sessions get.
 *
 * The exclusion sets grow: a value either side held at any earlier check stays excluded, because a value two
 * tenants have had is no evidence of a leak either way (a status of `queued`, the same number in two models).
 */
const seen = { A: new Set<Leaf>(), others: new Set<Leaf>() };

async function buildMarkers(): Promise<{ others: Markers; ownOnly: Markers }> {
  const mine = await rowsOfTenant(stack.admin, tables.tenant, 'A');
  const theirs = await Promise.all(OTHERS.map(async (t) => ({ tenant: t as TenantName, rows: await rowsOfTenant(stack.admin, tables.tenant, t) })));
  const global = leaves(await globalRowsOf(stack.admin, tables.global));
  for (const v of leaves([...mine.values()].flat())) seen.A.add(v);
  for (const v of leaves(theirs.flatMap((x) => [...x.rows.values()].flat()))) seen.others.add(v);
  return {
    others: Markers.build(seen.A, global, theirs),
    ownOnly: Markers.build(seen.others, global, [{ tenant: 'A', rows: mine }]),
  };
}

/** B's and C's digests as they are now (after they acted themselves). */
async function rebaseline(): Promise<void> {
  for (const t of OTHERS) w.last[t] = await digest(stack.admin, tables.tenant, TENANT_ID[t]);
}

beforeAll(async () => {
  stack = await openLeakStack();
  const client = new LeakClient(stack);
  const browsers = {} as Record<UserName, Browser>;
  for (const u of Object.keys(USERS) as UserName[]) browsers[u] = await client.signIn(USERS[u]);
  // Tenant A first does the same kinds of work on another preset, so the markers are about tenants, not about
  // which rows exist yet (see `act`). Its own route calls below start from preset C, untouched by this.
  await act(client, browsers.ana, 'A', { preset: 'D' });
  other.B = await act(client, browsers.bob, 'B', { preset: 'C', requestId: SHARED_REQUEST });
  other.C = await act(client, browsers.cleo, 'C', { preset: 'C', requestId: SHARED_REQUEST });
  // MAX (member of A and of the copy) commits in the copy with a key it will send again in tenant A.
  const { scenarios } = okJson<{ scenarios: { id: string; version: number }[] }>(await client.request(browsers.max, 'GET', at(SLUG.C, '/scenarios')), 200);
  const forkC = scenarios.find((s) => s.id === other.C.fork)!;
  okJson(
    await client.request(browsers.max, 'POST', at(SLUG.C, '/changesets'), json({
      scenarioId: forkC.id, baseVersion: forkC.version, clientRequestId: MAX_REQUEST, changes: [{ target: 'variable', key: 'g.target_net', member: '', value: EDIT.C.again }],
    })),
    200,
  );
  await stack.settled();
  tables = await tenantTables(stack.admin);
  w = { stack, client, browsers, tables: tables.tenant, markers: new Markers(), last: { B: new Map(), C: new Map() } };
  w.markers = (await buildMarkers()).others;
  await rebaseline();
}, 600_000);

afterAll(async () => {
  await stack?.close();
});

// ---------------------------------------------------------------------------------- the cases, one per route

/** What every route is called with as tenant A. Keys are the router's `METHOD path`, in the order they run. */
const CASES: Record<string, (p: Probe) => Promise<void>> = {
  // ----- outside any tenant
  'GET /healthz': async (p) => {
    await p.own('health', 'ana', 'GET', '/healthz');
  },
  'POST /api/auth/magic-link': async (p) => {
    const mine = await p.own('sign-in link', 'ana', 'POST', '/api/auth/magic-link', json({ email: USERS.ana.email }), [202]);
    for (const email of [USERS.bob.email, USERS.cleo.email, 'nobody@example.test']) {
      const r = await p.call("sign-in link for another tenant's user (no account oracle)", 'ana', 'POST', '/api/auth/magic-link', json({ email }), {
        expect: [202],
        echoes: new Set([email]),
      });
      if (r.text !== mine.text) p.problems.push(`the answer for ${email} differs from tenant A's own: ${r.text}`);
    }
  },
  'GET /api/auth/callback': async (p) => {
    const fresh = new Browser(USERS.ana);
    const before = stack.links.length;
    await p.call('sign-in link (fresh browser)', fresh, 'POST', '/api/auth/magic-link', json({ email: USERS.ana.email }), { expect: [202] });
    const link = new URL(await linkFor(USERS.ana.email, before));
    await p.call('sign-in callback (own)', fresh, 'GET', `${link.pathname}${link.search}`, undefined, { expect: [303], echoes: requestTokens(`${link.pathname}${link.search}`, undefined) });
    const me = await p.call('me after the callback', fresh, 'GET', '/api/me', undefined, { expect: [200] });
    expect((me.json as { user: { id: string } }).user.id).toBe(USERS.ana.id);
  },
  'POST /api/auth/passkey/register/options': async (p) => {
    const r = await p.own('passkey registration options', 'ana', 'POST', '/api/auth/passkey/register/options');
    A.passkey = { authenticator: new VirtualAuthenticator(ORIGIN), options: r.json as PublicKeyCredentialCreationOptionsJSON };
  },
  'POST /api/auth/passkey/register/verify': async (p) => {
    const { authenticator, options } = A.passkey!;
    await p.own('passkey registration', 'ana', 'POST', '/api/auth/passkey/register/verify', json({ response: authenticator.create(options), label: 'leak test key' }), [201]);
  },
  'POST /api/auth/passkey/login/options': async (p) => {
    A.passkeyBrowser = new Browser(USERS.ana);
    const r = await p.call('passkey sign-in options (own)', A.passkeyBrowser, 'POST', '/api/auth/passkey/login/options', undefined, { expect: [200] });
    A.loginOptions = r.json as PublicKeyCredentialRequestOptionsJSON;
  },
  'POST /api/auth/passkey/login/verify': async (p) => {
    const response = A.passkey!.authenticator.get(A.loginOptions!);
    await p.call('passkey sign-in (own)', A.passkeyBrowser!, 'POST', '/api/auth/passkey/login/verify', json({ response }), { expect: [200], echoes: requestTokens('/', json({ response })) });
    await p.call('me after the passkey sign-in', A.passkeyBrowser!, 'GET', '/api/me', undefined, { expect: [200] });
  },
  'POST /api/auth/logout': async (p) => {
    await p.call('sign-out (own)', A.passkeyBrowser!, 'POST', '/api/auth/logout', undefined, { expect: [204] });
    await p.call('me after sign-out', A.passkeyBrowser!, 'GET', '/api/me', undefined, { expect: [401] });
  },
  'GET /api/me': async (p) => {
    const r = await p.own('me', 'ana', 'GET', '/api/me');
    expect((r.json as { memberships: { tenantSlug: string }[] }).memberships.map((m) => m.tenantSlug)).toEqual([SLUG.A]);
  },
  'GET /api/tenants': async (p) => {
    const r = await p.own('tenants', 'ana', 'GET', '/api/tenants');
    expect((r.json as { tenants: { slug: string }[] }).tenants.map((t) => t.slug)).toEqual([SLUG.A]);
  },
  'GET /ws/session': async (p) => {
    // The handshake without an upgrade; the session itself is the WS test below.
    await p.own('session handshake without upgrade', 'ana', 'GET', `/ws/session?tenant=${SLUG.A}&scenario=${A.presetC}`, undefined, [426]);
  },

  // ----- read routes
  'GET /api/t/:tenant/bundle': async (p) => {
    await p.own('bundle', 'ana', 'GET', own('/bundle'));
    await p.foreign('bundle', 'GET', (s) => at(s, '/bundle'));
  },
  'GET /api/t/:tenant/members': async (p) => {
    await p.own('members', 'ana', 'GET', own('/members'));
    await p.foreign('members', 'GET', (s) => at(s, '/members'));
  },
  'GET /api/t/:tenant/scenarios': async (p) => {
    const r = await p.own('scenarios', 'ana', 'GET', own('/scenarios'));
    A.version = (r.json as { scenarios: { id: string; version: number }[] }).scenarios.find((s) => s.id === A.presetC)!.version;
    await p.foreign('scenarios', 'GET', (s) => at(s, '/scenarios'));
  },

  // ----- write routes (the order builds tenant A's own data for the routes after them)
  'POST /api/t/:tenant/changesets': async (p) => {
    // Tenant A forks its preset C, sending the idempotency key B and C used: its own commit, not their replay.
    const first = await p.own('edit (forks the preset)', 'ana', 'POST', own('/changesets'), json({
      scenarioId: A.presetC, baseVersion: A.version, clientRequestId: SHARED_REQUEST, changes: [{ target: 'variable', key: 'g.target_net', member: '', value: OWN.net }],
    }));
    const r = first.json as { scenarioId: string; version: number; changesetId: string; forkedFrom?: string };
    expect(r.forkedFrom).toBe(A.presetC);
    A.fork = r.scenarioId;
    // MAX sends in tenant A the key it used in the copy: its own commit in A, not the copy's replay.
    const second = await p.own('edit by a member of the copy too, with its copy key', 'max', 'POST', own('/changesets'), json({
      scenarioId: A.fork, baseVersion: r.version, clientRequestId: MAX_REQUEST, changes: [{ target: 'variable', key: 'g.target_net', member: '', value: OWN.again }],
    }));
    A.version = (second.json as { version: number }).version;
    for (const t of OTHERS) {
      const o = other[t];
      const change = [{ target: 'variable', key: 'g.target_net', member: '', value: OWN.net }];
      await p.aimed('edit of their scenario', 'POST', (s) => at(s, '/changesets'), json({ scenarioId: o.fork, baseVersion: 1, changes: change }), t, [o.fork]);
      await p.aimed('edit of their locked preset (would fork)', 'POST', (s) => at(s, '/changesets'), json({ scenarioId: o.presetC, baseVersion: 1, changes: change }), t, [o.presetC]);
    }
  },
  'GET /api/t/:tenant/scenarios/:id/inputs': async (p) => {
    await p.own('inputs', 'ana', 'GET', own(`/scenarios/${A.fork}/inputs`));
    for (const t of OTHERS) for (const id of [other[t].presetC, other[t].fork, other[t].copy]) await p.aimed('inputs', 'GET', (s) => at(s, `/scenarios/${id}/inputs`), undefined, t, [id]);
  },
  'GET /api/t/:tenant/scenarios/:id/changesets': async (p) => {
    await p.own('history', 'ana', 'GET', own(`/scenarios/${A.fork}/changesets`));
    for (const t of OTHERS) for (const id of [other[t].presetC, other[t].fork]) await p.aimed('history', 'GET', (s) => at(s, `/scenarios/${id}/changesets?limit=50`), undefined, t, [id]);
  },
  'GET /api/t/:tenant/scenarios/:id/calc': async (p) => {
    const r = await p.own('calc', 'ana', 'GET', own(`/scenarios/${A.fork}/calc`));
    A.outputs = Object.keys((r.json as { outputs: Record<string, number> }).outputs);
    for (const t of OTHERS) for (const id of [other[t].presetC, other[t].fork]) await p.aimed('calc', 'GET', (s) => at(s, `/scenarios/${id}/calc`), undefined, t, [id]);
  },
  'POST /api/t/:tenant/changesets/:id/revert': async (p) => {
    const edit = await p.own('edit to undo', 'ana', 'POST', own('/changesets'), json({
      scenarioId: A.fork, baseVersion: A.version, changes: [{ target: 'variable', key: 'g.target_pct', member: '', value: OWN.pct }],
    }));
    const e = edit.json as { changesetId: string; version: number };
    const undo = await p.own('undo', 'ana', 'POST', own(`/changesets/${e.changesetId}/revert`), json({ baseVersion: e.version }));
    A.version = (undo.json as { version: number }).version;
    for (const t of OTHERS) {
      for (const id of [other[t].changesets.pin, other[t].changesets.import, other[t].changesets.revert]) {
        await p.aimed('undo of their changeset', 'POST', (s) => at(s, `/changesets/${id}/revert`), json({ baseVersion: 3 }), t, [id]);
      }
    }
  },
  'POST /api/t/:tenant/scenarios': async (p) => {
    const r = await p.own('copy of a preset', 'ana', 'POST', own('/scenarios'), json({ mode: 'copy', from: A.presetD, label: 'tenant A copy' }), [201]);
    A.created = (r.json as { id: string }).id;
    for (const t of OTHERS) {
      const o = other[t];
      await p.aimed('copy of their scenario', 'POST', (s) => at(s, '/scenarios'), json({ mode: 'copy', from: o.fork }), t, [o.fork]);
      await p.aimed('child of their scenario', 'POST', (s) => at(s, '/scenarios'), json({ mode: 'child', parentId: o.copy }), t, [o.copy]);
      await p.aimed('blend with their scenario', 'POST', (s) => at(s, '/scenarios'), json({ mode: 'blend', parts: [{ scenarioId: A.presetC, weight: 0.5 }, { scenarioId: o.presetC, weight: 0.5 }] }), t, [o.presetC]);
    }
  },
  'PATCH /api/t/:tenant/scenarios/:id': async (p) => {
    await p.own('rename', 'ana', 'PATCH', own(`/scenarios/${A.created}`), json({ label: 'tenant A copy, renamed' }));
    for (const t of OTHERS) {
      for (const id of [other[t].copy, other[t].presetC]) {
        await p.aimed('rename, lock and archive of their scenario', 'PATCH', (s) => at(s, `/scenarios/${id}`), json({ label: 'taken over', locked: true, archived: true }), t, [id]);
      }
    }
  },

  // ----- explain and search
  'GET /api/t/:tenant/nodes/:cell/explain': async (p) => {
    const cell = encodeURIComponent('res.net[]');
    await p.own('explain', 'ana', 'GET', own(`/nodes/${cell}/explain?scenario=${A.fork}`));
    for (const t of OTHERS) for (const id of [other[t].fork, other[t].presetC]) await p.aimed('explain', 'GET', (s) => at(s, `/nodes/${cell}/explain?scenario=${id}`), undefined, t, [id]);
  },
  'GET /api/t/:tenant/search': async (p) => {
    // Words of B's and C's own labels: tenant A's search must find only tenant A's members.
    for (const q of ['vendor', 'zz-only', 'aa-copy-only', 'Test Service Provider', 'renamed', 'flight deck']) {
      await p.own(`search '${q}'`, 'ana', 'GET', own(`/search?q=${encodeURIComponent(q)}`));
    }
    await p.foreign('search', 'GET', (s) => at(s, '/search?q=vendor'));
  },

  // ----- solvers
  'POST /api/t/:tenant/solver-runs/quick': async (p) => {
    const r = await p.own('quick tornado', 'ana', 'POST', own('/solver-runs/quick'), json({
      scenarioId: A.fork, spec: { problem: 'sensitivity', params: { method: 'tornado', outputs: ['res.net[]'] } },
    }));
    A.run = (r.json as { id: string }).id;
    await p.own('quick blend of two presets', 'ana', 'POST', own('/solver-runs/quick'), json({ scenarioId: A.presetC, spec: { problem: 'scenario_blend', params: { from: A.presetC, to: A.presetD } } }));
    await p.own('quick breakeven (reads the C and D presets)', 'ana', 'POST', own('/solver-runs/quick'), json({ scenarioId: A.fork, spec: { problem: 'breakeven', params: {} } }));
    for (const t of OTHERS) {
      const o = other[t];
      await p.aimed('quick run on their scenario', 'POST', (s) => at(s, '/solver-runs/quick'), json({ scenarioId: o.fork, spec: { problem: 'sensitivity', params: { method: 'tornado', outputs: ['res.net[]'] } } }), t, [o.fork]);
      await p.aimed('quick blend towards their scenario', 'POST', (s) => at(s, '/solver-runs/quick'), json({ scenarioId: A.presetC, spec: { problem: 'scenario_blend', params: { from: A.presetC, to: o.fork } } }), t, [o.fork]);
    }
  },
  'POST /api/t/:tenant/solver-runs': async (p) => {
    const r = await p.own('job', 'ana', 'POST', own('/solver-runs'), json({ scenarioId: A.fork, spec: { problem: 'min_risk_mix', params: {} } }), [201]);
    A.queuedRun = (r.json as { id: string }).id;
    for (const t of OTHERS) {
      const o = other[t];
      await p.aimed('job on their scenario', 'POST', (s) => at(s, '/solver-runs'), json({ scenarioId: o.fork, spec: { problem: 'min_risk_mix', params: {} } }), t, [o.fork]);
    }
  },
  'GET /api/t/:tenant/solver-runs/:id': async (p) => {
    await p.own('run status', 'ana', 'GET', own(`/solver-runs/${A.run}`));
    for (const t of OTHERS) for (const id of [other[t].quickRun, other[t].saveRun, other[t].queuedRun]) await p.aimed('run status', 'GET', (s) => at(s, `/solver-runs/${id}`), undefined, t, [id]);
  },
  'GET /api/t/:tenant/solver-runs/lookup': async (p) => {
    // The lookup of the run tenant A started itself (API-13), and of the other tenants' scenarios.
    const lookup = (scenario: string): string =>
      `/solver-runs/lookup?scenarioId=${scenario}&problem=sensitivity&params=${encodeURIComponent(JSON.stringify({ method: 'tornado', outputs: ['res.net[]'] }))}`;
    await p.own('lookup of its own run', 'ana', 'GET', own(lookup(A.fork)));
    await p.own('lookup by a member of the copy too', 'max', 'GET', own(lookup(A.fork)));
    for (const t of OTHERS) for (const id of [other[t].fork, other[t].presetC]) await p.aimed('lookup', 'GET', (s) => at(s, lookup(id)), undefined, t, [id]);
  },
  'DELETE /api/t/:tenant/solver-runs/:id': async (p) => {
    await p.own('cancel', 'ana', 'DELETE', own(`/solver-runs/${A.queuedRun}`));
    for (const t of OTHERS) for (const id of [other[t].queuedRun, other[t].quickRun]) await p.aimed('cancel of their run', 'DELETE', (s) => at(s, `/solver-runs/${id}`), undefined, t, [id]);
  },

  // ----- Excel and files
  'POST /api/t/:tenant/exports': async (p) => {
    const r = await p.own('export', 'ana', 'POST', own('/exports'), json({ scenarioIds: [A.fork, A.presetC] }), [201]);
    A.exportId = (r.json as { id: string }).id;
    for (const t of OTHERS) {
      const o = other[t];
      await p.aimed('export of their scenario', 'POST', (s) => at(s, '/exports'), json({ scenarioIds: [o.fork] }), t, [o.fork]);
      await p.aimed('export of ours and theirs', 'POST', (s) => at(s, '/exports'), json({ scenarioIds: [A.fork, o.copy], sheets: ['Targets'] }), t, [o.copy]);
    }
  },
  'GET /api/t/:tenant/files/:id': async (p) => {
    const r = await p.own('download (every cell of the workbook is looked through)', 'ana', 'GET', own(`/files/${A.exportId}`), undefined, [200], async (c) =>
      cellValues(await loadBook(c.bytes)),
    );
    A.book = await loadBook(r.bytes);
    for (const t of OTHERS) for (const id of [other[t].exportId, other[t].importId]) await p.aimed('download of their file', 'GET', (s) => at(s, `/files/${id}`), undefined, t, [id]);
  },
  'POST /api/t/:tenant/imports': async (p) => {
    setDefault(A.book!, 'g.target_net', OWN.def);
    const bytes = await bytesOf(A.book!);
    const r = await p.own('upload', 'ana', 'POST', own('/imports?filename=tenant-a.xlsx'), { bytes, contentType: 'application/octet-stream' }, [201]);
    A.importId = (r.json as { id: string }).id;
    await stack.settled();
    await p.unchanged('the import preview');
    // Tenant A's workbook sent to the other tenants' paths by a non-member: refused, nothing stored there.
    await p.foreign('upload', 'POST', (s) => at(s, '/imports?filename=tenant-a.xlsx'), { bytes, contentType: 'application/octet-stream' });
  },
  'GET /api/t/:tenant/imports/:id': async (p) => {
    const r = await p.own('import preview', 'ana', 'GET', own(`/imports/${A.importId}`));
    expect((r.json as { status: string }).status).toBe('awaiting_review');
    for (const t of OTHERS) await p.aimed('their import', 'GET', (s) => at(s, `/imports/${other[t].importId}`), undefined, t, [other[t].importId]);
  },
  'POST /api/t/:tenant/imports/:id/apply': async (p) => {
    await p.own('apply', 'ana', 'POST', own(`/imports/${A.importId}/apply`), json({ accept: 'all', decisions: [] }));
    for (const t of OTHERS) {
      await p.aimed('apply of their import', 'POST', (s) => at(s, `/imports/${other[t].importId}/apply`), json({ accept: 'all', decisions: [] }), t, [other[t].importId]);
    }
  },

  // ----- market (API-11)
  'POST /api/t/:tenant/market/refresh': async (p) => {
    // The value is moved off the tenant's own current one, so it stays inside the registry's bounds.
    const inputs = okJson<{ inputs: { var: string; member: string; value: number | null }[] }>(
      await w.client.request(w.browsers.ana, 'GET', own(`/scenarios/${A.fork}/inputs`)),
      200,
    ).inputs;
    const price = inputs.find((i) => i.var === 'corp.price_now')?.value ?? 1;
    const body = json({ source: 'manual', asOf: '2026-11-21', values: [{ var: 'corp.price_now', member: '', value: Number((price * 1.013717).toFixed(5)) }] });
    await p.own('market snapshot', 'ana', 'POST', own('/market/refresh'), body, [201]);
    await p.foreign('market snapshot', 'POST', (s) => at(s, '/market/refresh'), body);
  },

  // ----- AI reconfiguration (API-11): the tenant is named in the body, not in the path
  'POST /api/ai/reconfig': async (p) => {
    const r = await p.own('dry run on its own tenant', 'ana', 'POST', '/api/ai/reconfig', json({ prompt: 'tenant A only: tune the levers', tenant: SLUG.A, dryRun: true }), [201]);
    A.aiJob = (r.json as { id: string }).id;
    for (const t of OTHERS) {
      const body = json({ prompt: 'tune the levers of a tenant that is not mine', tenant: SLUG[t], dryRun: true });
      // the slug is swapped for an unknown one in the twin: "no such tenant, or you are not a member" either way
      await p.refused(`dry run on tenant ${t}`, 'ana', 'POST', '/api/ai/reconfig', body, [SLUG[t]]);
      if (t === 'B') await p.refused('dry run on tenant B by a member of A and the copy', 'max', 'POST', '/api/ai/reconfig', body, [SLUG.B]);
    }
    // max owns no tenant: 403, and it says nothing about any tenant
    await p.call('dry run by a user who owns no tenant', 'max', 'POST', '/api/ai/reconfig', json({ prompt: 'set up something new', tenant: null, dryRun: true }), { expect: [403] });
  },
  'GET /api/ai/reconfig': async (p) => {
    // The list is per user, over the tenants the caller belongs to (API-14).
    const r = await p.own('its own jobs', 'ana', 'GET', '/api/ai/reconfig');
    const mine = r.json as { jobs: { id: string; tenant: string | null }[]; parity: { tenant: string }[] };
    expect([...new Set(mine.jobs.map((j) => j.tenant))].filter((s) => s !== null && s !== SLUG.A)).toEqual([]);
    expect(mine.parity.map((x) => x.tenant).filter((s) => s !== SLUG.A)).toEqual([]);
    // MAX belongs to tenant A and to the copy, so the copy's jobs are his to see; tenant B's are not.
    const his = await w.client.request(w.browsers.max, 'GET', '/api/ai/reconfig');
    expect(his.status).toBe(200);
    const listed = his.json as { jobs: { id: string; tenant: string | null }[] };
    expect([...new Set(listed.jobs.map((j) => j.tenant))].filter((s) => s !== null && s !== SLUG.A && s !== SLUG.C)).toEqual([]);
    expect(listed.jobs.map((j) => j.id)).not.toContain(other.B.aiJob);
    expect(his.text).not.toContain(SLUG.B);
    expect(his.text).not.toContain(TENANT_ID.B);
    await p.unchanged('the job list of a user of two tenants');
  },
  'GET /api/ai/reconfig/:id': async (p) => {
    await p.own('its own job', 'ana', 'GET', `/api/ai/reconfig/${A.aiJob}`);
    for (const t of OTHERS) {
      await p.refused(`the job of tenant ${t}`, 'ana', 'GET', `/api/ai/reconfig/${other[t].aiJob}`, undefined, [other[t].aiJob]);
      if (t === 'B') await p.refused('the job of tenant B, by a member of A and the copy', 'max', 'GET', `/api/ai/reconfig/${other.B.aiJob}`, undefined, [other.B.aiJob]);
    }
  },
  'POST /api/ai/reconfig/:id/apply': async (p) => {
    // Its own job is queued, not in review: a 409 from its own tenant, which is the answer that proves it was read.
    await p.own('apply of its own job', 'ana', 'POST', `/api/ai/reconfig/${A.aiJob}/apply`, json({ drafts: ['seed'] }), [409]);
    for (const t of OTHERS) {
      const body = json({ drafts: ['seed'] });
      await p.refused(`apply of tenant ${t}'s job`, 'ana', 'POST', `/api/ai/reconfig/${other[t].aiJob}/apply`, body, [other[t].aiJob]);
      if (t === 'B') await p.refused("apply of tenant B's job, by a member of A and the copy", 'max', 'POST', `/api/ai/reconfig/${other.B.aiJob}/apply`, body, [other.B.aiJob]);
    }
  },
};

// ---------------------------------------------------------------------------------- tests

/** The routes of the composed server (`startServer`), as `METHOD path`; middleware (`ALL`) is not a route. */
const routerRoutes = (): string[] => [...new Set(stack.server.app.routes.filter((r) => r.method !== 'ALL').map((r) => `${r.method} ${r.path}`))];

describe('route list is read from the server router so a new route without a case fails the test (test)', () => {
  it('every route of the composed server has a leak case, and every case a route', () => {
    const routes = routerRoutes();
    expect(routes.length).toBeGreaterThan(20);
    expect(routes.filter((r) => !(r in CASES)), 'routes without a case in CASES (test/leak/leak.routes.spec.ts)').toEqual([]);
    expect(Object.keys(CASES).filter((k) => !routes.includes(k)), 'cases whose route is gone').toEqual([]);
    // the WS session is a route too: its handshake is in the list and the session has its own test below
    expect(routes).toContain('GET /ws/session');
  });
});

describe('three tenants (aa, zz, a copy); every REST route and the WS session as tenant A never return or write rows of other tenants (G7)', () => {
  it('B and C have rows in every tenant table, and are recognisable by their values', () => {
    const empty = OTHERS.flatMap((t) => [...w.last[t]].filter(([, d]) => d.startsWith('0:')).map(([name]) => `${t}.${name}`));
    expect(empty, 'tenant tables without a row of B or C: make the other tenants write one in act()').toEqual([]);
    expect([...w.markers.uuids.keys()]).toEqual(expect.arrayContaining([TENANT_ID.B, TENANT_ID.C, other.B.fork, other.C.fork, other.C.presetC, other.C.queuedRun]));
    expect([...w.markers.strings.keys()]).toEqual(expect.arrayContaining(['Zz Synthetic Test Airline', COPY_NAME, SLUG.C, 'zz-only renamed', 'aa-copy-only vendor']));
    expect([...w.markers.numbers.keys()]).toEqual(expect.arrayContaining([EDIT.B.pin, EDIT.C.pin, EDIT.C.def]));
  });

  it('the oracle sees a leak: tenant B\'s own answer is flagged, and so is a write to tenant B\'s rows (control)', async () => {
    const p = new Probe(w);
    // what tenant B gets on its own data, judged as if it had come back to tenant A: that is what a leak looks like
    const theirs = await w.client.request(w.browsers.bob, 'GET', at(SLUG.B, `/scenarios/${other.B.fork}/inputs`));
    expect(theirs.status).toBe(200);
    await p.scan("tenant B's own answer", theirs.text, [theirs.json], new Set());
    expect(p.problems.join('\n'), 'the markers no longer recognise another tenant\'s rows').toMatch(/returned other tenants' data/);
    // and the digests notice a change to tenant B's rows (here one tenant B makes itself)
    const before = p.problems.length;
    const list = okJson<{ scenarios: { id: string; version: number }[] }>(await w.client.request(w.browsers.bob, 'GET', at(SLUG.B, '/scenarios')), 200).scenarios;
    okJson(
      await w.client.request(w.browsers.bob, 'POST', at(SLUG.B, '/changesets'), json({
        scenarioId: other.B.fork,
        baseVersion: list.find((s) => s.id === other.B.fork)!.version,
        changes: [{ target: 'variable', key: 'g.target_net', member: '', value: 105.55519 }],
      })),
      200,
    );
    await p.unchanged('a write by tenant B itself');
    expect(p.problems.slice(before).join('\n'), 'the digests no longer notice a change to another tenant\'s rows').toMatch(
      /changed rows of tenant B .*changeset/s,
    );
  }, 120_000);

  for (const [route, run] of Object.entries(CASES)) {
    it(route, async () => {
      const p = new Probe(w);
      await run(p);
      expect(p.calls).toBeGreaterThan(0);
      expect(p.problems).toEqual([]);
    }, 300_000);
  }

  it('WS /ws/session: handshakes and `open` aimed at B or C are refused like unknown ids; no frame of B or C reaches tenant A, none of A reaches them', async () => {
    const p = new Probe(w);
    const { client, browsers } = w;
    const problems = p.problems;

    // --- handshakes aimed at the other tenants
    const refused = async (label: string, user: UserName, tenant: string, scenario: string, twin: { tenant: string; scenario: string }): Promise<void> => {
      const r = await client.socket(browsers[user], tenant, scenario);
      const t = await client.socket(browsers[user], twin.tenant, twin.scenario);
      for (const x of [r, t]) if (x.ok) {
        problems.push(`${label} [${user}]: the handshake was accepted`);
        await x.socket.close();
      }
      if (r.ok || t.ok) return;
      if (r.status !== 404) problems.push(`${label} [${user}]: answered ${r.status}, expected 404: ${r.body}`);
      const mask = (b: string): string => b.split(scenario).join('<id>').split(twin.scenario).join('<id>').replace(/"instance":"[^"]*"/, '');
      if (r.status !== t.status || mask(r.body) !== mask(t.body)) problems.push(`${label} [${user}]: refused unlike an unknown id: ${r.body} <> ${t.body}`);
      await p.scan(`${label} [${user}]`, r.body, [JSON.parse(r.body) as unknown], requestTokens(`/?tenant=${tenant}&scenario=${scenario}`, undefined));
      await p.unchanged(label);
    };
    const unknown = (): string => randomUUID();
    for (const t of OTHERS) {
      await refused(`handshake on tenant ${t}'s scenario under tenant A`, 'ana', SLUG.A, other[t].fork, { tenant: SLUG.A, scenario: unknown() });
      await refused(`handshake on tenant ${t}'s scenario under tenant A`, 'max', SLUG.A, other[t].presetC, { tenant: SLUG.A, scenario: unknown() });
      await refused(`handshake on tenant ${t} by a non-member`, 'ana', SLUG[t], other[t].fork, { tenant: `no-such-${unknown().slice(0, 8)}`, scenario: other[t].fork });
    }
    await refused('handshake on tenant B by a non-member', 'max', SLUG.B, other.B.fork, { tenant: `no-such-${unknown().slice(0, 8)}`, scenario: other.B.fork });

    // --- sessions: tenant A (ana, and max in A), B (bob), C (cleo, and max in the copy)
    const open = async (user: UserName, tenant: string, scenario: string): Promise<TestSocket> => {
      const r = await client.socket(browsers[user], tenant, scenario);
      if (!r.ok) throw new Error(`session of ${user} on ${tenant}/${scenario} refused: ${r.status} ${r.body}`);
      return r.socket;
    };
    const sA = await open('ana', SLUG.A, A.fork);
    const sMaxA = await open('max', SLUG.A, A.fork);
    const sB = await open('bob', SLUG.B, other.B.fork);
    const sC = await open('cleo', SLUG.C, other.C.fork);
    const sMaxC = await open('max', SLUG.C, other.C.fork);
    const all = [sA, sMaxA, sB, sC, sMaxC];
    const cells = A.outputs.length > 0 ? A.outputs : ['res.net[]'];
    for (const s of all) {
      s.send({ v: WS_PROTOCOL_VERSION, type: 'subscribe', cells });
      await s.until((m) => m.type === 'snapshot'); // job frames of the session's own tenant may come first
      for (const view of viewNames) {
        s.send({ v: WS_PROTOCOL_VERSION, type: 'subscribeView', view, params: view === 'baseline.groups' ? { by: BaselineGroupBy.options[1] } : {} });
        await s.until((m) => (m.type === 'view' && m.view === view) || m.type === 'error');
      }
    }
    await p.unchanged('sessions opened');

    // --- tenant A asks its sessions to open the other tenants' scenarios: an error frame like an unknown id
    for (const [s, user] of [[sA, 'ana'], [sMaxA, 'max']] as const) {
      for (const id of [other.B.fork, other.C.fork, other.C.presetC, unknown()]) {
        s.send({ v: WS_PROTOCOL_VERSION, type: 'open', scenarioId: id });
        const frames = await s.until((m) => m.type === 'error' || m.type === 'snapshot');
        const last = frames.at(-1)!;
        if (last.type !== 'error' || last.problem.status !== 404) problems.push(`open ${id} in tenant A's session [${user}]: ${JSON.stringify(last)}`);
      }
    }
    await p.unchanged('open of other tenants\' scenarios');
    // tenant A previews on its own scenario (a scratch evaluation; nothing is written)
    sA.send({ v: WS_PROTOCOL_VERSION, type: 'preview', seq: 1, changes: [{ var: 'g.target_net', member: '', value: OWN.preview }] });
    await sA.until((m) => (m.type === 'delta' && m.seq === 1) || m.type === 'error');
    await p.unchanged('preview');

    // --- B and C commit, and their solver jobs move: their own sessions hear of it (the control)
    const commit = async (user: UserName, slug: string, scenario: string, value: number): Promise<string> => {
      const list = okJson<{ scenarios: { id: string; version: number }[] }>(await client.request(browsers[user], 'GET', at(slug, '/scenarios')), 200).scenarios;
      const v = list.find((s) => s.id === scenario)!.version;
      const r = okJson<{ changesetId: string }>(
        await client.request(browsers[user], 'POST', at(slug, '/changesets'), json({ scenarioId: scenario, baseVersion: v, changes: [{ target: 'variable', key: 'g.target_net', member: '', value }] })),
        200,
      );
      return r.changesetId;
    };
    const heard = (s: TestSocket, changesetId: string) => s.until((m) => m.type === 'changeset' && m.changesetId === changesetId);
    const csB = await commit('bob', SLUG.B, other.B.fork, EDIT.B.again);
    await heard(sB, csB);
    const csC = await commit('cleo', SLUG.C, other.C.fork, EDIT.C.net);
    await heard(sC, csC);
    await heard(sMaxC, csC);
    const csMax = await commit('max', SLUG.C, other.C.fork, EDIT.C.again);
    await heard(sC, csMax);
    await heard(sMaxC, csMax);
    for (const t of OTHERS) {
      await withTenant(stack.app.db, TENANT_ID[t], (t === 'B' ? USERS.bob : USERS.cleo).id, (tx) =>
        tx.execute(sql`update solver_run set status = 'running', progress = 0.5, progress_note = ${`${SLUG[t]}-only progress`} where id = ${other[t].queuedRun}::uuid`),
      );
    }
    await sB.until((m) => m.type === 'job' && m.id === other.B.queuedRun && m.status === 'running');
    await sC.until((m) => m.type === 'job' && m.id === other.C.queuedRun && m.status === 'running');
    await rebaseline();

    // --- tenant A commits and its job moves: A's sessions hear of it (the control), B's and C's must not
    const csA = await commit('ana', SLUG.A, A.fork, OWN.again);
    await heard(sA, csA);
    await heard(sMaxA, csA);
    await withTenant(stack.app.db, TENANT_ID.A, USERS.ana.id, (tx) =>
      tx.execute(sql`update solver_run set status = 'running', progress = 0.25 where id = ${A.queuedRun}::uuid`),
    );
    await sA.until((m) => m.type === 'job' && m.id === A.queuedRun && m.status === 'running');
    await p.unchanged("tenant A's commit and job");
    // a few relay ticks (50 ms each) for anything that should not come
    await new Promise((r) => setTimeout(r, 600));

    // --- every frame tenant A's sessions received: nothing of B or C
    const both = await buildMarkers();
    w.markers = both.others;
    const sentByA = new Set<string>([other.B.fork, other.C.fork, other.C.presetC]);
    const own = new Set([A.fork]);
    for (const [s, user] of [[sA, 'ana'], [sMaxA, 'max']] as const) {
      for (const [i, m] of s.received.entries()) {
        await p.scan(`frame ${i} (${m.type}) of ${user}'s session in tenant A`, JSON.stringify(m), [m], sentByA);
        const scenarioId = (m as { scenarioId?: string }).scenarioId;
        if ((m.type === 'changeset' || m.type === 'snapshot') && scenarioId !== undefined && !own.has(scenarioId)) problems.push(`${user}'s session in tenant A got ${JSON.stringify(m).slice(0, 200)}`);
        if (m.type === 'job' && m.id !== A.queuedRun) problems.push(`${user}'s session in tenant A got a job it does not own: ${JSON.stringify(m)}`);
      }
    }
    // --- and nothing of tenant A reached B's or C's sessions (max's copy session included)
    for (const [s, label] of [[sB, "bob's session in tenant B"], [sC, "cleo's session in the copy"], [sMaxC, "max's session in the copy"]] as const) {
      for (const [i, m] of s.received.entries()) {
        const hits = both.ownOnly.find(JSON.stringify(m), [m]);
        if (hits.length > 0) problems.push(`frame ${i} (${m.type}) of ${label} carries tenant A's ${hits.map((h) => `${JSON.stringify(h.value)} (${h.source.table})`).join(', ')}`);
        if (m.type === 'changeset' && (m.changesetId === csA || m.scenarioId === A.fork)) problems.push(`${label} heard tenant A's commit`);
      }
    }
    for (const s of all) await s.close();
    expect(problems).toEqual([]);
  }, 300_000);
});
