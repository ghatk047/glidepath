import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  BaselineGroupBy,
  ClientMessage,
  clientMessageTypes,
  JobStatus,
  normaliseClientFrame,
  parseClientMessage,
  parseServerMessage,
  PREVIEW_MAX_PER_SECOND,
  PREVIEW_MIN_INTERVAL_MS,
  ServerMessage,
  serverMessageTypes,
  SessionQuery,
  SessionStep,
  SessionTimeline,
  toCellKey,
  viewNames,
  ViewName,
  viewSchemas,
  Warnings,
  WS_PROTOCOL_VERSION,
  WS_SESSION_PATH,
} from './index';
import {
  clientMessageFixtures,
  coalescingFixture,
  frameErrorFixture,
  legacyPreviewFixture,
  normalisedLegacyPreviewFixture,
  openFixture,
  scratchLifecycleFixtures,
  serverMessageFixtures,
  sessionQueryFixture,
  viewMessageFixtures,
  viewProblemFixture,
} from './fixtures/ws';

const specDir = fileURLToPath(new URL('../../../docs/spec/', import.meta.url));
const readSpec = (file: string): unknown => JSON.parse(readFileSync(specDir + file, 'utf8'));
const roundTrip = (value: unknown): unknown => JSON.parse(JSON.stringify(value));
const wsSource = readFileSync(fileURLToPath(new URL('./ws.ts', import.meta.url)), 'utf8');
/** ws.ts doc comments as running text (line breaks and leading `*` removed). */
const wsDoc = wsSource.replace(/\n\s*\*\s*/g, ' ');

const allClient = Object.values(clientMessageFixtures) as Record<string, unknown>[];
const allServer = [
  ...Object.values(serverMessageFixtures),
  ...Object.values(viewMessageFixtures),
] as Record<string, unknown>[];

