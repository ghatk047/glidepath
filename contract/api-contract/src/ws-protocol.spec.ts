import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  BaselineGroupBy,
  ClientMessage,
  clientMessageTypes,
  JobStatus,
  parseClientMessage,
  parseServerMessage,
  PREVIEW_MAX_PER_SECOND,
  PREVIEW_MIN_INTERVAL_MS,
  ServerMessage,
  serverMessageTypes,
  SessionQuery,
  toCellKey,
  viewNames,
  ViewName,
  viewSchemas,
  WS_PROTOCOL_VERSION,
  WS_SESSION_PATH,
} from './index';
import {
  clientMessageFixtures,
  coalescingFixture,
  serverMessageFixtures,
  sessionQueryFixture,
  viewMessageFixtures,
  viewProblemFixture,
} from './fixtures/ws';

const specDir = fileURLToPath(new URL('../../../docs/spec/', import.meta.url));
const readSpec = (file: string): unknown => JSON.parse(readFileSync(specDir + file, 'utf8'));
const roundTrip = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

const allClient = Object.values(clientMessageFixtures) as Record<string, unknown>[];
const allServer = [
  ...Object.values(serverMessageFixtures),
  ...Object.values(viewMessageFixtures),
  viewProblemFixture,
] as Record<string, unknown>[];

describe('ws-protocol.spec: message union (04 §3, 03 §2)', () => {
  it('names the session endpoint and its query', () => {
    expect(WS_SESSION_PATH).toBe('/ws/session');
    expect(SessionQuery.parse(sessionQueryFixture)).toEqual(sessionQueryFixture);
    expect(SessionQuery.safeParse({ tenant: 'zz' }).success).toBe(false);
  });

  it('client → server: subscribe, unsubscribe, subscribeView, unsubscribeView, preview, cancelPreview', () => {
    expect([...clientMessageTypes].sort()).toEqual(
      [
        'subscribe',
        'unsubscribe',
        'subscribeView',
        'unsubscribeView',
        'preview',
        'cancelPreview',
      ].sort(),
    );
    expect(Object.keys(clientMessageFixtures).sort()).toEqual([...clientMessageTypes].sort());
  });

  it('server → client: snapshot, delta, view, warnings, job, changeset', () => {
    expect([...serverMessageTypes].sort()).toEqual(
      ['snapshot', 'delta', 'view', 'warnings', 'job', 'changeset'].sort(),
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
    ['warnings with problem', viewProblemFixture] as const,
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

  it('preview carries var, member, value, seq; seq is a positive integer', () => {
    const p = clientMessageFixtures.preview;
    for (const field of ['var', 'member', 'value', 'seq'] as const) {
      const broken: Record<string, unknown> = { ...p };
      delete broken[field];
      expect(ClientMessage.safeParse(broken).success, field).toBe(false);
    }
    for (const seq of [0, -1, 1.5, '7']) {
      expect(ClientMessage.safeParse({ ...p, seq }).success, String(seq)).toBe(false);
    }
    expect(ClientMessage.safeParse({ ...p, value: null }).success).toBe(false);
    expect(ClientMessage.safeParse({ ...p, member: 'pilots,fy27' }).success).toBe(true);
  });

  it('snapshot and delta carry cell values (null = no value), delta seq is null for commits', () => {
    const d = serverMessageFixtures.delta;
    expect(ServerMessage.parse({ ...d, seq: null })).toMatchObject({ seq: null });
    expect(ServerMessage.safeParse({ ...d, cells: { 'res.net': 1 } }).success).toBe(false);
    expect(ServerMessage.safeParse({ ...d, cells: { 'res.net[]': 'x' } }).success).toBe(false);
    const s = serverMessageFixtures.snapshot;
    expect(ServerMessage.safeParse({ ...s, cells: { 'res.net[]': null } }).success).toBe(true);
  });

  it('warnings carry seq and violations; a problem may ride along (API-12)', () => {
    const w = serverMessageFixtures.warnings;
    expect(ServerMessage.safeParse({ ...w, violations: undefined }).success).toBe(false);
    expect(ServerMessage.safeParse({ ...w, violations: [] }).success).toBe(true);
    expect(
      ServerMessage.safeParse({ ...viewProblemFixture, problem: { title: 'x' } }).success,
    ).toBe(false);
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
  });

  it('rejects text that is not JSON or not an object, with a one-line detail', () => {
    for (const raw of ['{not json', '42', 'null', '"subscribe"', 7, null]) {
      const r = parseClientMessage(raw);
      expect(r.ok, String(raw)).toBe(false);
      if (!r.ok) expect(r.detail).toMatch(/^[^\r\n]+$/);
    }
  });
});

describe('ws-protocol.spec: preview coalescing contract (ADR-004, 03 §2)', () => {
  it('client limit is 30 previews per second per cell (one per ~33 ms)', () => {
    expect(PREVIEW_MAX_PER_SECOND).toBe(30);
    expect(PREVIEW_MIN_INTERVAL_MS).toBeCloseTo(1000 / 30, 6);
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

  it('the client sends ≤ 30 previews/s per cell', () => {
    const lastAt = new Map<string, number>();
    for (const { atMs, message } of coalescingFixture.sent) {
      if (message.type !== 'preview') continue;
      const cell = toCellKey(message.var, message.member);
      const prev = lastAt.get(cell);
      if (prev !== undefined)
        expect(atMs - prev, cell).toBeGreaterThanOrEqual(PREVIEW_MIN_INTERVAL_MS);
      lastAt.set(cell, atMs);
    }
  });

  it('each rerun applies the latest seq per cell and answers with the latest seq', () => {
    const bySeq = new Map(coalescingFixture.sent.map((s) => [s.message.seq, s.message]));
    const answered: number[] = [];
    const dropped: number[] = [];
    for (const rerun of coalescingFixture.reruns) {
      const latest = new Map<string, { seq: number; value: number }>();
      for (const seq of rerun.pending) {
        const m = bySeq.get(seq);
        if (m?.type !== 'preview') continue;
        const cell = toCellKey(m.var, m.member);
        const prev = latest.get(cell);
        if (prev) dropped.push(prev.seq);
        latest.set(cell, { seq, value: m.value });
      }
      expect(rerun.applies).toEqual(
        Object.fromEntries([...latest].map(([cell, { value }]) => [cell, value])),
      );
      expect(rerun.answer.seq).toBe(Math.max(...rerun.pending));
      answered.push(rerun.answer.seq);
    }
    expect(dropped).toEqual(coalescingFixture.superseded);
    for (const seq of coalescingFixture.superseded) expect(answered).not.toContain(seq);
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
