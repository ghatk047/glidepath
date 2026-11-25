import { Readable } from 'node:stream';
import type { ChangesetTx } from '@glidepath/domain';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as dataAccess from '../../src/index';
import { runScoped } from '../../src/scope';
import type { TenantTx, UserTx } from '../../src/tenant';
import { ANA, BOB, CS, MV1, RUN, SCN, SLUG_A, SLUG_B, TENANT_A, TENANT_B, twinB } from '../../src/testing/minimal-seed';
import { globalRows, leaves, tenantSnapshot, tenantTables } from './catalog';
import type { TenantTable } from './catalog';
import { CLIENT_REQUEST, DORA, GC_A, GC_B, IDS, OBJECTS, openLeakDb } from './seed';
import type { LeakDb } from './seed';

/**
 * G7, repository side (DATA-10). Two tenants are seeded (test/leak/seed.ts); every repository that
 * data-access exports runs as glidepath_app, under RLS, in three ways:
 *   1. as tenant A with A's own ids: it works, and returns no row of tenant B;
 *   2. as tenant A aimed at tenant B (B's row ids, B's keys): reads find nothing, writes fail;
 *   3. with tenant B's id: data-access's scope says tenant B, so the repository filters and writes
 *      tenant_id = B, while the connection's RLS context (app.tenant_id) is A. Writes must fail and
 *      reads return nothing of B: RLS is the backstop of every repository, not only its WHERE clause.
 * After every call the rows of tenant B, read by a superuser, are compared with the seed's.
 * The repository list is read from data-access's exports (and the port methods from the objects the
 * factories return), so a new repository without a case here fails the discovery test.
 */

const {
  PostgresObjectStore, ScenarioVersionError, TenantScopeError, changesetTx, createChangesetStore, createTenantChangesetStore,
  withTenant, withUser,
} = dataAccess;

type Fn = (...args: unknown[]) => Promise<unknown>;
type ObjectStore = InstanceType<typeof PostgresObjectStore>;
/** The arguments after the transaction (or of the port / store method), or a function for a call that needs more. */
type Call<C> = readonly unknown[] | ((c: C) => Promise<unknown>);

interface Case<C> {
  /** read: returns rows; write: creates, changes or deletes rows. */
  readonly kind: 'read' | 'write';
  /** What a tenant-A request does, with A's ids. */
  readonly own: Call<C>;
  /** The same repository aimed at tenant B's rows (by id or key). Omitted when it takes no id. */
  readonly atB?: readonly Call<C>[];
  /** Why the atB write succeeds: it writes a row of the caller's own tenant (keys are per tenant). B must not change. */
  readonly atBWritesOwnTenant?: string;
  /** `own` returns nothing even for tenant A. */
  readonly ownMayBeEmpty?: true;
}

const read = <C>(own: Call<C>, atB: Call<C>[] = [], extra: Partial<Case<C>> = {}): Case<C> => ({ kind: 'read', own, atB, ...extra });
const write = <C>(own: Call<C>, atB: Call<C>[] = [], extra: Partial<Case<C>> = {}): Case<C> => ({ kind: 'write', own, atB, ...extra });

type Entry =
  | { readonly via: 'tenant'; readonly case: Case<TenantTx> }
  | { readonly via: 'user'; readonly case: Case<UserTx> }
  /** getCurrentUser: inside withTenant and inside withUser. */
  | { readonly via: 'either'; readonly case: Case<TenantTx> }
  /** A factory of the domain's ChangesetStore port: every ChangesetTx method of PORT_CASES runs through it. */
  | { readonly via: 'port' }
  /** PostgresObjectStore: every method of STORE_CASES. */
  | { readonly via: 'store' };

const NOW = '2026-11-23T10:00:00.000Z';
const fresh = (n: number): string => `00000000-0000-4000-8000-${(0xfa00 + n).toString(16).padStart(12, '0')}`;
const tenant = (c: Case<TenantTx>): Entry => ({ via: 'tenant', case: c });

// ---------------------------------------------------------------------------------- ChangesetTx methods

