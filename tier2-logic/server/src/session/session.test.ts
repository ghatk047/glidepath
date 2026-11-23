import { TenantSlug, UserId, WS_PROTOCOL_VERSION, parseServerMessage, problemTypes } from '@glidepath/api-contract';
import type { CellKey as WireCell, ServerMessage } from '@glidepath/api-contract';
import type { VariableDef } from '@glidepath/spec';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { toEngineCell } from './cells';
import type { ScenarioState } from './loader';
import { ModelCache } from './model-cache';
import { Session } from './session';
import { SEED_TENANT, goldenCells, matchesGolden, seedLoader } from './testing/seed';
import type { SeedLoader } from './testing/seed';

/**
 * Session core without a socket or database: the seed tenant's presets through a ModelCache, a manual
 * scheduler for the preview queue (so "a burst" is exact), every outgoing frame checked against the contract.
 */

const v = WS_PROTOCOL_VERSION;
const user = UserId.parse('user-1');
const tenant = { tenantId: SEED_TENANT, slug: TenantSlug.parse('t1'), role: 'viewer' as const };

let loader: SeedLoader;
let presetC: ScenarioState;
const sentFrames: ServerMessage[] = [];
let runs: (() => void)[] = [];
let session: Session;

const tick = () => {
  const due = runs;
  runs = [];
  for (const run of due) run();
};

function open(state: ScenarioState = presetC): Session {
  sentFrames.length = 0;
  runs = [];
  return new Session({
    userId: user,
    tenant,
    state,
    loader,
    schedule: (run) => void runs.push(run),
    send: (m) => {
      const parsed = parseServerMessage(JSON.parse(JSON.stringify(m)));
      if (!parsed.ok) throw new Error(`server frame breaks the contract: ${parsed.detail}`);
      sentFrames.push(parsed.message);
    },
  });
}

const frames = <T extends ServerMessage['type']>(type: T) =>
  sentFrames.filter((m): m is Extract<ServerMessage, { type: T }> => m.type === type);
const last = () => sentFrames[sentFrames.length - 1];
const settle = () => new Promise((r) => setTimeout(r, 0));

const variable = (id: string): VariableDef => {
  const def = loader.bundle.variables.find((x) => x.id === id);
  if (!def || def.min === null || def.max === null || def.step === null) throw new Error(`no bounded variable ${id}`);
  return def;
};
/** The k-th position of a variable's slider grid (registry min/step), wrapping before max. */
const grid = (def: VariableDef, k: number): number => {
  const steps = Math.round((def.max! - def.min!) / def.step!);
  return def.min! + (k % (steps + 1)) * def.step!;
};
/** First member of a dimension in the seed (spec order). */
const firstMember = (dim: string): string => {
  const m = presetC.model.members[dim]?.[0];
  if (!m) throw new Error(`no member of ${dim}`);
  return m.id;
};

const TARGET = 'g.target_net';
const CONF = 'lev.conf';

beforeAll(async () => {
  loader = await seedLoader();
  const state = await loader.load({ tenantId: SEED_TENANT, userId: user }, 'C');
  if (!state) throw new Error('no preset C');
  presetC = state;
});

beforeEach(() => {
  session = open();
});

describe('subscribe → snapshot', () => {
  it('answers a snapshot of only the subscribed cells, at the scenario and version, golden C within 1e-6', () => {
    const golden = goldenCells('C');
    const cells = [...golden.keys()];
    session.receive({ v, type: 'subscribe', cells });
    const snap = frames('snapshot');
    expect(snap).toHaveLength(1);
    expect(snap[0]!.scenarioId).toBe('C');
    expect(snap[0]!.version).toBe(0);
    expect(Object.keys(snap[0]!.cells).sort()).toEqual([...cells].sort());
    for (const [cell, expected] of golden) {
      const got = snap[0]!.cells[cell];
      expect(got, cell).not.toBeNull();
      expect(matchesGolden(got!, expected), `${cell}: ${got} vs golden ${expected}`).toBe(true);
    }

    session.receive({ v, type: 'subscribe', cells: ['res.net[]', 'nope.unknown[]'] });
    expect(last()).toEqual({ v, type: 'snapshot', scenarioId: 'C', version: 0, cells: { 'res.net[]': snap[0]!.cells['res.net[]' as WireCell], 'nope.unknown[]': null } });
  });

  it('pushes an input cell by its wire key (scalar `id[]`, dimensioned `id[member]`)', () => {
    const lever = firstMember('lever');
    session.receive({ v, type: 'subscribe', cells: [`${TARGET}[]`, `${CONF}[${lever}]`] });
    const cells = frames('snapshot')[0]!.cells;
    expect(cells[`${TARGET}[]` as WireCell]).toBe(presetC.committed.get(TARGET));
    expect(cells[`${CONF}[${lever}]` as WireCell]).toBe(presetC.committed.get(`${CONF}[${lever}]`));
  });
});