describe('ws-protocol.spec: message union (04 §3, 03 §2)', () => {
  it('names the session endpoint and its query', () => {
    expect(WS_SESSION_PATH).toBe('/ws/session');
    expect(SessionQuery.parse(sessionQueryFixture)).toEqual(sessionQueryFixture);
    expect(SessionQuery.safeParse({ tenant: 'zz' }).success).toBe(false);
  });

  it('client → server: subscribe, unsubscribe, subscribeView, unsubscribeView, preview, cancelPreview, open', () => {
    expect([...clientMessageTypes].sort()).toEqual(
      [
        'subscribe',
        'unsubscribe',
        'subscribeView',
        'unsubscribeView',
        'preview',
        'cancelPreview',
        'open',
      ].sort(),
    );
    expect(Object.keys(clientMessageFixtures).sort()).toEqual([...clientMessageTypes].sort());
  });

  it('server → client: snapshot, delta, view, warnings, job, changeset, error', () => {
    expect([...serverMessageTypes].sort()).toEqual(
      ['snapshot', 'delta', 'view', 'warnings', 'job', 'changeset', 'error'].sort(),
    );
    expect(Object.keys(serverMessageFixtures).sort()).toEqual([...serverMessageTypes].sort());
  });

  for (const [type, fixture] of Object.entries(clientMessageFixtures)) {
    it(`round-trips client ${type}`, () => {
      const parsed = ClientMessage.parse(fixture);
      expect(roundTrip(parsed)).toEqual(fixture);
      expect(parseClientMessage(JSON.stringify(fixture))).toEqual({ ok: true, message: parsed });
    });
  }

  for (const [name, fixture] of [
    ...Object.entries(serverMessageFixtures),
    ...Object.entries(viewMessageFixtures).map(([v, f]) => [`view ${v}`, f] as const),
  ]) {
    it(`round-trips server ${name}`, () => {
      const parsed = ServerMessage.parse(fixture);
      expect(roundTrip(parsed)).toEqual(fixture);
      expect(parseServerMessage(JSON.stringify(fixture))).toEqual({ ok: true, message: parsed });
    });
  }

  it('subscribe / unsubscribe carry cell keys id[member]', () => {
    const sub = clientMessageFixtures.subscribe;
    expect(ClientMessage.safeParse({ ...sub, cells: ['res.net'] }).success).toBe(false);
    expect(ClientMessage.safeParse({ ...sub, cells: [] }).success).toBe(false);
    expect(sub.cells).toContain(toCellKey('res.net'));
  });

  it('snapshot and delta carry cell values (null = no value), delta seq is null for commits', () => {
    const d = serverMessageFixtures.delta;
    expect(ServerMessage.parse({ ...d, seq: null })).toMatchObject({ seq: null });
    expect(ServerMessage.safeParse({ ...d, cells: { 'res.net': 1 } }).success).toBe(false);
    expect(ServerMessage.safeParse({ ...d, cells: { 'res.net[]': 'x' } }).success).toBe(false);
    const s = serverMessageFixtures.snapshot;
    expect(ServerMessage.safeParse({ ...s, cells: { 'res.net[]': null } }).success).toBe(true);
  });

  it('warnings carry seq and violations', () => {
    const w = serverMessageFixtures.warnings;
    expect(ServerMessage.safeParse({ ...w, violations: undefined }).success).toBe(false);
    expect(ServerMessage.safeParse({ ...w, violations: [] }).success).toBe(true);
  });

  it('job carries id, status, progress 0..1 and note; status enum is solver_run.status', () => {
    const schema = readSpec('schema.json') as {
      tables: Record<string, { columns: { name: string; type: string }[] }>;
    };
    const col = schema.tables.solver_run?.columns.find((c) => c.name === 'status');
    expect([...JobStatus.options]).toEqual(col?.type.replace(/^enum\(|\)$/g, '').split(','));
    const j = serverMessageFixtures.job;
    expect(ServerMessage.safeParse({ ...j, progress: 1.2 }).success).toBe(false);
    expect(ServerMessage.safeParse({ ...j, progress: -0.1 }).success).toBe(false);
    expect(ServerMessage.safeParse({ ...j, note: null }).success).toBe(true);
    expect(ServerMessage.safeParse({ ...j, status: 'paused' }).success).toBe(false);
  });

  it('changeset carries scenarioId, version, editsCount and optional forkedFrom', () => {
    const c: Record<string, unknown> = { ...serverMessageFixtures.changeset };
    delete c.forkedFrom;
    expect(ServerMessage.safeParse(c).success).toBe(true);
    for (const field of ['scenarioId', 'version', 'editsCount']) {
      const broken = { ...c };
      delete broken[field];
      expect(ServerMessage.safeParse(broken).success, field).toBe(false);
    }
  });
});

describe('ws-protocol.spec: changeset message gains optional changesetId, origin, author', () => {
  const full = serverMessageFixtures.changeset;

  it('carries changesetId, origin (changeset.origin enum) and author {id, name}', () => {
    expect(ServerMessage.parse(full)).toMatchObject({
      changesetId: 'cs-9',
      origin: 'ui',
      author: { id: 'u-1', name: 'Pat Owner' },
    });
    expect(ServerMessage.safeParse({ ...full, origin: 'telepathy' }).success).toBe(false);
    expect(ServerMessage.safeParse({ ...full, author: { name: 'x' } }).success).toBe(false);
    expect(ServerMessage.safeParse({ ...full, changesetId: '' }).success).toBe(false);
  });

  it('each new field is optional; author is null for system changesets', () => {
    const minimal = { v: 1, type: 'changeset', scenarioId: 'sc-1', version: 2, editsCount: 0 };
    expect(ServerMessage.safeParse(minimal).success).toBe(true);
    expect(
      ServerMessage.safeParse({ ...minimal, origin: 'market_refresh', author: null }).success,
    ).toBe(true);
  });
});