const newScenario = {
  id: fresh(1), key: 'leak-new', label: 'leak new', kind: 'user', parent_id: SCN.root, model_version_id: MV1, version: 0,
  locked: false, created_by: ANA, created_at: NOW,
};
const newChangeset = (id: string) => ({
  id, origin: 'ui', scenario_id: GC_A, base_scenario_version: 4, status: 'applied', summary: { edits: 1 }, created_by: ANA,
  created_at: NOW, reverts_id: null,
  changes: [{
    changeset_id: id, seq: 0, target: 'scenario_value', key: 'g.target_net', member_key: '', op: 'update', old_value: 1,
    new_value: 2, export_value: null, status: 'clean', messages: {},
  }],
});
const calcRun = (over: Record<string, unknown>) => ({
  id: fresh(3), scenario_id: GC_A, scenario_version: 4, model_version_id: MV1, input_hash: 'h-leak', ms: 3, outputs: {}, created_at: NOW, ...over,
});

/** Every method of the ChangesetTx that changesetTx / createChangesetStore / createTenantChangesetStore hand out. */
const PORT_CASES: Record<string, Case<ChangesetTx>> = {
  loadScenarioForUpdate: read([GC_A], [[GC_B]]),
  lockTenantDefaults: read([], [], { ownMayBeEmpty: true }), // a transaction-scoped advisory lock, no rows
  loadScenarios: read([]),
  loadInputs: read([GC_A], [[GC_B]]),
  loadMembers: read([]),
  // line keys are per tenant: B has an it_001 too, A must get its own
  loadMemberRows: read(['line', ['it_001']], [['vp', ['vp_b']], ['line', ['it_404']]]),
  loadChangeset: read([CS.c1], [[twinB(CS.c1)], [IDS.B.changeset]]),
  findChangesetByClientRequest: read([ANA, CLIENT_REQUEST], [[BOB, CLIENT_REQUEST]]),
  changesSince: read([GC_A, 0], [[GC_B, 0]]),
  createScenario: write([newScenario], [[{ ...newScenario, id: GC_B }]]),
  insertChangeset: write([newChangeset(fresh(2))], [[newChangeset(twinB(CS.c1))], [newChangeset(IDS.B.changeset)]]),
  setChangesetStatus: write([CS.c1, 'applied'], [[twinB(CS.c1), 'reverted'], [IDS.B.changeset, 'reverted']]),
  writeValue: write(
    [{ target: 'variable_value', key: 'g.target_net', member_key: '', value: 125, changeset_id: CS.c1 }],
    [
      [{ target: 'scenario_value', scenario_id: GC_B, key: 'g.target_net', member_key: '', value: 1, changeset_id: CS.c1 }],
      [{ target: 'scenario_value', scenario_id: GC_B, key: 'g.target_net', member_key: '', value: null, changeset_id: CS.c1 }],
      [{ target: 'node_override', scenario_id: GC_B, key: 'res.net', member_key: '', value: 1, reason: 'x' }],
      [{ target: 'node_override', scenario_id: GC_B, key: 'res.net', member_key: '', value: null }],
    ],
  ),
  writeMember: write(
    [{ target: 'dimension_member', dim_key: 'vp', member_key: 'vp_leak', row: { label: 'Leak', sort: 9 } }],
    [[{ target: 'line_item', dim_key: 'line', member_key: 'it_001', row: { name: 'line it_001' } }]],
    { atBWritesOwnTenant: 'it_001 is a key of both tenants: the write changes tenant A\'s line it_001' },
  ),
  bumpVersion: write([GC_A, 4], [[GC_B, 4]]),
  findCalcRun: read([GC_A, 'h2'], [[GC_B, 'h9-b']]),
  upsertCalcRun: write([calcRun({})], [[calcRun({ id: twinB(RUN.r2), scenario_id: GC_B, input_hash: 'h9-b' })]]),
  updateScenario: write([GC_A, { label: 'leak renamed' }], [[GC_B, { label: 'hijacked' }], [GC_B, { locked: true, archived: true }]]),
  appendAudit: write([{ actor: ANA, action: 'leak.test', entity: 'scenario', entity_key: GC_A, before: null, after: null, at: NOW }]),
};

// ---------------------------------------------------------------------------------- ObjectStore methods

const bytes = (s: string): Uint8Array => new Uint8Array(Buffer.from(s));
const TEMP = { bucket: 'ai', key: 'a/leak-temp.txt' } as const;