describe('preview coalescing (100 rapid previews)', () => {
  it('runs one rerun on a scratch copy for a burst; latest seq per cell wins; answered once with the highest seq', () => {
    const target = variable(TARGET);
    const conf = variable(CONF);
    const lever = firstMember('lever');
    const subscribed = ['res.target[]', 'res.gap[]', 'res.net[]', 'base.total[]', `${TARGET}[]`] as WireCell[];
    session.receive({ v, type: 'subscribe', cells: subscribed });
    const known = new Map(Object.entries(frames('snapshot')[0]!.cells));
    sentFrames.length = 0;

    let lastTarget = NaN;
    let lastConf = NaN;
    for (let seq = 1; seq <= 100; seq++) {
      // Odd seqs drag the target, even seqs the lever; every 10th moves both at once (atomic pair).
      const changes =
        seq % 10 === 0
          ? [
              { var: TARGET, member: '', value: (lastTarget = grid(target, seq)) },
              { var: CONF, member: lever, value: (lastConf = grid(conf, seq)) },
            ]
          : seq % 2 === 1
            ? [{ var: TARGET, member: '', value: (lastTarget = grid(target, seq)) }]
            : [{ var: CONF, member: lever, value: (lastConf = grid(conf, seq)) }];
      session.receive({ v, type: 'preview', seq, changes });
    }
    expect(sentFrames).toEqual([]); // queued until the frames received so far are handled
    tick();

    expect(session.counters).toMatchObject({ previews: 100, reruns: 1, rejected: 0 });
    expect(frames('delta').map((d) => d.seq)).toEqual([100]);
    // The scratch holds the latest value of every previewed cell; the committed evaluation is untouched.
    expect(session.current.get(TARGET)).toBe(lastTarget);
    expect(session.current.get(`${CONF}[${lever}]`)).toBe(lastConf);
    expect(session.scenario.committed).toBe(presetC.committed);
    expect(presetC.committed.get(TARGET)).toBe(presetC.committed.values.get(TARGET));

    // Bitwise what a full evaluate of committed + latest cells gives.
    const values = new Map(presetC.committed.values);
    values.set(TARGET, lastTarget);
    values.set(`${CONF}[${lever}]`, lastConf);
    const full = presetC.model.model.evaluate(values, presetC.committed.overrides);
    const delta = frames('delta')[0]!.cells;
    for (const cell of subscribed) {
      const now = full.get(toEngineCell(cell));
      if (Object.is(now, known.get(cell))) expect(delta, `${cell} did not change`).not.toHaveProperty(cell);
      else expect(delta[cell], cell).toBe(now);
    }
    expect(Object.keys(delta).every((c) => subscribed.includes(c as WireCell))).toBe(true);
    expect(delta).toHaveProperty(['res.target[]']);
    expect(delta).not.toHaveProperty(['base.total[]']);
  });

  it('answers each separate rerun with its own seq and only cells that changed since the last push', () => {
    const target = variable(TARGET);
    session.receive({ v, type: 'subscribe', cells: ['res.target[]', 'base.total[]'] });
    const committedTarget = presetC.committed.get(TARGET);
    const other = grid(target, 0) === committedTarget ? grid(target, 1) : grid(target, 0);

    session.receive({ v, type: 'preview', seq: 1, changes: [{ var: TARGET, member: '', value: other }] });
    tick();
    session.receive({ v, type: 'preview', seq: 2, changes: [{ var: TARGET, member: '', value: other }] });
    tick();
    session.receive({ v, type: 'preview', seq: 3, changes: [{ var: TARGET, member: '', value: committedTarget }] });
    tick();
    const deltas = frames('delta');
    expect(deltas.map((d) => d.seq)).toEqual([1, 2, 3]);
    expect(Object.keys(deltas[0]!.cells)).toEqual(['res.target[]']);
    expect(deltas[1]!.cells).toEqual({}); // same value again: nothing changed for the client
    expect(deltas[2]!.cells).toEqual({ 'res.target[]': presetC.committed.get('res.target') });
  });

  it('cancelPreview voids queued previews and the scratch and sends back the committed values (empty when none differ)', () => {
    const target = variable(TARGET);
    const committedTarget = presetC.committed.get(TARGET);
    const other = grid(target, 0) === committedTarget ? grid(target, 1) : grid(target, 0);
    session.receive({ v, type: 'subscribe', cells: ['res.target[]'] });

    session.receive({ v, type: 'preview', seq: 1, changes: [{ var: TARGET, member: '', value: other }] });
    tick();
    session.receive({ v, type: 'preview', seq: 2, changes: [{ var: TARGET, member: '', value: other + target.step! }] });
    session.receive({ v, type: 'cancelPreview', seq: 3 });
    tick(); // the voided preview 2 never runs
    expect(frames('delta').map((d) => d.seq)).toEqual([1, 3]);
    expect(frames('delta')[1]!.cells).toEqual({ 'res.target[]': presetC.committed.get('res.target') });
    expect(session.current).toBe(presetC.committed);

    session.receive({ v, type: 'cancelPreview', seq: 4 });
    expect(last()).toEqual({ v, type: 'delta', seq: 4, cells: {} });
  });

  it('runs queued previews before another frame, so answers keep the order of the requests', () => {
    const target = variable(TARGET);
    session.receive({ v, type: 'subscribe', cells: ['res.target[]'] });
    session.receive({ v, type: 'preview', seq: 1, changes: [{ var: TARGET, member: '', value: grid(target, 3) }] });
    session.receive({ v, type: 'subscribe', cells: [`${TARGET}[]`] });
    expect(sentFrames.map((m) => m.type)).toEqual(['snapshot', 'delta', 'snapshot']);
    // A cell subscribed during a preview shows the value the client sees now (the scratch).
    expect(last()).toMatchObject({ type: 'snapshot', cells: { [`${TARGET}[]`]: grid(target, 3) } });
    tick();
    expect(session.counters.reruns).toBe(1);
  });

  it('unsubscribed cells are never pushed', () => {
    const target = variable(TARGET);
    session.receive({ v, type: 'subscribe', cells: ['res.target[]', 'res.gap[]'] });
    session.receive({ v, type: 'unsubscribe', cells: ['res.gap[]'] });
    session.receive({ v, type: 'preview', seq: 1, changes: [{ var: TARGET, member: '', value: grid(target, 2) }] });
    tick();
    expect(Object.keys(frames('delta')[0]!.cells)).not.toContain('res.gap[]');
  });
});

