import { PROBLEM_CONTENT_TYPE, UserId, assertContract } from '@glidepath/api-contract';
import type { SearchResponse } from '@glidepath/api-contract';
import { aaSeed, specBundle } from '@glidepath/testkit';
import type { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../app/app';
import type { AppEnv } from '../../app/tenant';
import { captureLogger } from '../../app/testing/fixtures';
import { specBundleFromDir } from '../read/spec-source';
import { ANA, BOB, CAROL, MINE, ZZ_SCENARIO, asUser, presetId, startAaDatabase } from '../read/testing/aa-db';
import type { AaDatabase } from '../read/testing/aa-db';
import { TOP_DRIVERS, UPSTREAM_LIMIT } from './explain';
import { MAX_RESULTS } from './search';

let env: AaDatabase;
let app: Hono<AppEnv>;

const ana = asUser(ANA);
const bob = asUser(BOB);
const get = (path: string, init: { headers: Record<string, string> } = ana) => app.request(path, { headers: init.headers });
const explainPath = (tenant: string, cell: string, scenario: string) =>
  `/api/t/${tenant}/nodes/${encodeURIComponent(cell)}/explain?scenario=${scenario}`;
const searchPath = (tenant: string, q: string) => `/api/t/${tenant}/search?q=${encodeURIComponent(q)}`;
const searchOf = async (q: string, init = ana, tenant = 'aa'): Promise<SearchResponse> =>
  assertContract('search', await get(searchPath(tenant, q), init));

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

describe('GET nodes/:cell/explain', () => {
  it('explain returns value, node id, formula in words, upstream chain, top drivers, pinned flag (res.net)', async () => {
    const res = await get(explainPath('aa', 'res.net[]', presetId('C')));
    const body = await assertContract('nodeExplain', res);
    const spec = await specBundle();
    const node = spec.nodes.find((n) => n.id === 'res.net')!;
    const golden = (await import('../../../../../docs/spec/reference/golden_results.json', { with: { type: 'json' } })).default;

    expect(body.cell).toBe('res.net[]');
    expect(body.node).toBe('res.net');
    expect(body.member).toBe('');
    expect(body.label).toBe(node.label);
    expect(body.unit).toBe(node.unit);
    // Value: the engine's evaluation of preset C equals the golden results (1e-6 relative; the file holds 6 decimals).
    const expected = (golden.scenarios.C as unknown as Record<string, number>)['res.net']!;
    expect(Math.abs(body.value! - expected)).toBeLessThanOrEqual(Math.max(1e-6 * Math.abs(expected), 1e-6));
    // Formula: the spec expression and its words, built from spec labels.
    expect(body.expression).toBe(node.expr);
    expect(body.words.length).toBeGreaterThan(0);
    expect(body.words).not.toContain('\n');
    // Upstream chain: nearest first, depth from 1, labels and units from the spec, capped.
    expect(body.upstream.length).toBeGreaterThan(0);
    expect(body.upstream.length).toBeLessThanOrEqual(UPSTREAM_LIMIT);
    expect(body.upstream[0]!.depth).toBe(1);
    expect(body.upstream.map((u) => u.depth)).toEqual([...body.upstream.map((u) => u.depth)].sort((a, b) => a - b));
    for (const u of body.upstream) {
      const s = spec.nodes.find((n) => n.id === u.cell.split('[')[0]) ?? spec.variables.find((v) => v.id === u.cell.split('[')[0]);
      expect(u.label).toBe(s!.label);
      expect(u.unit).toBe(s!.unit);
    }
    // Top drivers: at most TOP_DRIVERS, by |impact| descending, labelled.
    expect(body.drivers.length).toBeGreaterThan(0);
    expect(body.drivers.length).toBeLessThanOrEqual(TOP_DRIVERS);
    const impacts = body.drivers.map((d) => Math.abs(d.impact));
    expect(impacts).toEqual([...impacts].sort((a, b) => b - a));
    expect(body.drivers.every((d) => d.label.length > 0)).toBe(true);
    // Pinned flag: preset C pins nothing.
    expect(body.override).toBeNull();
  });

  it('flags a pinned cell with its value and reason, and a pinned cell has no drivers', async () => {
    const spec = await specBundle();
    const pinned = spec.nodes.find((n) => n.dims.length === 0 && n.output)!;
    const body = await assertContract('nodeExplain', await get(explainPath('aa', `${pinned.id}[]`, MINE)));
    expect(body.override).toEqual({ value: 99.5, reason: 'CFO pin' });
    expect(body.value).toBe(99.5);
    expect(body.drivers).toEqual([]);
  });

  it('explains a dimensioned cell by its member (node id and member split, cell key kept)', async () => {
    const spec = await specBundle();
    const seed = await aaSeed();
    const node = spec.nodes.find((n) => n.output && n.dims.length === 1 && n.dims[0] === 'vp')!;
    const vp = (seed.dimensionMembers.vp ?? [])[0]!.id;
    const body = await assertContract('nodeExplain', await get(explainPath('aa', `${node.id}[${vp}]`, presetId('C'))));
    expect(body.node).toBe(node.id);
    expect(body.member).toBe(vp);
    expect(body.cell).toBe(`${node.id}[${vp}]`);
  });

  it('explains an input cell: its words, no expression, no drivers', async () => {
    const body = await assertContract('nodeExplain', await get(explainPath('aa', 'g.target_net[]', presetId('C'))));
    expect(body.node).toBe('g.target_net');
    expect(body.expression).toBeNull();
    expect(body.words).toMatch(/^Input: /);
    expect(body.upstream).toEqual([]);
    expect(body.drivers).toEqual([]);
  });

  it('answers 404 for an unknown cell or scenario, 422 for a malformed one, 404 for another tenant, 401 signed out', async () => {
    const notFound = await get(explainPath('aa', 'no.such.node[]', presetId('C')));
    expect(notFound.status).toBe(404);
    expect(notFound.headers.get('content-type')).toContain(PROBLEM_CONTENT_TYPE);
    expect((await get(explainPath('aa', 'res.net[]', '00000000-0000-4000-8000-0000000000ff'))).status).toBe(404);
    expect((await get(explainPath('aa', 'res.net', presetId('C')))).status).toBe(422);
    expect((await get('/api/t/aa/nodes/res.net%5B%5D/explain')).status).toBe(422);
    // zz's scenario is not aa's; bob has no membership of aa.
    expect((await get(explainPath('aa', 'res.net[]', ZZ_SCENARIO))).status).toBe(404);
    expect((await get(explainPath('aa', 'res.net[]', presetId('C')), bob)).status).toBe(404);
    expect((await app.request(explainPath('aa', 'res.net[]', presetId('C')))).status).toBe(401);
  });
});

describe('GET search?q=', () => {
  it('indexes 194 inputs, 17 levers, 98 output nodes, tenant lines and 11 screens', async () => {
    const spec = await specBundle();
    const seed = await aaSeed();
    const lines = (seed.dimensionMembers.line ?? []).length;
    expect(spec.variables).toHaveLength(194);
    expect(spec.nodes.filter((n) => n.output)).toHaveLength(98);
    // Every entry is found by its own id (an exact id match ranks first); count the kinds through ids.
    const kinds = new Map<string, number>();
    const probe = async (id: string, kind: string, tenant = 'aa', init = ana) => {
      const r = await searchOf(id, init, tenant);
      const hit = r.results.find((x) => x.id === id && x.kind === kind);
      if (hit) kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
      return hit;
    };
    for (const v of spec.variables) expect(await probe(v.id, 'input'), v.id).toBeDefined();
    for (const n of spec.nodes.filter((x) => x.output)) expect(await probe(n.id, 'node'), n.id).toBeDefined();
    for (const l of seed.dimensionMembers.lever ?? []) expect(await probe(l.id, 'lever'), l.id).toBeDefined();
    for (const s of ['cockpit', 'wizard', 'baseline', 'levers', 'vps', 'path', 'sourcing', 'plan', 'market', 'excel', 'airlines']) {
      expect(await probe(s, 'screen'), s).toBeDefined();
    }
    expect(kinds.get('input')).toBe(194);
    expect(kinds.get('node')).toBe(98);
    expect(kinds.get('lever')).toBe(17);
    expect(kinds.get('screen')).toBe(11);
    // A non-output node is not offered.
    const inner = spec.nodes.find((n) => !n.output)!;
    expect((await searchOf(inner.id)).results.find((r) => r.id === inner.id)).toBeUndefined();
    // Lines: the tenant's 415 baseline lines, each found by its member key.
    expect(lines).toBe(415);
    const sample = (seed.dimensionMembers.line ?? []).filter((_, i) => i % 40 === 0);
    for (const l of sample) expect(await probe(l.id, 'line'), l.id).toBeDefined();
  }, 120_000);

  it('returns at most 9 ranked results, each with kind and unit', async () => {
    const r = await searchOf('cost');
    expect(r.q).toBe('cost');
    expect(r.results.length).toBeGreaterThan(0);
    expect(r.results.length).toBeLessThanOrEqual(MAX_RESULTS);
    expect(r.results.every((x) => x.kind && 'unit' in x)).toBe(true);
    const spec = await specBundle();
    const input = (await searchOf('g.target_net')).results[0]!;
    expect(input).toMatchObject({ kind: 'input', id: 'g.target_net', unit: spec.variables.find((v) => v.id === 'g.target_net')!.unit });
    const node = (await searchOf('res.net')).results[0]!;
    expect(node).toMatchObject({ kind: 'node', id: 'res.net', unit: '$M', module: 'cockpit' });
    // limit narrows, never widens.
    expect((await assertContract('search', await get(`${searchPath('aa', 'cost')}&limit=3`))).results).toHaveLength(3);
    expect((await assertContract('search', await get(`${searchPath('aa', 'cost')}&limit=50`))).results.length).toBeLessThanOrEqual(MAX_RESULTS);
  });

  it("'COLA', 'cloud', 'headcount' return relevant first hits", async () => {
    const cola = await searchOf('COLA');
    expect(cola.results[0]!.label).toMatch(/COLA/);
    expect(cola.results[0]).toMatchObject({ kind: 'input', id: 'lev.L17.cola', module: 'levers' });
    const cloud = await searchOf('cloud');
    expect(cloud.results[0]!.label).toMatch(/cloud/i);
    expect(cloud.results.slice(0, 3).every((r) => /cloud/i.test(`${r.label} ${r.id}`))).toBe(true);
    const hc = await searchOf('headcount');
    expect(hc.results[0]!.label).toMatch(/headcount/i);
    expect(hc.results.every((r) => /headcount/i.test(`${r.label} ${r.hint ?? ''}`) || r.kind !== 'input')).toBe(true);
  });

  it('labels come from the bundle, lines from tier 3 for the caller\'s tenant only', async () => {
    const spec = await specBundle();
    const seed = await aaSeed();
    const line = (seed.dimensionMembers.line ?? [])[0]!;
    // aa: the line shows up by its name, with kind line, the baseline module and the pool amount unit.
    const mine = await searchOf(String(line.name));
    const hit = mine.results.find((r) => r.id === line.id)!;
    expect(hit).toMatchObject({ kind: 'line', label: String(line.name), module: 'baseline', unit: '$M' });
    // Labels of inputs are the bundle's.
    const v = spec.variables.find((x) => x.id === 'lev.L17.cola')!;
    expect((await searchOf('lev.L17.cola')).results[0]!.label).toBe(v.label);
    // zz pins the same model version but has no lines of its own: aa's lines never appear for it.
    const bobSees = await searchOf(String(line.name), bob, 'zz');
    expect(bobSees.results.filter((r) => r.kind === 'line')).toEqual([]);
    const zzLines = await searchOf('it_001', bob, 'zz');
    expect(zzLines.results.find((r) => r.id === line.id)).toBeUndefined();
    // zz's own members are its own: a lever or VP of aa is not offered to a stranger of aa.
    expect((await get(searchPath('aa', 'cola'), bob)).status).toBe(404);
    expect((await get(searchPath('aa', 'cola'), asUser(CAROL))).status).toBe(404);
  });

  it('answers 422 for an empty query and 401 signed out', async () => {
    expect((await get('/api/t/aa/search')).status).toBe(422);
    expect((await get('/api/t/aa/search?q=%20')).status).toBe(422);
    expect((await app.request('/api/t/aa/search?q=cola')).status).toBe(401);
  });
});