/** Every method of PostgresObjectStore (bound to tenant A). Each own call is idempotent: the store commits. */
const STORE_CASES: Record<string, Case<ObjectStore>> = {
  put: write(['exports', 'a/leak-new.txt', bytes('a leak test')], [
    async (s) => {
      // B's key in A's namespace: a separate object of A; removed again so later reads stay A's own
      const meta = await s.put(OBJECTS.B.live.bucket, OBJECTS.B.live.key, bytes('written by tenant A'));
      await s.delete(OBJECTS.B.live.bucket, OBJECTS.B.live.key);
      return meta;
    },
  ], { atBWritesOwnTenant: 'keys are per tenant: tenant A gets its own object under the same key' }),
  get: read([OBJECTS.A.live.bucket, OBJECTS.A.live.key], [[OBJECTS.B.live.bucket, OBJECTS.B.live.key], [OBJECTS.B.expired.bucket, OBJECTS.B.expired.key]]),
  stream: read([OBJECTS.A.live.bucket, OBJECTS.A.live.key], [[OBJECTS.B.live.bucket, OBJECTS.B.live.key]]),
  list: read(['exports'], [['exports', 'tenant-b-only/'], ['ai']]),
  delete: write(
    async (s) => {
      await s.put(TEMP.bucket, TEMP.key, bytes('temp'));
      return s.delete(TEMP.bucket, TEMP.key);
    },
    [[OBJECTS.B.live.bucket, OBJECTS.B.live.key], [OBJECTS.B.expired.bucket, OBJECTS.B.expired.key]],
  ),
  purgeExpired: write([], [[]], { atBWritesOwnTenant: 'purges tenant A\'s expired objects; tenant B\'s expired object stays' }),
};
/** PostgresObjectStore members that are not port methods. */
const STORE_INTERNAL: Record<string, string> = {
  tx: 'private: withTenant(db, tenantId, userId) of the store\'s own tenant, which every port method goes through',
};

// ---------------------------------------------------------------------------------- the exports

/** Every repository data-access exports, with its leak case. */
const CASES: Record<string, Entry> = {
  // read repositories (DATA-05)
  loadModelDefs: tenant(read([])),
  loadMembers: tenant(read([])),
  listScenarios: tenant(read([])),
  getScenario: tenant(read([SCN.root], [[GC_B], [twinB(SCN.root!)]])),
  loadEditsCounts: tenant(read([Object.values(SCN)], [[[GC_B, twinB(SCN.root!)]]])),
  loadResolvedInputs: tenant(read([GC_A], [[GC_B]])),
  listChangesetHistory: tenant(read([GC_A], [[GC_B]])),
  getChangeset: tenant(read([CS.c1], [[twinB(CS.c1)], [IDS.B.changeset]])),
  getLatestCalcRun: tenant(read([GC_A], [[GC_B]])),
  getTenant: tenant(read([])),
  listTenantMembers: tenant(read([])),
  getCurrentUser: { via: 'either', case: read([]) },
  listMyMemberships: { via: 'user', case: read([]) },
  findMyMembership: { via: 'user', case: read([SLUG_A], [[SLUG_B]]) },
  // job repositories (DATA-06)
  createSolverRun: tenant(write([{ kind: 'goal_seek', scenario_id: GC_A, spec: {} }], [[{ id: IDS.B.solverRun, kind: 'goal_seek', scenario_id: GC_A, spec: {} }]])),
  getSolverRun: tenant(read([IDS.A.solverRun], [[IDS.B.solverRun]])),
  listSolverRuns: tenant(read([], [[{ scenarioId: GC_B }]])),
  updateSolverRun: tenant(write([IDS.A.solverRun, { progress: 0.5 }], [[IDS.B.solverRun, { cancel_requested: true }]])),
  deleteSolverRun: tenant(write([IDS.A.solverRun], [[IDS.B.solverRun]])),
  createExportJob: tenant(write(
    [{ template_version: '1', scenario_ids: [GC_A], snapshot: {}, file_uri: 'a.xlsx', checksum: 'c', created_by: ANA }],
    [[{ id: IDS.B.exportJob, template_version: '1', scenario_ids: [GC_A], snapshot: {}, file_uri: 'a.xlsx', checksum: 'c', created_by: ANA }]],
  )),
  getExportJob: tenant(read([IDS.A.exportJob], [[IDS.B.exportJob]])),
  listExportJobs: tenant(read([])),
  updateExportJob: tenant(write([IDS.A.exportJob, { checksum: 'a changed' }], [[IDS.B.exportJob, { checksum: 'x' }]])),
  deleteExportJob: tenant(write([IDS.A.exportJob], [[IDS.B.exportJob]])),
  createImportJob: tenant(write([{ file_uri: 'a.xlsx' }], [[{ id: IDS.B.importJob, file_uri: 'a.xlsx' }]])),
  getImportJob: tenant(read([IDS.A.importJob], [[IDS.B.importJob]])),
  listImportJobs: tenant(read([])),
  updateImportJob: tenant(write([IDS.A.importJob, { status: 'validated' }], [[IDS.B.importJob, { status: 'failed' }]])),
  deleteImportJob: tenant(write([IDS.A.importJob], [[IDS.B.importJob]])),
  createAiReconfigJob: tenant(write([{ prompt: 'p', status: 'draft' }], [[{ id: IDS.B.aiJob, prompt: 'p', status: 'draft' }]])),
  getAiReconfigJob: tenant(read([IDS.A.aiJob], [[IDS.B.aiJob]])),
  listAiReconfigJobs: tenant(read([])),
  updateAiReconfigJob: tenant(write([IDS.A.aiJob, { status: 'reviewed' }], [[IDS.B.aiJob, { status: 'x' }]])),
  deleteAiReconfigJob: tenant(write([IDS.A.aiJob], [[IDS.B.aiJob]])),
  // write repositories (DATA-06): the ChangesetStore port
  changesetTx: { via: 'port' },
  createChangesetStore: { via: 'port' },
  createTenantChangesetStore: { via: 'port' },
  // object store (DATA-07)
  PostgresObjectStore: { via: 'store' },
};