describe('rejected frames: error{problem}, state unchanged', () => {
  const expectError = (status: number, detail?: RegExp) => {
    const m = last();
    expect(m?.type).toBe('error');
    if (m?.type !== 'error') return;
    expect(m.problem.status).toBe(status);
    if (detail) expect(m.problem.detail).toMatch(detail);
  };

  it('bad JSON, unknown type, malformed body: 400 with the parser detail', () => {
    session.receive('{nope');
    expectError(400, /not JSON/);
    session.receive({ v, type: 'teleport' });
    expectError(400);
    session.receive({ v: 2, type: 'subscribe', cells: ['res.net[]'] });
    expectError(400);
    expect((last() as Extract<ServerMessage, { type: 'error' }>).problem.type).toBe(problemTypes.badRequest);
  });

  it('seq must increase across preview and cancelPreview', () => {
    session.receive({ v, type: 'cancelPreview', seq: 5 });
    session.receive({ v, type: 'preview', seq: 5, changes: [{ var: TARGET, member: '', value: 1 }] });
    expectError(400, /not above 5/);
    session.receive({ v, type: 'cancelPreview', seq: 2 });
    expectError(400, /not above 5/);
  });

  it('a preview naming an unknown variable, a wrong member arity or an unknown member is refused whole', () => {
    const lever = firstMember('lever');
    session.receive({ v, type: 'subscribe', cells: ['res.target[]'] });
    session.receive({ v, type: 'preview', seq: 1, changes: [{ var: TARGET, member: '', value: 120 }, { var: 'res.net', member: '', value: 1 }] });
    expectError(422, /not an input variable/);
    session.receive({ v, type: 'preview', seq: 2, changes: [{ var: CONF, member: '', value: 0.5 }] });
    expectError(422, /member key of 1 part/);
    session.receive({ v, type: 'preview', seq: 3, changes: [{ var: CONF, member: `${lever},x`, value: 0.5 }] });
    expectError(422, /member key of 1 part/);
    session.receive({ v, type: 'preview', seq: 4, changes: [{ var: CONF, member: 'no_such_lever', value: 0.5 }] });
    expectError(422, /not a member of lever/);
    tick();
    expect(session.counters).toMatchObject({ previews: 0, reruns: 0, rejected: 4 });
    expect(session.current).toBe(presetC.committed);
  });

  it('view subscriptions are refused until views are served (API-12)', () => {
    session.receive({ v, type: 'subscribeView', view: 'bridge', params: {} });
    expectError(501, /bridge/);
  });
});

