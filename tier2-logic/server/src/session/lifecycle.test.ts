import { PREVIEW_MAX_PER_SECOND, TenantId, TenantSlug, UserId, WS_PROTOCOL_VERSION, parseServerMessage } from '@glidepath/api-contract';
import type { ChangesetId, ChangesetResult, ScenarioId, ServerMessage } from '@glidepath/api-contract';
import { validatePreview } from '@glidepath/domain';
import type { CellKey as EngineCell } from '@glidepath/engine';
import type { VariableDef } from '@glidepath/spec';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ChangeNotice } from '../routes/write/hub';
import { toViolation } from '../routes/write/errors';
import { broadcastChange } from './broadcast';
import type { ScenarioLoader, ScenarioState } from './loader';
import { Session } from './session';
import { FakeClock } from './testing/fake-clock';
import { SEED_TENANT, seedLoader } from './testing/seed';
import type { SeedLoader } from './testing/seed';
import { inputRows } from './warnings';

/**
 * API-07 on the session core, without a socket or database: the seed tenant's presets through a
 * ModelCache, a manual scheduler, a fake clock, every outgoing frame checked against the contract.
 * Commits are simulated by a loader that answers the committed scenario with changed inputs.
 */

const v = WS_PROTOCOL_VERSION;
const ana = UserId.parse('user-ana');
const bob = UserId.parse('user-bob');
const tenant = { tenantId: SEED_TENANT, slug: TenantSlug.parse('t1'), role: 'editor' as const };
const OTHER_TENANT = TenantId.parse('00000000-0000-4000-8000-0000000000bb');

const TARGET = 'g.target_net';
const CONF = 'lev.conf';

let seed: SeedLoader;
let target: VariableDef;
let lever: string;

/** Seed presets, with the commits made so far laid over them (version, changed input cells). */
class CommitLoader implements ScenarioLoader {
  readonly commits = new Map<string, { version: number; values: Map<EngineCell, number> }>();
  loads = 0;

  async load(scope: Parameters<ScenarioLoader['load']>[0], scenarioId: string): Promise<ScenarioState | null> {
    this.loads += 1;
    const base = this.commits.get(scenarioId);
    const from = await seed.load(scope, base ? (this.forks.get(scenarioId) ?? scenarioId) : scenarioId);
    if (!from) return null;
    if (!base) return from;
    const values = new Map(from.committed.values);
    for (const [cell, value] of base.values) values.set(cell, value);
    return {
      scenarioId: scenarioId as ScenarioId,
      version: base.version,
      model: from.model,
      committed: from.model.model.evaluate(values, from.committed.overrides),
    };
  }

  /** Fork id → the preset it was copied from. */
  readonly forks = new Map<string, string>();

  /** Commits `cells` on `scenarioId` and returns the notice the write route would send. */
  commit(scenarioId: string, cells: Record<string, number>, by = ana, forkOf?: string): ChangeNotice {
    const prev = this.commits.get(scenarioId) ?? { version: 0, values: new Map<EngineCell, number>() };
    const values = new Map(prev.values);
    for (const [cell, value] of Object.entries(cells)) values.set(cell, value);
    const version = prev.version + 1;
    this.commits.set(scenarioId, { version, values });
    if (forkOf) this.forks.set(scenarioId, forkOf);
    const result: ChangesetResult = {
      changesetId: `cs-${scenarioId}-${version}` as ChangesetId,
      scenarioId: scenarioId as ScenarioId,
      version,
      editsCount: version,
      inputHash: 'h' as ChangesetResult['inputHash'],
      outputs: {},
      warnings: [],
      ...(forkOf ? { forkedFrom: forkOf as ScenarioId } : {}),
    };
    return { tenantId: SEED_TENANT, kind: 'apply', result, origin: 'ui', author: { id: by, name: by } };
  }
}

interface Client {
  session: Session;
  frames: ServerMessage[];
  runs: (() => void)[];
  tick(): void;
  of<T extends ServerMessage['type']>(type: T): Extract<ServerMessage, { type: T }>[];
  clear(): void;
}

async function client(loader: ScenarioLoader, scenario: string, opts: { user?: UserId; clock?: FakeClock } = {}): Promise<Client> {
  const user = opts.user ?? ana;
  const state = await loader.load({ tenantId: SEED_TENANT, userId: user }, scenario);
  if (!state) throw new Error(`no scenario ${scenario}`);
  const frames: ServerMessage[] = [];
  const c: Client = {
    frames,
    runs: [],
    session: new Session({
      userId: user,
      tenant,
      state,
      loader,
      schedule: (run) => void c.runs.push(run),
      ...(opts.clock ? { clock: opts.clock } : {}),
      send: (m) => {
        const parsed = parseServerMessage(JSON.parse(JSON.stringify(m)));
        if (!parsed.ok) throw new Error(`server frame breaks the contract: ${parsed.detail}`);
        frames.push(parsed.message);
      },
    }),
    tick() {
      while (c.runs.length > 0) {
        const due = c.runs;
        c.runs = [];
        for (const run of due) run();
      }
    },
    of: (type) => frames.filter((m): m is Extract<ServerMessage, { type: typeof type }> => m.type === type) as never,
    clear: () => void (frames.length = 0),
  };
  return c;
}