/** Exports that open no tenant data: why each is not a repository. Error classes are recognised by type. */
const NOT_REPOSITORIES: Record<string, string> = {
  createDb: 'opens a pool; sets no tenant and reads nothing',
  migrate: 'migration runner (owner role, DDL)',
  listMigrations: 'lists migration files',
  poolConfig: 'configuration',
  connectionConfig: 'configuration',
  resolveDbOptions: 'configuration',
  dbOptionsFromEnv: 'configuration',
  withTenant: 'opens the tenant scope every repository requires (tenant.pg.test.ts)',
  withUser: 'opens the pre-tenant scope (tenant.pg.test.ts)',
  sql: 'the drizzle sql tag, re-exported',
  sha256Hex: 'pure helper of the object store port',
  assertBucket: 'pure helper of the object store port',
  assertKey: 'pure helper of the object store port',
  resolveExpiry: 'pure helper of the object store port',
  MemoryObjectStore: 'the in-memory twin of the object store: no database',
  clearMembersCache: 'process-local cache bookkeeping (DATA-13): reads no data',
  invalidateMembersCache: 'process-local cache bookkeeping (DATA-13): reads no data',
  membersCacheStats: 'process-local cache counters (DATA-13): reads no data',
};

/** Does `fn`'s source call a scope guard or open a scope (other than in its own name)? */
const SCOPE_CALL = /\b(tenantScope|userScope|anyScope|withTenant|withUser)\b/;
function opensTenantData(fn: unknown, name: string): boolean {
  const src = String(fn).replace(new RegExp(`^(async\\s+)?(function\\s*\\*?\\s*|class\\s+)${name}\\b`), '');
  return SCOPE_CALL.test(src);
}

// ---------------------------------------------------------------------------------- database and oracle

let db: LeakDb;
let tables: TenantTable[];
let baselineB: Map<string, string[]>;
const markers = { uuids: [] as string[], strings: [] as string[], numbers: [] as number[] };
/** Every B id or key an atB call passes: echoing an argument back is not a leak. */
const targetsOfB = new Set<string | number>([GC_B, twinB(CS.c1), twinB(RUN.r2), twinB(SCN.root!), ...Object.values(IDS.B), SLUG_B, 'vp_b', 'h9-b',
  OBJECTS.B.live.key, OBJECTS.B.expired.key, 'tenant-b-only/']);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