describe('ws-protocol.spec: open{scenarioId} switches the session', () => {
  it('open carries a scenario id and nothing else is required', () => {
    expect(ClientMessage.parse(clientMessageFixtures.open)).toEqual(clientMessageFixtures.open);
    expect(ClientMessage.safeParse({ v: 1, type: 'open' }).success).toBe(false);
    expect(ClientMessage.safeParse({ v: 1, type: 'open', scenarioId: '' }).success).toBe(false);
  });

  it('is answered by a snapshot of every subscribed cell, then every subscribed view (seq null)', () => {
    const steps = SessionTimeline.parse(openFixture);
    const at = steps.findIndex((s) => s.by === 'client' && s.message.type === 'open');
    const open = steps[at]!;
    if (open.by !== 'client' || open.message.type !== 'open') throw new Error('no open');
    const cells = new Set<string>();
    const views: string[] = [];
    for (const s of steps.slice(0, at)) {
      if (s.by !== 'client') continue;
      if (s.message.type === 'subscribe') s.message.cells.forEach((c) => cells.add(c));
      if (s.message.type === 'subscribeView') views.push(s.message.view);
    }
    const answers = steps.slice(at + 1);
    const [snapshot, ...rest] = answers;
    expect(snapshot?.by === 'server' && snapshot.message).toMatchObject({
      type: 'snapshot',
      scenarioId: open.message.scenarioId,
    });
    if (snapshot?.by !== 'server' || snapshot.message.type !== 'snapshot') return;
    expect(Object.keys(snapshot.message.cells).sort()).toEqual([...cells].sort());
    expect(
      rest.map((s) => (s.by === 'server' && s.message.type === 'view' ? s.message : null)),
    ).toEqual(views.map((view) => expect.objectContaining({ view, seq: null })));
  });

  it('documents that a session follows the changeset{forkedFrom} it caused', () => {
    expect(wsDoc).toMatch(
      /The sessions that caused it, i\.e\. the author's sessions open on the preset, follow the fork/,
    );
    expect(wsDoc).toMatch(/Other sessions on the preset are not moved/);
    // Walk the fork timeline: the session's scenario is the preset, then the fork.
    let scenario = sessionQueryFixture.scenario;
    const seen: string[] = [scenario];
    for (const step of SessionTimeline.parse(scratchLifecycleFixtures.fork)) {
      if (step.by !== 'server') continue;
      const m = step.message;
      if (m.type === 'snapshot') scenario = m.scenarioId;
      if (m.type === 'changeset' && m.forkedFrom === scenario) scenario = m.scenarioId;
      if (seen.at(-1) !== scenario) seen.push(scenario);
    }
    expect(seen).toEqual(['sc-preset-c', 'sc-custom-c']);
    const result = scratchLifecycleFixtures.fork.find((s) => s.by === 'postResolved');
    expect(result?.by === 'postResolved' && result.result).toMatchObject({
      scenarioId: 'sc-custom-c',
      forkedFrom: 'sc-preset-c',
    });
  });
});