const settle = () => new Promise((r) => setTimeout(r, 0));
/** A pushed cell value by its wire key. */
const cellOf = (m: { cells: Record<string, number | null> }, cell: string): number | null | undefined => m.cells[cell];
/** A value of `def` on its slider grid other than `not`. */
const other = (def: VariableDef, not: number): number => (def.min! === not ? def.min! + def.step! : def.min!);

beforeAll(async () => {
  seed = await seedLoader();
  const state = await seed.load({ tenantId: SEED_TENANT, userId: ana }, 'C');
  target = seed.bundle.variables.find((x) => x.id === TARGET)!;
  lever = state!.model.members.lever![0]!.id;
});

describe('preview warnings', () => {
  it('pushes DOM validatePreview results as `warnings` with the preview seq', async () => {
    const c = await client(new CommitLoader(), 'C');
    c.session.receive({ v, type: 'subscribe', cells: ['res.net[]'] });
    const above = target.max! + target.step!; // past the registry max: VR04 flags the scratch
    c.session.receive({ v, type: 'preview', seq: 7, changes: [{ var: TARGET, member: '', value: above }] });
    c.tick();

    const types = c.frames.map((m) => m.type);
    expect(types).toEqual(['snapshot', 'delta', 'warnings']); // the delta never waits on the rules
    const w = c.of('warnings')[0]!;
    expect(w.seq).toBe(7);
    // Exactly what DOM validatePreview says about the scratch state, in its order.
    const scratch = c.session.current;
    const model = c.session.scenario.model;
    const expected = validatePreview({
      bundle: model.bundle,
      members: model.members,
      values: inputRows(scratch),
      evaluation: scratch,
      upstream: (cell) => model.model.upstream(cell),
    }).map(toViolation);
    expect(w.violations).toEqual(expected);
    expect(w.violations).toContainEqual(expect.objectContaining({ rule: 'VR04', cells: [`${TARGET}[]`], severity: 'warning' }));
  });

  it('pushes again only when the list changes; a superseded scratch is never checked; cancelPreview clears them', async () => {
    const c = await client(new CommitLoader(), 'C');
    const above = target.max! + target.step!;
    c.session.receive({ v, type: 'preview', seq: 1, changes: [{ var: TARGET, member: '', value: above }] });
    c.session.receive({ v, type: 'subscribe', cells: ['res.net[]'] }); // runs the queue: delta 1, check queued
    c.session.receive({ v, type: 'preview', seq: 2, changes: [{ var: TARGET, member: '', value: above + target.step! }] });
    c.tick(); // the check of seq 1 finds preview 2 queued and leaves it to that rerun
    expect(c.of('warnings').map((w) => w.seq)).toEqual([2]);
    const flagged = c.of('warnings')[0]!.violations;

    c.session.receive({ v, type: 'preview', seq: 3, changes: [{ var: CONF, member: lever, value: c.session.current.get(`${CONF}[${lever}]`) }] });
    c.tick();
    expect(c.of('warnings')).toHaveLength(1); // same list: nothing new to show

    c.session.receive({ v, type: 'preview', seq: 4, changes: [{ var: TARGET, member: '', value: target.min! }] });
    c.tick();
    const back = c.of('warnings').at(-1)!;
    expect(back.seq).toBe(4);
    expect(back.violations).not.toContainEqual(expect.objectContaining({ cells: [`${TARGET}[]`] }));
    expect(back.violations.length).toBeLessThan(flagged.length);

    c.session.receive({ v, type: 'cancelPreview', seq: 5 });
    expect(c.frames.slice(-2)).toEqual([
      { v, type: 'delta', seq: 5, cells: expect.any(Object) },
      { v, type: 'warnings', seq: 5, violations: [] },
    ]);
    expect(c.session.warnings).toEqual([]);
  });
});