beforeAll(async () => {
  db = await openLeakDb();
  tables = (await tenantTables(db.adminQuery)).tables;
  baselineB = await tenantSnapshot(db.adminQuery, tables, TENANT_B);
  // tenant B's values: in a B row, in no A row and in no global row (catalog-wide, so new tables count)
  const rowsOf = (snap: Map<string, string[]>): unknown[] => [...snap.values()].flat().map((j) => JSON.parse(j) as unknown);
  const a = leaves(rowsOf(await tenantSnapshot(db.adminQuery, tables, TENANT_A)));
  const g = leaves(await globalRows(db.adminQuery, tables));
  for (const v of leaves(rowsOf(baselineB))) {
    if (a.has(v) || g.has(v)) continue;
    if (typeof v === 'number') {
      if (Math.abs(v) >= 100) markers.numbers.push(v);
    } else if (UUID.test(v)) markers.uuids.push(v.toLowerCase());
    else if (v.length >= 3) markers.strings.push(v);
  }
}, 180_000);

afterAll(async () => {
  await db?.close();
});

type Outcome = { ok: true; value: unknown } | { ok: false; error: unknown };

async function bytesOf(s: Readable): Promise<Uint8Array> {
  const parts: Buffer[] = [];
  for await (const c of s) parts.push(Buffer.from(c as Uint8Array));
  return new Uint8Array(Buffer.concat(parts));
}

async function settle(f: () => Promise<unknown>): Promise<Outcome> {
  try {
    let value = await f();
    if (value && typeof value === 'object' && (value as { stream?: unknown }).stream instanceof Readable) {
      value = { ...value, stream: await bytesOf((value as { stream: Readable }).stream) };
    }
    return { ok: true, value };
  } catch (error) {
    return { ok: false, error };
  }
}

const errorText = (e: unknown): string => {
  const x = e as { message?: string; detail?: string; cause?: { message?: string; detail?: string } };
  return [x?.message ?? String(e), x?.detail, x?.cause?.message, x?.cause?.detail].filter(Boolean).join(' | ');
};

function render(o: Outcome): string {
  if (!o.ok) return errorText(o.error);
  return (
    JSON.stringify(o.value, (_k, v: unknown) => {
      if (v instanceof Map) return [...v];
      if (v instanceof Set) return [...v];
      if (v instanceof Uint8Array) return `\\x${Buffer.from(v).toString('hex')}`;
      if (v && typeof v === 'object' && (v as { type?: unknown }).type === 'Buffer' && Array.isArray((v as { data?: unknown }).data)) {
        return `\\x${Buffer.from((v as { data: number[] }).data).toString('hex')}`;
      }
      return typeof v === 'bigint' ? String(v) : v;
    }) ?? 'undefined'
  );
}

/** Values of tenant B in what the call returned (or the error it threw). */
function tenantBIn(o: Outcome, echoed: ReadonlySet<string | number>): (string | number)[] {
  const text = render(o);
  const lower = text.toLowerCase();
  const hits: (string | number)[] = [];
  for (const u of markers.uuids) if (!echoed.has(u) && lower.includes(u)) hits.push(u);
  for (const s of markers.strings) {
    if (echoed.has(s)) continue;
    if (o.ok ? text.includes(JSON.stringify(s)) : text.includes(s)) hits.push(s);
  }
  for (const n of markers.numbers) {
    const t = String(n).replace('.', '\\.');
    if (new RegExp(`(?<=[:\\[,])${t}(?=[,\\]\\}])|"${t}"`).test(text)) hits.push(n);
  }
  return hits;
}

/** null, false, [], an empty Map, or an object of only those: what "not one of this tenant's" looks like. */
function nothingFound(v: unknown): boolean {
  if (v === null || v === false) return true;
  if (Array.isArray(v)) return v.length === 0;
  if (v instanceof Map) return v.size === 0;
  if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
    const values = Object.values(v);
    return values.length > 0 && values.every(nothingFound);
  }
  return false;
}

/** How a call was refused, or null: nothing found, RLS, an id that is taken, or a data-access not-found error. */
function refusal(o: Outcome): string | null {
  if (o.ok) return nothingFound(o.value) ? 'nothing found' : null;
  const e = o.error as { code?: string; cause?: { code?: string } };
  const code = e?.cause?.code ?? e?.code;
  const text = errorText(o.error);
  if (code === '42501' && /row-level security/.test(text)) return 'row-level security';
  if (code === '23505') return 'id already taken';
  if (o.error instanceof ScenarioVersionError) return 'not found (version)';
  if (/data-access: no (scenario|changeset) |resolveScenarioChain: unknown scenario/.test(text)) return 'not found';
  return null;
}