describe('ws-protocol.spec: preview carries changes[{var, member, value}] with seq (atomic)', () => {
  it('carries 1..n cells, e.g. two org.dom_share cells of one domain row, and a positive seq', () => {
    const p = ClientMessage.parse(clientMessageFixtures.preview);
    if (p.type !== 'preview') throw new Error(p.type);
    expect(p.changes).toHaveLength(2);
    expect(new Set(p.changes.map((c) => c.var))).toEqual(new Set(['org.dom_share']));
    expect(p.changes.map((c) => c.member)).toEqual([
      'data_analytics,vp_commercial',
      'data_analytics,vp_operations',
    ]);
    const base = clientMessageFixtures.preview;
    expect(ClientMessage.safeParse({ ...base, changes: [] }).success).toBe(false);
    expect(ClientMessage.safeParse({ ...base, changes: undefined }).success).toBe(false);
    for (const seq of [0, -1, 1.5, '7', undefined]) {
      expect(ClientMessage.safeParse({ ...base, seq }).success, String(seq)).toBe(false);
    }
  });

  it('each change needs var, member and a numeric value; a cell appears once per preview', () => {
    const base = clientMessageFixtures.preview;
    const cell = base.changes[0];
    for (const field of ['var', 'member', 'value'] as const) {
      const broken: Record<string, unknown> = { ...cell };
      delete broken[field];
      expect(ClientMessage.safeParse({ ...base, changes: [broken] }).success, field).toBe(false);
    }
    expect(ClientMessage.safeParse({ ...base, changes: [{ ...cell, value: null }] }).success).toBe(
      false,
    );
    expect(ClientMessage.safeParse({ ...base, changes: [cell, cell] }).success).toBe(false);
  });

  it('single-cell form: not a ClientMessage, normalised to changes[1] by parseClientMessage', () => {
    expect(ClientMessage.safeParse(legacyPreviewFixture).success).toBe(false);
    expect(normaliseClientFrame(legacyPreviewFixture)).toEqual(normalisedLegacyPreviewFixture);
    expect(parseClientMessage(JSON.stringify(legacyPreviewFixture))).toEqual({
      ok: true,
      message: ClientMessage.parse(normalisedLegacyPreviewFixture),
    });
    expect(normaliseClientFrame(clientMessageFixtures.preview)).toBe(clientMessageFixtures.preview);
    expect(normaliseClientFrame('x')).toBe('x');
    expect(parseClientMessage({ ...legacyPreviewFixture, value: 'x' }).ok).toBe(false);
  });

  it('a batched preview is applied in one rerun: its cells never split across answers', () => {
    const bySeq = new Map(coalescingFixture.sent.map((s) => [s.message.seq, s.message]));
    for (const rerun of coalescingFixture.reruns) {
      for (const seq of rerun.pending) {
        const m = bySeq.get(seq);
        if (m?.type !== 'preview' || coalescingFixture.superseded.includes(seq)) continue;
        for (const c of m.changes) {
          expect(rerun.applies, `seq ${seq}`).toHaveProperty([toCellKey(c.var, c.member)]);
        }
      }
    }
  });
});

describe('ws-protocol.spec: envelope `type` + `v`; unknown types rejected', () => {
  it('protocol version is 1 and every fixture carries type and v', () => {
    expect(WS_PROTOCOL_VERSION).toBe(1);
    for (const m of [...allClient, ...allServer]) {
      expect(m.v).toBe(WS_PROTOCOL_VERSION);
      expect(typeof m.type).toBe('string');
    }
  });

  it('rejects a message without v, with another v, or without type', () => {
    for (const [parse, msgs] of [
      [parseClientMessage, allClient],
      [parseServerMessage, allServer],
    ] as const) {
      for (const m of msgs) {
        const noV: Record<string, unknown> = { ...m };
        delete noV.v;
        const noType: Record<string, unknown> = { ...m };
        delete noType.type;
        expect(parse(noV).ok, `${String(m.type)} without v`).toBe(false);
        expect(parse({ ...m, v: 2 }).ok, `${String(m.type)} v2`).toBe(false);
        expect(parse({ ...m, v: '1' }).ok, `${String(m.type)} v'1'`).toBe(false);
        expect(parse(noType).ok, `${String(m.type)} without type`).toBe(false);
      }
    }
  });

  it('rejects unknown types, and messages sent in the wrong direction', () => {
    const unknown = parseClientMessage({ v: 1, type: 'ping' });
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.detail).toMatch(/type/);
    expect(parseServerMessage({ v: 1, type: 'hello', cells: {} }).ok).toBe(false);
    expect(parseClientMessage(serverMessageFixtures.snapshot).ok).toBe(false);
    expect(parseServerMessage(clientMessageFixtures.preview).ok).toBe(false);
    expect(parseClientMessage(serverMessageFixtures.error).ok).toBe(false);
  });

  it('rejects text that is not JSON or not an object, with a one-line detail', () => {
    for (const raw of ['{not json', '42', 'null', '"subscribe"', 7, null]) {
      const r = parseClientMessage(raw);
      expect(r.ok, String(raw)).toBe(false);
      if (!r.ok) expect(r.detail).toMatch(/^[^\r\n]+$/);
    }
  });
});

