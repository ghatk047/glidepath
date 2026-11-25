import type { ChangeRow, Changeset, JsonValue } from '@glidepath/domain';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { change } from '../schema';
import { tenantScope } from '../scope';
import type { TenantTx } from '../tenant';
import { isUuid, iso } from './rows';

/** A stored changeset with its change rows (domain Changeset) and the author's name (app_user.name). */
export interface ChangesetRecord extends Changeset {
  /** null when created_by names no app_user. */
  readonly created_by_name: string | null;
}

export interface ChangesetPage {
  /** Newest first (created_at, then id, descending). */
  readonly changesets: readonly ChangesetRecord[];
  /** Pass as `cursor` for the next (older) page; null on the last page. */
  readonly nextCursor: string | null;
}

export interface HistoryOptions {
  /** Page size, 1..{@link MAX_HISTORY_LIMIT}; default {@link DEFAULT_HISTORY_LIMIT}. */
  readonly limit?: number;
  /** `nextCursor` of the previous page. */
  readonly cursor?: string | null;
}

export const DEFAULT_HISTORY_LIMIT = 50;
export const MAX_HISTORY_LIMIT = 200;

/** A history cursor that this module did not produce (or that was altered). */
export class InvalidCursorError extends Error {
  readonly code = 'INVALID_CURSOR';
  constructor() {
    super('data-access: invalid changeset history cursor');
    this.name = 'InvalidCursorError';
  }
}

/** Keyset position: created_at in UTC with microseconds (exact, unlike a JS Date), and id. */
interface Position {
  readonly at: string;
  readonly id: string;
}

const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

const encodeCursor = (p: Position): string => Buffer.from(JSON.stringify([p.at, p.id]), 'utf8').toString('base64url');

function decodeCursor(cursor: string): Position {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw new InvalidCursorError();
  }
  if (!Array.isArray(parsed) || parsed.length !== 2) throw new InvalidCursorError();
  const [at, id] = parsed as unknown[];
  if (typeof at !== 'string' || !TIMESTAMP.test(at) || !isUuid(id)) throw new InvalidCursorError();
  return { at, id };
}

function pageSize(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_HISTORY_LIMIT;
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError(`data-access: history limit must be a positive integer, got ${limit}`);
  return Math.min(limit, MAX_HISTORY_LIMIT);
}

interface Raw extends Record<string, unknown> {
  id: string;
  origin: Changeset['origin'];
  scenario_id: string | null;
  base_scenario_version: number;
  status: Changeset['status'];
  summary: JsonValue;
  created_by: string;
  created_at: Date | string;
  at: string;
  reverts_id: string | null;
  created_by_name: string | null;
}

/** The change rows of `ids`, grouped by changeset id, each list in seq order. */
export async function changeRows(tx: TenantTx, tenantId: string, ids: readonly string[]): Promise<Map<string, ChangeRow[]>> {
  const out = new Map<string, ChangeRow[]>(ids.map((id) => [id, []]));
  if (ids.length === 0) return out;
  const rows = await tx
    .select()
    .from(change)
    .where(and(eq(change.tenant_id, tenantId), inArray(change.changeset_id, [...ids])))
    .orderBy(asc(change.changeset_id), asc(change.seq));
  for (const r of rows) {
    out.get(r.changeset_id)?.push({
      changeset_id: r.changeset_id,
      seq: r.seq,
      target: r.target,
      key: r.key,
      member_key: r.member_key,
      op: r.op,
      old_value: r.old_value as JsonValue,
      new_value: r.new_value as JsonValue,
      export_value: r.export_value as JsonValue | null,
      status: r.status,
      messages: r.messages as JsonValue,
    });
  }
  return out;
}

async function withChanges(tx: TenantTx, tenantId: string, raws: readonly Raw[]): Promise<ChangesetRecord[]> {
  const changes = await changeRows(tx, tenantId, raws.map((r) => r.id));
  return raws.map((r) => ({
    id: r.id,
    origin: r.origin,
    scenario_id: r.scenario_id,
    base_scenario_version: r.base_scenario_version,
    status: r.status,
    summary: r.summary,
    created_by: r.created_by,
    created_at: iso(r.created_at),
    reverts_id: r.reverts_id,
    created_by_name: r.created_by_name,
    changes: changes.get(r.id) ?? [],
  }));
}

const SELECT_CHANGESET = sql`
  select c.id, c.origin, c.scenario_id, c.base_scenario_version, c.status, c.summary, c.created_by,
         c.created_at, to_char(c.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as at, c.reverts_id, u.name as created_by_name
  from changeset c
  left join app_user u on u.id = c.created_by`;

/**
 * Changeset history of a scenario of the current tenant (null = the tenant defaults), newest first,
 * with each changeset's change rows; keyset-paginated by `cursor`. Every status is listed.
 */
export async function listChangesetHistory(
  tx: TenantTx,
  scenarioId: string | null,
  options: HistoryOptions = {},
): Promise<ChangesetPage> {
  const { tenantId } = tenantScope(tx, 'listChangesetHistory');
  const limit = pageSize(options.limit);
  const after = options.cursor ? decodeCursor(options.cursor) : null;
  if (scenarioId !== null && !isUuid(scenarioId)) return { changesets: [], nextCursor: null };
  const res = await tx.execute<Raw>(sql`${SELECT_CHANGESET}
    where c.tenant_id = ${tenantId}::uuid
      and c.scenario_id is not distinct from ${scenarioId}::uuid
      and (${after?.at ?? null}::timestamptz is null
           or (c.created_at, c.id) < (${after?.at ?? null}::timestamptz, ${after?.id ?? null}::uuid))
    order by c.created_at desc, c.id desc
    limit ${limit + 1}`);
  const page = res.rows.slice(0, limit);
  const last = page[page.length - 1];
  const nextCursor = res.rows.length > limit && last ? encodeCursor({ at: last.at, id: last.id }) : null;
  return { changesets: await withChanges(tx, tenantId, page), nextCursor };
}

/** One changeset of the current tenant with its change rows, or null. */
export async function getChangeset(tx: TenantTx, changesetId: string): Promise<ChangesetRecord | null> {
  const { tenantId } = tenantScope(tx, 'getChangeset');
  if (!isUuid(changesetId)) return null;
  const res = await tx.execute<Raw>(sql`${SELECT_CHANGESET}
    where c.tenant_id = ${tenantId}::uuid and c.id = ${changesetId}::uuid`);
  const [record] = await withChanges(tx, tenantId, res.rows);
  return record ?? null;
}