const isBug = (e: unknown): boolean =>
  e instanceof TypeError || e instanceof RangeError || e instanceof ReferenceError || e instanceof SyntaxError || e instanceof TenantScopeError;

type Mode = 'own' | 'atB' | 'crossed';

async function verify(label: string, mode: Mode, c: Pick<Case<unknown>, 'kind' | 'atBWritesOwnTenant' | 'ownMayBeEmpty'>, o: Outcome): Promise<void> {
  const problems: string[] = [];
  // tenant B's stored rows, compared with the last snapshot first, so a failure is reported by this call only
  const now = await tenantSnapshot(db.adminQuery, tables, TENANT_B);
  const changed = tables.filter((t) => JSON.stringify(now.get(t.name)) !== JSON.stringify(baselineB.get(t.name))).map((t) => t.name);
  baselineB = now;
  if (changed.length > 0) problems.push(`rows of tenant B changed in ${changed.join(', ')}`);

  if (!o.ok && isBug(o.error)) problems.push(`the case itself is broken: ${errorText(o.error)}`);
  // an argument echoed back (in a result or in the parameters of a failed query) is not a leak:
  // B's ids in atB calls, and in the crossed mode tenant B's id, which is the scope the repository was given
  const echoed = mode === 'atB' ? targetsOfB : mode === 'crossed' ? new Set([TENANT_B]) : new Set<string>();
  const leaked = tenantBIn(o, echoed);
  if (leaked.length > 0) problems.push(`returned tenant B's data (${leaked.join(', ')})`);
  if (mode === 'own') {
    if (!o.ok) problems.push('failed as tenant A');
    else if (c.kind === 'write' && refusal(o) !== null) problems.push('wrote nothing as tenant A');
    else if (c.kind === 'read' && !c.ownMayBeEmpty && nothingFound(o.value)) problems.push('tenant A got nothing of its own');
  } else if (mode === 'atB') {
    if (c.kind === 'write' && c.atBWritesOwnTenant) {
      if (!o.ok) problems.push('failed');
    } else if (refusal(o) === null) problems.push(c.kind === 'write' ? 'a write aimed at tenant B was not refused' : 'found something of tenant B');
  } else if (c.kind === 'write' && refusal(o) === null) {
    problems.push('a write with tenant B\'s id was not refused');
  }
  expect(problems, `${label}: ${render(o)}`).toEqual([]);
}

class Rollback {
  constructor(readonly outcome: Outcome) {}
}

/** The outcome of `f` inside the transaction `open` hands out, which is then rolled back. */
async function rolledBack<X>(open: (body: (x: X) => Promise<never>) => Promise<unknown>, f: (x: X) => Promise<unknown>): Promise<Outcome> {
  try {
    await open(async (x) => {
      throw new Rollback(await settle(() => f(x)));
    });
  } catch (e) {
    if (e instanceof Rollback) return e.outcome;
    throw e;
  }
  throw new Error('unreachable: the transaction was not rolled back');
}

/** As tenant A, committed; the call in a savepoint so a refused statement leaves the transaction usable. */
const asA = (f: (tx: TenantTx) => Promise<unknown>): Promise<Outcome> =>
  withTenant(db.app.db, TENANT_A, ANA, (tx) => settle(() => tx.transaction((sp) => f(sp))));
const asARolledBack = (f: (tx: TenantTx) => Promise<unknown>): Promise<Outcome> =>
  rolledBack((body) => withTenant(db.app.db, TENANT_A, ANA, body), f);
/**
 * Tenant B's id over tenant A's connection: app.tenant_id is A (set first, as withTenant does), but
 * data-access's scope says B, so the repository filters and writes tenant_id = B. Committed.
 */
const crossed = (f: (tx: TenantTx) => Promise<unknown>): Promise<Outcome> =>
  db.app.db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.tenant_id', ${TENANT_A}, true), set_config('app.user_id', ${ANA}, true)`);
    return runScoped(tx, { kind: 'tenant', tenantId: TENANT_B, userId: ANA }, () => settle(() => tx.transaction((sp) => f(sp))));
  });