describe('commit broadcast', () => {
  it('every session on the scenario gets changeset{…} then delta{null} with the committed values; others get nothing', async () => {
    const loader = new CommitLoader();
    const one = await client(loader, 'C');
    const two = await client(loader, 'C', { user: bob });
    const elsewhere = await client(loader, 'D');
    for (const c of [one, two, elsewhere]) c.session.receive({ v, type: 'subscribe', cells: ['res.target[]', `${TARGET}[]`, 'base.total[]'] });
    for (const c of [one, two, elsewhere]) c.clear();

    const value = other(target, one.session.scenario.committed.get(TARGET));
    const notice = loader.commit('C', { [TARGET]: value });
    const reached = await broadcastChange([one.session, two.session, elsewhere.session], notice, loader);
    expect(reached).toBe(2);
    expect(loader.loads).toBe(4); // three opens + one read after the commit, shared by both sessions

    for (const c of [one, two]) {
      expect(c.frames.map((m) => m.type)).toEqual(['changeset', 'delta']);
      expect(c.frames[0]).toEqual({
        v,
        type: 'changeset',
        scenarioId: 'C',
        version: 1,
        editsCount: 1,
        changesetId: 'cs-C-1',
        origin: 'ui',
        author: { id: ana, name: ana },
      });
      const delta = c.of('delta')[0]!;
      expect(delta.seq).toBeNull();
      expect(cellOf(delta, `${TARGET}[]`)).toBe(value);
      expect(cellOf(delta, 'res.target[]')).toBe(c.session.scenario.committed.get('res.target'));
      expect(delta.cells).not.toHaveProperty(['base.total[]']); // unchanged by the commit
      expect(c.session.scenario.version).toBe(1);
    }
    expect(elsewhere.frames).toEqual([]);
    expect(one.session.counters.commits).toBe(1);
  });

  it('rebases a live scratch onto the new committed state and answers delta{S} and warnings{S}', async () => {
    const loader = new CommitLoader();
    const mine = await client(loader, 'C');
    mine.session.receive({ v, type: 'subscribe', cells: ['res.target[]', 'res.net[]', `${TARGET}[]`, `${CONF}[${lever}]`] });
    const conf = mine.session.scenario.committed.get(`${CONF}[${lever}]`);
    const confDef = seed.bundle.variables.find((x) => x.id === CONF)!;
    const above = target.max! + target.step!;
    mine.session.receive({ v, type: 'preview', seq: 3, changes: [{ var: TARGET, member: '', value: above }] });
    mine.tick();
    mine.clear();

    // Someone else commits another cell: the preview of the target survives on top of it.
    const moved = other(confDef, conf);
    await broadcastChange([mine.session], loader.commit('C', { [`${CONF}[${lever}]`]: moved }, bob), loader);
    mine.tick();

    expect(mine.frames.map((m) => [m.type, 'seq' in m ? m.seq : undefined])).toEqual([
      ['changeset', undefined],
      ['delta', null],
      ['delta', 3],
    ]);
    const [, committed, rebased] = mine.frames as [unknown, Extract<ServerMessage, { type: 'delta' }>, Extract<ServerMessage, { type: 'delta' }>];
    expect(cellOf(committed, `${CONF}[${lever}]`)).toBe(moved);
    // Bitwise a full evaluate of the new committed inputs + the scratch cell.
    const values = new Map(mine.session.scenario.committed.values);
    values.set(TARGET, above);
    const full = mine.session.scenario.model.model.evaluate(values, mine.session.scenario.committed.overrides);
    expect(mine.session.current.get('res.net')).toBe(full.get('res.net'));
    expect(cellOf(rebased, `${TARGET}[]`)).toBe(above);
    expect(cellOf(rebased, 'res.target[]')).toBe(full.get('res.target'));
    expect(mine.session.counters.rebases).toBe(1);
    // The warnings of the rebased scratch were already showing (same list): nothing new is pushed.
    expect(mine.session.warnings).toContainEqual(expect.objectContaining({ cells: [`${TARGET}[]`] }));

    // The client's cancelPreview after its POST settles goes back to the new committed values.
    mine.session.receive({ v, type: 'cancelPreview', seq: 4 });
    expect(mine.of('delta').at(-1)).toEqual({ v, type: 'delta', seq: 4, cells: { [`${TARGET}[]`]: mine.session.scenario.committed.get(TARGET), 'res.target[]': mine.session.scenario.committed.get('res.target') } });
    expect(mine.of('warnings').at(-1)).toEqual({ v, type: 'warnings', seq: 4, violations: [] });
  });

  it('the author’s sessions on a locked preset follow the fork; other users’ sessions on the preset are not moved', async () => {
    const loader = new CommitLoader();
    const author = await client(loader, 'B');
    const watcher = await client(loader, 'B', { user: bob });
    for (const c of [author, watcher]) c.session.receive({ v, type: 'subscribe', cells: [`${TARGET}[]`] });
    for (const c of [author, watcher]) c.clear();
    const value = other(target, author.session.scenario.committed.get(TARGET));

    const notice = loader.commit('fork-of-B', { [TARGET]: value }, ana, 'B');
    expect(await broadcastChange([author.session, watcher.session], notice, loader)).toBe(1);

    expect(author.frames).toEqual([
      expect.objectContaining({ type: 'changeset', scenarioId: 'fork-of-B', forkedFrom: 'B', version: 1 }),
      { v, type: 'delta', seq: null, cells: { [`${TARGET}[]`]: value } },
    ]);
    expect(author.session.scenarioId).toBe('fork-of-B');
    expect(watcher.frames).toEqual([]);
    expect(watcher.session.scenarioId).toBe('B');
  });

  it('a commit queues behind the frames already received and is dropped by a session that switched away', async () => {
    const loader = new CommitLoader();
    const c = await client(loader, 'C');
    c.session.receive({ v, type: 'subscribe', cells: ['res.net[]'] });
    c.session.receive({ v, type: 'open', scenarioId: 'rates' }); // waits on the loader
    const done = broadcastChange([c.session], loader.commit('C', { [TARGET]: other(target, 0) }), loader);
    await done;
    await settle();
    expect(c.session.scenarioId).toBe('rates');
    expect(c.frames.map((m) => m.type)).toEqual(['snapshot', 'snapshot']); // no changeset for the old scenario
  });

  it('sessions of another tenant never hear of it, and a closed session never holds the POST up', async () => {
    const loader = new CommitLoader();
    const c = await client(loader, 'C');
    const stranger = await client(loader, 'C');
    Object.defineProperty(stranger.session, 'tenant', { value: { ...tenant, tenantId: OTHER_TENANT } });
    c.session.close();
    expect(await broadcastChange([c.session, stranger.session], loader.commit('C', { [TARGET]: other(target, 0) }), loader)).toBe(0);
    expect(c.frames).toEqual([]);
    expect(stranger.frames).toEqual([]);
  });
});