describe('ws-protocol.spec: error{problem} for rejected frames; warnings never carry frame errors', () => {
  it('error carries a problem with a one-line detail', () => {
    const parsed = ServerMessage.parse(frameErrorFixture);
    expect(parsed).toMatchObject({ type: 'error', problem: { status: 400 } });
    expect(ServerMessage.safeParse({ v: 1, type: 'error' }).success).toBe(false);
    expect(ServerMessage.safeParse({ v: 1, type: 'error', problem: { title: 'x' } }).success).toBe(
      false,
    );
    const r = parseClientMessage('{not json');
    if (r.ok) throw new Error('parsed');
    const fromDetail = {
      v: 1,
      type: 'error',
      problem: { type: '/problems/bad-request', title: 'Bad frame', status: 400, detail: r.detail },
    };
    expect(ServerMessage.safeParse(fromDetail).success).toBe(true);
  });

  it('warnings have no problem field; a problem on warnings is not carried', () => {
    expect(Object.keys(Warnings.shape).sort()).toEqual(['seq', 'type', 'v', 'violations']);
    const smuggled = { ...serverMessageFixtures.warnings, problem: frameErrorFixture.problem };
    const parsed = ServerMessage.parse(smuggled);
    expect(parsed).not.toHaveProperty('problem');
    expect(viewProblemFixture).toBe(frameErrorFixture);
  });
});