/** Before a tenant is chosen, as DORA (member of tenant A only). */
const asDora = (f: (tx: UserTx) => Promise<unknown>): Promise<Outcome> => withUser(db.app.db, DORA, (tx) => settle(() => f(tx)));

/** A case whose calls are bound to what they call: functions of the transaction, port or store. */
interface Bound<C> extends Pick<Case<C>, 'kind' | 'atBWritesOwnTenant' | 'ownMayBeEmpty'> {
  readonly own: (c: C) => Promise<unknown>;
  readonly atB: readonly ((c: C) => Promise<unknown>)[];
}

/** Binds argument lists to `target` (the named repository or method); function calls stay as they are. */
function bind<C>(target: (c: C) => Fn, c: Case<C>): Bound<C> {
  const call = (k: Call<C>) => (x: C): Promise<unknown> => (typeof k === 'function' ? k(x) : target(x)(...k));
  return { ...c, own: call(c.own), atB: (c.atB ?? []).map(call) };
}

const repo = (name: string) => (tx: unknown): Fn => (...args) => (dataAccess as unknown as Record<string, Fn>)[name]!(tx, ...args);
const method = <C>(m: string) => (x: C): Fn => (...args) => (x as unknown as Record<string, Fn>)[m]!.apply(x, args);

/** A repository taking the transaction of withTenant: as tenant A, aimed at B, and with B's id over A. */
async function runTenantCase(label: string, c: Bound<TenantTx>): Promise<void> {
  await verify(`${label} as tenant A`, 'own', c, c.kind === 'write' ? await asARolledBack(c.own) : await asA(c.own));
  for (const [i, k] of c.atB.entries()) await verify(`${label} aimed at tenant B #${i + 1}`, 'atB', c, await asA(k));
  await verify(`${label} with tenant B's id over tenant A's connection`, 'crossed', c, await crossed(c.own));
}

async function runUserCase(label: string, c: Bound<UserTx>): Promise<void> {
  await verify(`${label} as a user of tenant A only`, 'own', c, await asDora(c.own));
  for (const [i, k] of c.atB.entries()) await verify(`${label} aimed at tenant B #${i + 1}`, 'atB', c, await asDora(k));
}

/** The ChangesetTx methods through a factory that takes the withTenant transaction (all three ways), or one that opens its own. */
async function runPort(entry: string): Promise<void> {
  const onTx: Record<string, (tx: TenantTx, f: (p: ChangesetTx) => Promise<unknown>) => Promise<unknown>> = {
    changesetTx: (tx, f) => f(changesetTx(tx)),
    createChangesetStore: (tx, f) => createChangesetStore(tx).transaction(f),
  };
  for (const [m, c] of Object.entries(PORT_CASES)) {
    const label = `${entry} → ${m}`;
    const b = bind(method<ChangesetTx>(m), c);
    const open = onTx[entry];
    if (open) {
      await runTenantCase(label, { ...b, own: (tx) => open(tx, b.own), atB: b.atB.map((k) => (tx: TenantTx) => open(tx, k)) });
      continue;
    }
    // createTenantChangesetStore: its own withTenant per transaction(fn), for the tenant it is given
    const store = createTenantChangesetStore(db.app.db, TENANT_A, ANA);
    const own = c.kind === 'write' ? await rolledBack((body) => store.transaction(body), b.own) : await settle(() => store.transaction(b.own));
    await verify(`${label} as tenant A`, 'own', c, own);
    for (const [i, k] of b.atB.entries()) await verify(`${label} aimed at tenant B #${i + 1}`, 'atB', c, await settle(() => store.transaction(k)));
  }
}

/** PostgresObjectStore bound to tenant A: each method as tenant A and aimed at B (it opens its own withTenant). */
async function runStore(): Promise<void> {
  const store = new PostgresObjectStore(db.app.db, TENANT_A, ANA);
  for (const [m, c] of Object.entries(STORE_CASES)) {
    const label = `PostgresObjectStore(tenant A).${m}`;
    const b = bind(method<ObjectStore>(m), c);
    await verify(`${label} as tenant A`, 'own', c, await settle(() => b.own(store)));
    for (const [i, k] of b.atB.entries()) await verify(`${label} aimed at tenant B #${i + 1}`, 'atB', c, await settle(() => k(store)));
  }
}