describe('scenario switch', () => {
  it('re-targets the session and sends a fresh snapshot: later commits follow the new scenario', async () => {
    const loader = new CommitLoader();
    const c = await client(loader, 'C');
    c.session.receive({ v, type: 'subscribe', cells: ['res.net[]', `${TARGET}[]`] });
    c.session.receive({ v, type: 'preview', seq: 1, changes: [{ var: TARGET, member: '', value: target.max! + target.step! }] });
    c.tick();
    expect(c.session.warnings.length).toBeGreaterThan(0);
    c.clear();

    c.session.receive({ v, type: 'open', scenarioId: 'rates' });
    await settle();
    const rates = (await seed.load({ tenantId: SEED_TENANT, userId: ana }, 'rates'))!;
    expect(c.frames).toEqual([
      {
        v,
        type: 'snapshot',
        scenarioId: 'rates',
        version: 0,
        cells: { 'res.net[]': rates.committed.get('res.net'), [`${TARGET}[]`]: rates.committed.get(TARGET) },
      },
    ]);
    expect(c.session.current).toBe(c.session.scenario.committed); // scratch dropped
    expect(c.session.warnings).toEqual([]); // the snapshot cleared them on the client

    c.clear();
    await broadcastChange([c.session], loader.commit('C', { [TARGET]: other(target, 0) }), loader);
    expect(c.frames).toEqual([]); // the old scenario no longer reaches it
    const value = other(target, rates.committed.get(TARGET));
    await broadcastChange([c.session], loader.commit('rates', { [TARGET]: value }), loader);
    expect(c.frames.map((m) => m.type)).toEqual(['changeset', 'delta']);
    expect(cellOf(c.of('delta')[0]!, `${TARGET}[]`)).toBe(value);
  });
});

describe('preview rate cap', () => {
  it(`reruns at most ${PREVIEW_MAX_PER_SECOND} times a second; faster previews wait and coalesce, none is refused`, async () => {
    const clock = new FakeClock();
    const c = await client(new CommitLoader(), 'C', { clock });
    c.session.receive({ v, type: 'subscribe', cells: ['res.target[]'] });
    let seq = 0;
    const value = (k: number) => target.min! + (k % 2) * target.step!;
    for (let i = 0; i < PREVIEW_MAX_PER_SECOND; i++) {
      seq += 1;
      c.session.receive({ v, type: 'preview', seq, changes: [{ var: TARGET, member: '', value: value(seq) }] });
      c.tick();
    }
    expect(c.session.counters.reruns).toBe(PREVIEW_MAX_PER_SECOND); // the bucket's burst, all at once

    for (let i = 0; i < 5; i++) {
      seq += 1;
      c.session.receive({ v, type: 'preview', seq, changes: [{ var: TARGET, member: '', value: value(seq) }] });
      c.tick();
    }
    expect(c.session.counters.reruns).toBe(PREVIEW_MAX_PER_SECOND); // waiting for a token
    clock.advance(1000 / PREVIEW_MAX_PER_SECOND);
    c.tick();
    expect(c.session.counters).toMatchObject({ reruns: PREVIEW_MAX_PER_SECOND + 1, previews: seq, rejected: 0 });
    expect(c.of('delta').at(-1)!.seq).toBe(seq); // the five coalesced into one answer
  });
});