describe('open{scenarioId}', () => {
  it('switches scenario: drops the scratch, keeps subscriptions, answers a snapshot of every subscribed cell', async () => {
    const target = variable(TARGET);
    session.receive({ v, type: 'subscribe', cells: ['res.net[]', 'res.gap[]'] });
    session.receive({ v, type: 'preview', seq: 1, changes: [{ var: TARGET, member: '', value: grid(target, 1) }] });
    tick();
    session.receive({ v, type: 'open', scenarioId: 'rates' });
    session.receive({ v, type: 'preview', seq: 2, changes: [{ var: TARGET, member: '', value: grid(target, 2) }] });
    await settle();
    tick();
    const golden = goldenCells('rates');
    const snap = frames('snapshot').at(-1)!;
    expect(snap.scenarioId).toBe('rates');
    expect(Object.keys(snap.cells).sort()).toEqual(['res.gap[]', 'res.net[]']);
    expect(matchesGolden(snap.cells['res.net[]' as WireCell]!, golden.get('res.net[]' as WireCell)!)).toBe(true);
    // The preview sent after `open` waited for it and applies to the new scenario.
    expect(sentFrames.map((m) => m.type)).toEqual(['snapshot', 'delta', 'snapshot', 'delta']);
    expect(session.scenarioId).toBe('rates');
    expect(session.current.get(TARGET)).toBe(grid(target, 2));
    // Same tenant, model version and members: the same compiled model.
    expect(session.scenario.model).toBe(presetC.model);
  });

  it('an unknown scenario is an error and the session stays where it was', async () => {
    session.receive({ v, type: 'subscribe', cells: ['res.net[]'] });
    session.receive({ v, type: 'open', scenarioId: 'nope' });
    await settle();
    expect(last()).toMatchObject({ type: 'error', problem: { status: 404 } });
    expect(session.scenarioId).toBe('C');
  });
});

describe('ModelCache sharing across sessions', () => {
  it('two loads of one scenario share the compiled model and the committed evaluation', async () => {
    const models = new ModelCache();
    const l = await seedLoader(models);
    const scope = { tenantId: SEED_TENANT, userId: user };
    const [a, b] = await Promise.all([l.load(scope, 'C'), l.load(scope, 'C')]);
    expect(a!.model).toBe(b!.model);
    expect(a!.committed).toBe(b!.committed);
    expect(models.stats()).toMatchObject({ misses: 1, hits: 1, compiles: 1, evaluations: 1, evaluationHits: 1 });
  });
});