describe('ws-protocol.spec: preview rate limit is 30/s per connection; coalescing (ADR-004, 03 §2)', () => {
  it('PREVIEW_MAX_PER_SECOND is 30 and documented per connection', () => {
    expect(PREVIEW_MAX_PER_SECOND).toBe(30);
    expect(PREVIEW_MIN_INTERVAL_MS).toBeCloseTo(1000 / 30, 6);
    expect(wsDoc).toMatch(
      /PREVIEW_MAX_PER_SECOND` `preview` messages per second \*\*per connection\*\*/,
    );
    expect(wsDoc).not.toMatch(/per second per input cell/);
  });

  it('every fixture message parses and seqs strictly increase', () => {
    const seqs = coalescingFixture.sent
      .map((s) => ClientMessage.parse(s.message))
      .map((m) => {
        if (m.type !== 'preview' && m.type !== 'cancelPreview') throw new Error(m.type);
        return m.seq;
      });
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(seqs.length);
    for (const r of coalescingFixture.reruns) ServerMessage.parse(r.answer);
  });

  it('the client sends ≤ 30 previews/s on the connection, whatever the cells', () => {
    const previews = coalescingFixture.sent.filter((s) => s.message.type === 'preview');
    expect(
      new Set(
        previews.map((p) =>
          JSON.stringify(p.message.type === 'preview' && p.message.changes.map((c) => c.var)),
        ),
      ).size,
    ).toBeGreaterThan(1);
    for (let i = 1; i < previews.length; i++) {
      expect(previews[i]!.atMs - previews[i - 1]!.atMs, `preview ${i}`).toBeGreaterThanOrEqual(
        PREVIEW_MIN_INTERVAL_MS,
      );
    }
  });

  it('each rerun applies the latest seq per cell and answers with the latest seq', () => {
    const bySeq = new Map(coalescingFixture.sent.map((s) => [s.message.seq, s.message]));
    const answered: number[] = [];
    const superseded: number[] = [];
    for (const rerun of coalescingFixture.reruns) {
      const latest = new Map<string, { seq: number; value: number }>();
      for (const seq of rerun.pending) {
        const m = bySeq.get(seq);
        if (m?.type !== 'preview') continue;
        for (const c of m.changes) latest.set(toCellKey(c.var, c.member), { seq, value: c.value });
      }
      const surviving = new Set([...latest.values()].map((l) => l.seq));
      for (const seq of rerun.pending) {
        if (bySeq.get(seq)?.type === 'preview' && !surviving.has(seq)) superseded.push(seq);
      }
      expect(rerun.applies).toEqual(
        Object.fromEntries([...latest].map(([cell, { value }]) => [cell, value])),
      );
      expect(rerun.answer.seq).toBe(Math.max(...rerun.pending));
      answered.push(rerun.answer.seq);
    }
    expect(superseded).toEqual(coalescingFixture.superseded);
    for (const seq of coalescingFixture.superseded) expect(answered).not.toContain(seq);
  });
});

describe('ws-protocol.spec: scratch lifecycle around a commit (fixture order)', () => {
  const timelines = Object.entries(scratchLifecycleFixtures);

  it('is documented on SessionStep: rebase onto each commit, cancel after the POST settles', () => {
    expect(wsDoc).toMatch(/Previews are therefore always rebased onto each commit/);
    expect(wsDoc).toMatch(/sends `cancelPreview\{seq\}` once its POST has settled/);
    expect(wsDoc).toMatch(/tier 2 tells the sessions before it answers the POST/);
  });

  it.each(timelines)('%s: every step is a typed SessionStep', (_name, timeline) => {
    for (const step of timeline) expect(SessionStep.safeParse(step).success).toBe(true);
    expect(SessionStep.safeParse({ by: 'rumour', message: {} }).success).toBe(false);
  });

  it.each(timelines)(
    '%s: a changeset message directly precedes its delta{seq: null}',
    (name, t) => {
      const steps = SessionTimeline.parse(t);
      const server = steps.flatMap((s) => (s.by === 'server' ? [s.message] : []));
      const commits = server.flatMap((m, i) => (m.type === 'changeset' ? [i] : []));
      // `rejected` never commits; every other timeline does.
      expect(commits.length > 0).toBe(name !== 'rejected');
      for (const i of commits) expect(server[i + 1]).toMatchObject({ type: 'delta', seq: null });
      server.forEach((m, i) => {
        if (m.type === 'delta' && m.seq === null) expect(server[i - 1]?.type).toBe('changeset');
      });
    },
  );

  it.each(timelines)('%s: tier 1 sends cancelPreview only after its POST settled', (_n, t) => {
    const steps = SessionTimeline.parse(t);
    let inFlight = false;
    let posts = 0;
    for (const s of steps) {
      if (s.by === 'post') {
        inFlight = true;
        posts += 1;
      }
      if (s.by === 'postResolved' || s.by === 'postFailed') inFlight = false;
      if (s.by === 'client' && s.message.type === 'cancelPreview') expect(inFlight).toBe(false);
    }
    expect(posts).toBeGreaterThan(0);
    const last = steps.findLastIndex((s) => s.by === 'postResolved' || s.by === 'postFailed');
    const cancel = steps.findIndex((s) => s.by === 'client' && s.message.type === 'cancelPreview');
    expect(cancel).toBeGreaterThan(last);
  });

  it.each(timelines)(
    '%s: previews are rebased onto each commit (delta with the scratch seq)',
    (_n, t) => {
      const steps = SessionTimeline.parse(t);
      let scratch: number | null = null;
      steps.forEach((s, i) => {
        if (s.by === 'client' && s.message.type === 'preview') scratch = s.message.seq;
        if (s.by === 'client' && s.message.type === 'cancelPreview') scratch = null;
        if (s.by === 'server' && s.message.type === 'delta' && s.message.seq === null && scratch) {
          expect(steps[i + 1]).toMatchObject({
            by: 'server',
            message: { type: 'delta', seq: scratch },
          });
        }
      });
    },
  );

  it.each(timelines)('%s: seqs strictly increase; cancel is answered with its own seq', (_n, t) => {
    const steps = SessionTimeline.parse(t);
    const seqs = steps.flatMap((s) =>
      s.by === 'client' && (s.message.type === 'preview' || s.message.type === 'cancelPreview')
        ? [s.message.seq]
        : [],
    );
    expect(seqs).toEqual([...new Set(seqs)].sort((a, b) => a - b));
    const cancel = steps.findIndex((s) => s.by === 'client' && s.message.type === 'cancelPreview');
    const c = steps[cancel];
    if (c?.by !== 'client' || c.message.type !== 'cancelPreview') throw new Error('no cancel');
    expect(steps[cancel + 1]).toMatchObject({
      by: 'server',
      message: { type: 'delta', seq: c.message.seq },
    });
  });

  it('conflict: tier 1 re-sends its edits on serverVersion after a 409', () => {
    const steps = SessionTimeline.parse(scratchLifecycleFixtures.conflict);
    const failed = steps.findIndex((s) => s.by === 'postFailed');
    const f = steps[failed];
    if (f?.by !== 'postFailed' || !('serverVersion' in f.problem)) throw new Error('no 409');
    const posts = steps.flatMap((s) => (s.by === 'post' ? [s.request] : []));
    expect(posts).toHaveLength(2);
    expect(posts[1]!.baseVersion).toBe(f.problem.serverVersion);
    expect(posts[1]!.changes).toEqual(posts[0]!.changes);
    expect(posts[1]!.clientRequestId).not.toBe(posts[0]!.clientRequestId);
  });
});

describe('ws-protocol.spec: view subscriptions (ADR-021)', () => {
  it('enumerates exactly the seven view names', () => {
    const expected = [
      'bridge',
      'baseline.groups',
      'baseline.summary',
      'levers.families',
      'levers.monthly',
      'levers.scale',
      'vps.domain_outlay',
    ];
    expect([...ViewName.options]).toEqual(expected);
    expect([...viewNames]).toEqual(expected);
    expect(Object.keys(viewSchemas)).toEqual(expected);
    expect(Object.keys(viewMessageFixtures)).toEqual(expected);
  });

  it('subscribeView and unsubscribeView accept every view with its params', () => {
    for (const [view, fixture] of Object.entries(viewMessageFixtures)) {
      for (const type of ['subscribeView', 'unsubscribeView']) {
        const msg = { v: 1, type, view, params: fixture.params };
        expect(ClientMessage.safeParse(msg).success, `${type} ${view}`).toBe(true);
      }
    }
  });

  it('rejects an unknown view, missing params and params of another view', () => {
    const sv = clientMessageFixtures.subscribeView;
    expect(ClientMessage.safeParse({ ...sv, view: 'levers.weekly' }).success).toBe(false);
    expect(ClientMessage.safeParse({ v: 1, type: 'subscribeView', view: 'bridge' }).success).toBe(
      false,
    );
    expect(
      ClientMessage.safeParse({ v: 1, type: 'subscribeView', view: 'bridge', params: { by: 'vp' } })
        .success,
    ).toBe(false);
    expect(ClientMessage.safeParse({ ...sv, params: { by: 'vendor' } }).success).toBe(false);
  });

  it('baseline.groups groups by the pool, domain or vp dimension of formula_graph.json', () => {
    const dims = (
      readSpec('formula_graph.json') as { dimensions: { id: string }[] }
    ).dimensions.map((d) => d.id);
    expect([...BaselineGroupBy.options]).toEqual(['pool', 'domain', 'vp']);
    for (const by of BaselineGroupBy.options) expect(dims).toContain(by);
  });

  it('a view message must carry the payload of its own view', () => {
    const b = viewMessageFixtures.bridge;
    expect(ServerMessage.safeParse({ ...b, payload: { max: 1 } }).success).toBe(false);
    expect(
      ServerMessage.safeParse({ ...viewMessageFixtures['levers.scale'], view: 'bridge' }).success,
    ).toBe(false);
  });

  it('bridge steps are base, growth, savings, oneTime, outlay in that order', () => {
    const b = viewMessageFixtures.bridge;
    const swapped = [...b.payload.steps].reverse();
    expect(
      ServerMessage.safeParse({ ...b, payload: { ...b.payload, steps: swapped } }).success,
    ).toBe(false);
  });

  it('levers.monthly series have twelve values', () => {
    const m = viewMessageFixtures['levers.monthly'];
    const short = { ...m.payload, levers: [{ ...m.payload.levers[0]!, values: [1, 2, 3] }] };
    expect(ServerMessage.safeParse({ ...m, payload: short }).success).toBe(false);
  });
});