async function runEntry(name: string, entry: Entry): Promise<void> {
  switch (entry.via) {
    case 'tenant':
      return runTenantCase(name, bind(repo(name), entry.case));
    case 'user':
      return runUserCase(name, bind(repo(name), entry.case));
    case 'either':
      await runTenantCase(name, bind(repo(name), entry.case));
      return runUserCase(name, bind(repo(name), entry.case as unknown as Case<UserTx>));
    case 'port':
      return runPort(name);
    case 'store':
      return runStore();
  }
}

// ---------------------------------------------------------------------------------- tests

describe('repository discovery', () => {
  it('the repository list is discovered from data-access exports: a repository without a leak case fails (test)', () => {
    const fns = Object.entries(dataAccess as Record<string, unknown>).filter(([, v]) => typeof v === 'function');
    const isError = (v: unknown): boolean => (v as { prototype?: unknown }).prototype instanceof Error;
    const repositories = fns.filter(([n, v]) => !isError(v) && !(n in NOT_REPOSITORIES)).map(([n]) => n).sort();
    expect(
      repositories,
      'every data-access export that is not an error class or listed in NOT_REPOSITORIES needs a leak case in CASES (and no case may outlive its export)',
    ).toEqual(Object.keys(CASES).sort());
    // NOT_REPOSITORIES holds no repository in disguise: none calls a scope guard or opens a scope
    for (const name of Object.keys(NOT_REPOSITORIES)) {
      const fn = (dataAccess as Record<string, unknown>)[name];
      expect(typeof fn, `${name} is listed in NOT_REPOSITORIES but not exported`).toBe('function');
      expect(opensTenantData(fn, name), `${name} calls a scope guard or opens a scope: it is a repository, give it a leak case`).toBe(false);
    }
    // ... and the detector does see the repositories
    for (const name of Object.keys(CASES)) {
      expect(opensTenantData((dataAccess as Record<string, unknown>)[name], name), `${name}: no scope guard found`).toBe(true);
    }
    // the methods behind the factories, read from the objects they return
    expect(Object.keys(changesetTx({} as TenantTx)).sort(), 'every ChangesetTx method needs a case in PORT_CASES').toEqual(Object.keys(PORT_CASES).sort());
    const storeMethods = Object.getOwnPropertyNames(PostgresObjectStore.prototype).filter((n) => n !== 'constructor' && !(n in STORE_INTERNAL));
    expect(storeMethods.sort(), 'every PostgresObjectStore method needs a case in STORE_CASES').toEqual(Object.keys(STORE_CASES).sort());
  });
});

describe('two tenants seeded: every read repo as tenant A returns 0 tenant-B rows and every write with tenant B\'s id fails (leak.repos.spec.ts, G7)', () => {
  it('tenant B is seeded in every tenant table and recognisable by its values', () => {
    for (const t of tables) expect(baselineB.get(t.name)!.length, `${t.name}: no row of tenant B in the leak seed`).toBeGreaterThan(0);
    expect(markers.uuids).toEqual(expect.arrayContaining([TENANT_B, GC_B, twinB(CS.c1), IDS.B.solverRun]));
    expect(markers.strings).toEqual(expect.arrayContaining(['Tenant B', 'vp_b', 'h9-b', 'tenant-b prompt']));
    expect(markers.numbers.length).toBeGreaterThan(0);
  });

  for (const [name, entry] of Object.entries(CASES)) {
    it(`${name}`, async () => {
      await runEntry(name, entry);
    });
  }

  it('the scope tenant is never taken from the caller: rows a repository writes as tenant A carry tenant A', async () => {
    const row = await asA(async (tx) => {
      const run = await dataAccess.createSolverRun(tx, { kind: 'goal_seek', scenario_id: GC_A, spec: { by: 'leak test' } });
      await changesetTx(tx).appendAudit({ actor: ANA, action: 'leak.tenant', entity: 'scenario', entity_key: GC_A, before: null, after: null, at: NOW });
      return run.id;
    });
    expect(row.ok).toBe(true);
    const stored = await db.adminQuery(
      `select (select tenant_id from solver_run where id = $1::uuid) as run, (select tenant_id from audit_log where action = 'leak.tenant') as audit`,
      [(row as { value: string }).value],
    );
    expect(stored.rows[0]).toEqual({ run: TENANT_A, audit: TENANT_A });
  });
});
