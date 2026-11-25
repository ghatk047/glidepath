/**
 * ChangesetStore over Postgres (DATA-06): the implementation of the domain port (ADR-019) that
 * `applyChangeset` writes through. Every method runs on the transaction of a live `withTenant`, so RLS
 * applies, `tenant_id` comes from the tenant scope (never from the caller) and a throw rolls
 * everything back with the caller's transaction.
 */
import {
  resolveScenarioChain,
  type AuditEntry,
  type CalcRunRow,
  type ChangeRow,
  type Changeset,
  type ChangesetId,
  type ChangesetStatus,
  type InputState,
  type JsonObject,
  type JsonValue,
  type MemberWrite,
  type NodeOverrideRow,
  type ScenarioId,
  type ScenarioLevel,
  type ScenarioPatch,
  type ScenarioRow,
  type ScenarioStore,
  type ScenarioTx,
  type UserId,
  type ValueWrite,
} from '@glidepath/domain';
import type { DimId, MemberId, TenantMembers } from '@glidepath/spec';
import { and, asc, eq, getTableColumns, gte, inArray, sql } from 'drizzle-orm';
import type { AnyColumn, SQL } from 'drizzle-orm';
import type { Db } from '../db';
import { changeRows } from '../repos/changesets';
import { invalidateMembersCache, loadMembers } from '../repos/members';
import { isUuid, iso, jsonb, num, numeric, toDate } from '../repos/rows';
import {
  audit_log,
  calc_run,
  change,
  changeset,
  dimension_member,
  line_item,
  line_item_lever,
  node_override,
  scenario,
  scenario_value,
  variable_value,
} from '../schema';
import { tenantScope } from '../scope';
import { withTenant } from '../tenant';
import type { TenantTx } from '../tenant';

/** The dimension whose members live in line_item (every other tenant member: dimension_member). */
const LINE_DIM = 'line';

export interface ChangesetStoreOptions {
  /**
   * variable_value.confidence (H/M/L, NOT NULL) of a tenant default this store inserts. The port
   * carries no confidence, so a row that already exists keeps its own; a new one gets this.
   */
  readonly newValueConfidence?: string;
}

/** Confidence of a variable_value row inserted through the port (a user's value, not a filing's). */
export const DEFAULT_NEW_VALUE_CONFIDENCE = 'M';

/** `bumpVersion` found the scenario at another version (or gone): someone else committed first. */
export class ScenarioVersionError extends Error {
  readonly code = 'SCENARIO_VERSION';
  constructor(
    readonly scenarioId: ScenarioId,
    readonly expected: number,
  ) {
    super(`data-access: scenario ${scenarioId} is no longer at version ${expected}`);
    this.name = 'ScenarioVersionError';
  }
}

const SCENARIO_FIELDS = getTableColumns(scenario);
type ScenarioDbRow = typeof scenario.$inferSelect;

const scenarioRow = (r: ScenarioDbRow): ScenarioRow => ({
  id: r.id,
  key: r.key,
  label: r.label,
  kind: r.kind,
  parent_id: r.parent_id,
  model_version_id: r.model_version_id,
  version: r.version,
  locked: r.locked,
  created_by: r.created_by,
  created_at: iso(r.created_at),
});

/** Code-point order, as the spec's member order and the read repositories use. */
const codePoint = (col: AnyColumn): SQL => sql`${col} collate "C"`;

const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

// ---------------------------------------------------------------------------------- line_item rows

type LineColumns = typeof line_item.$inferInsert;
const LINE_COLUMNS = getTableColumns(line_item);
/** The columns of `MemberWrite.row` for a line: all but the key columns. */
const LINE_ROW_COLUMNS = Object.keys(LINE_COLUMNS).filter((c) => c !== 'tenant_id' && c !== 'member_key');
const NUMERIC_LINE_COLUMNS = new Set(
  Object.entries(LINE_COLUMNS)
    .filter(([, col]) => col.columnType === 'PgNumeric')
    .map(([name]) => name),
);

/** A line_item row as the domain's `MemberWrite.row` / `loadMemberRows` content: the table's columns. */
function lineRowJson(r: typeof line_item.$inferSelect): JsonObject {
  const out: Record<string, JsonValue> = {};
  for (const c of LINE_ROW_COLUMNS) {
    const v = (r as Record<string, unknown>)[c] as JsonValue | undefined;
    out[c] = v !== undefined && v !== null && NUMERIC_LINE_COLUMNS.has(c) ? num(v) : (v ?? null);
  }
  return out;
}

/** The values of a line row to write, refusing columns the table does not have. */
function lineValues(row: JsonObject): Partial<LineColumns> {
  const unknown = Object.keys(row).filter((c) => !LINE_ROW_COLUMNS.includes(c));
  if (unknown.length > 0) {
    throw new Error(`data-access: line_item has no column ${unknown.join(', ')}`);
  }
  const out: Record<string, unknown> = {};
  for (const [c, v] of Object.entries(row)) {
    out[c] = NUMERIC_LINE_COLUMNS.has(c) && typeof v === 'number' ? numeric(v) : v;
  }
  return out as Partial<LineColumns>;
}

const MEMBER_COLUMNS = ['label', 'attrs', 'sort', 'active'] as const;

/** The values of a dimension_member row to write (`attrs` and `active` default as a new member's do). */
function memberValues(row: JsonObject): Partial<typeof dimension_member.$inferInsert> {
  const unknown = Object.keys(row).filter((c) => !(MEMBER_COLUMNS as readonly string[]).includes(c));
  if (unknown.length > 0) {
    throw new Error(`data-access: dimension_member has no column ${unknown.join(', ')}`);
  }
  return row as Partial<typeof dimension_member.$inferInsert>;
}

// ---------------------------------------------------------------------------------- the transaction

/**
 * The port's transaction view over `tx`, the transaction of a running `withTenant` (or a savepoint
 * opened from it). It adds nothing of its own: commit and rollback are the caller's.
 */
export function changesetTx(tx: TenantTx, options: ChangesetStoreOptions = {}): ScenarioTx {
  const confidence = options.newValueConfidence ?? DEFAULT_NEW_VALUE_CONFIDENCE;
  if (confidence.length !== 1) {
    throw new RangeError('data-access: newValueConfidence must be one character (H, M or L)');
  }
  const scope = (what: string) => tenantScope(tx, `ChangesetTx.${what}`).tenantId;
  /** Scenarios this transaction has seen in the tenant: a scenario_value / node_override has no FK. */
  const known = new Set<string>();

  async function requireScenario(tenantId: string, id: string): Promise<void> {
    if (known.has(id)) return;
    const found = isUuid(id)
      ? await tx
          .select({ id: scenario.id })
          .from(scenario)
          .where(and(eq(scenario.tenant_id, tenantId), eq(scenario.id, id)))
      : [];
    if (found.length === 0) throw new Error(`data-access: no scenario ${id} in this tenant`);
    known.add(id);
  }

  /** The stored changesets of `where`, oldest first, with their change rows. */
  async function changesets(
    tenantId: string,
    where: SQL | undefined,
    order: readonly SQL[],
  ): Promise<Changeset[]> {
    const rows = await tx
      .select()
      .from(changeset)
      .where(and(eq(changeset.tenant_id, tenantId), where))
      .orderBy(...order);
    const changes = await changeRows(tx, tenantId, rows.map((r) => r.id));
    return rows.map((r) => ({
      id: r.id,
      origin: r.origin,
      scenario_id: r.scenario_id,
      base_scenario_version: r.base_scenario_version,
      status: r.status,
      summary: r.summary as JsonValue,
      created_by: r.created_by,
      created_at: iso(r.created_at),
      reverts_id: r.reverts_id,
      changes: changes.get(r.id) ?? [],
    }));
  }

  async function writeValue(w: ValueWrite): Promise<void> {
    const tenantId = scope('writeValue');
    if (w.target === 'variable_value') {
      if (w.value === null) {
        await tx
          .delete(variable_value)
          .where(
            and(
              eq(variable_value.tenant_id, tenantId),
              eq(variable_value.var_key, w.key),
              eq(variable_value.member_key, w.member_key),
            ),
          );
        return;
      }
      const set = {
        value: numeric(w.value),
        note: w.note ?? '',
        changeset_id: w.changeset_id,
        updated_at: sql`now()`,
      };
      // confidence and source_id are not touched on an existing row: the port does not carry them.
      await tx
        .insert(variable_value)
        .values({
          tenant_id: tenantId,
          var_key: w.key,
          member_key: w.member_key,
          source_id: null,
          confidence,
          ...set,
        })
        .onConflictDoUpdate({
          target: [variable_value.tenant_id, variable_value.var_key, variable_value.member_key],
          set,
        });
      return;
    }
    await requireScenario(tenantId, w.scenario_id);
    if (w.target === 'scenario_value') {
      if (w.value === null) {
        await tx
          .delete(scenario_value)
          .where(
            and(
              eq(scenario_value.tenant_id, tenantId),
              eq(scenario_value.scenario_id, w.scenario_id),
              eq(scenario_value.var_key, w.key),
              eq(scenario_value.member_key, w.member_key),
            ),
          );
        return;
      }
      const set = { value: numeric(w.value), changeset_id: w.changeset_id };
      await tx
        .insert(scenario_value)
        .values({
          tenant_id: tenantId,
          scenario_id: w.scenario_id,
          var_key: w.key,
          member_key: w.member_key,
          ...set,
        })
        .onConflictDoUpdate({
          target: [
            scenario_value.tenant_id,
            scenario_value.scenario_id,
            scenario_value.var_key,
            scenario_value.member_key,
          ],
          set,
        });
      return;
    }
    if (w.value === null) {
      await tx
        .delete(node_override)
        .where(
          and(
            eq(node_override.tenant_id, tenantId),
            eq(node_override.scenario_id, w.scenario_id),
            eq(node_override.node_key, w.key),
            eq(node_override.member_key, w.member_key),
          ),
        );
      return;
    }
    const set = { value: numeric(w.value), reason: w.reason ?? '' };
    await tx
      .insert(node_override)
      .values({
        tenant_id: tenantId,
        scenario_id: w.scenario_id,
        node_key: w.key,
        member_key: w.member_key,
        ...set,
      })
      .onConflictDoUpdate({
        target: [
          node_override.tenant_id,
          node_override.scenario_id,
          node_override.node_key,
          node_override.member_key,
        ],
        set,
      });
  }

  async function writeMember(w: MemberWrite): Promise<void> {
    const tenantId = scope('writeMember');
    // A structural write: no cached members snapshot of the tenant is used again (DATA-13).
    invalidateMembersCache(tenantId);
    if ((w.target === 'line_item') !== (w.dim_key === LINE_DIM)) {
      throw new Error(`data-access: ${w.target} does not hold dimension ${w.dim_key}`);
    }
    if (w.target === 'line_item') {
      if (w.row === null) {
        // A line's lever mappings go with it (their FK would refuse the delete otherwise).
        await tx
          .delete(line_item_lever)
          .where(and(eq(line_item_lever.tenant_id, tenantId), eq(line_item_lever.line_key, w.member_key)));
        await tx
          .delete(line_item)
          .where(and(eq(line_item.tenant_id, tenantId), eq(line_item.member_key, w.member_key)));
        return;
      }
      const set = lineValues(w.row);
      // Update first: a partial row changes what it names on an existing line, which an INSERT ... ON
      // CONFLICT could not (the insert tuple is checked for NOT NULL before the conflict is seen).
      if (Object.keys(set).length > 0) {
        const done = await tx
          .update(line_item)
          .set(set)
          .where(and(eq(line_item.tenant_id, tenantId), eq(line_item.member_key, w.member_key)))
          .returning({ member_key: line_item.member_key });
        if (done.length > 0) return;
      }
      await tx
        .insert(line_item)
        .values({ tenant_id: tenantId, member_key: w.member_key, ...set } as LineColumns);
      return;
    }
    if (w.row === null) {
      await tx
        .delete(dimension_member)
        .where(
          and(
            eq(dimension_member.tenant_id, tenantId),
            eq(dimension_member.dim_key, w.dim_key),
            eq(dimension_member.member_key, w.member_key),
          ),
        );
      return;
    }
    const set = memberValues(w.row);
    if (Object.keys(set).length > 0) {
      const done = await tx
        .update(dimension_member)
        .set(set)
        .where(
          and(
            eq(dimension_member.tenant_id, tenantId),
            eq(dimension_member.dim_key, w.dim_key),
            eq(dimension_member.member_key, w.member_key),
          ),
        )
        .returning({ member_key: dimension_member.member_key });
      if (done.length > 0) return;
    }
    await tx
      .insert(dimension_member)
      .values({
        tenant_id: tenantId,
        dim_key: w.dim_key,
        member_key: w.member_key,
        attrs: {},
        active: true,
        ...set,
      } as typeof dimension_member.$inferInsert);
  }

  return {
    async loadScenarioForUpdate(scenarioId: ScenarioId): Promise<ScenarioRow | null> {
      const tenantId = scope('loadScenarioForUpdate');
      if (!isUuid(scenarioId)) return null;
      const [row] = await tx
        .select(SCENARIO_FIELDS)
        .from(scenario)
        .where(and(eq(scenario.tenant_id, tenantId), eq(scenario.id, scenarioId)))
        .for('update');
      if (row) known.add(row.id);
      return row ? scenarioRow(row) : null;
    },

    async lockTenantDefaults(): Promise<void> {
      const tenantId = scope('lockTenantDefaults');
      // Transaction-scoped (released at COMMIT/ROLLBACK, pooler safe), one key per tenant.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`glidepath:tenant-defaults:${tenantId}`}::text, 0))`,
      );
    },

    async loadScenarios(): Promise<readonly ScenarioRow[]> {
      const tenantId = scope('loadScenarios');
      const rows = await tx
        .select()
        .from(scenario)
        .where(eq(scenario.tenant_id, tenantId))
        .orderBy(asc(scenario.created_at), codePoint(scenario.key));
      return rows.map(scenarioRow);
    },

    async loadInputs(scenarioId: ScenarioId | null): Promise<InputState> {
      const tenantId = scope('loadInputs');
      const defaults = (
        await tx
          .select({ var_key: variable_value.var_key, member_key: variable_value.member_key, value: variable_value.value })
          .from(variable_value)
          .where(eq(variable_value.tenant_id, tenantId))
          .orderBy(codePoint(variable_value.var_key), codePoint(variable_value.member_key))
      ).map((r) => ({ var_key: r.var_key, member_key: r.member_key, value: num(r.value) }));
      if (scenarioId === null) return { defaults, chain: [], overrides: [] };

      const links = await tx
        .select({ id: scenario.id, parent_id: scenario.parent_id })
        .from(scenario)
        .where(eq(scenario.tenant_id, tenantId));
      // Root ancestor first, the scenario itself last: one level each, also when it has no rows.
      const ids = resolveScenarioChain(links, scenarioId);
      const valueRows = await tx
        .select({
          scenario_id: scenario_value.scenario_id,
          var_key: scenario_value.var_key,
          member_key: scenario_value.member_key,
          value: scenario_value.value,
        })
        .from(scenario_value)
        .where(and(eq(scenario_value.tenant_id, tenantId), inArray(scenario_value.scenario_id, [...ids])))
        .orderBy(codePoint(scenario_value.var_key), codePoint(scenario_value.member_key));
      const chain: ScenarioLevel[] = ids.map((id) => ({
        scenario_id: id,
        values: valueRows
          .filter((r) => r.scenario_id === id)
          .map((r) => ({ var_key: r.var_key, member_key: r.member_key, value: num(r.value) })),
      }));
      const overrides: NodeOverrideRow[] = (
        await tx
          .select()
          .from(node_override)
          .where(and(eq(node_override.tenant_id, tenantId), eq(node_override.scenario_id, scenarioId)))
          .orderBy(codePoint(node_override.node_key), codePoint(node_override.member_key))
      ).map((r) => ({ node_key: r.node_key, member_key: r.member_key, value: num(r.value), reason: r.reason }));
      return { defaults, chain, overrides };
    },

    async loadMembers(): Promise<TenantMembers> {
      scope('loadMembers');
      // v_dimension_members; `members` holds the active ones, in the spec's member order. Cached per
      // (tenant, members version): a changeset that changes no member neither reads nor hashes them.
      return (await loadMembers(tx)).members;
    },

    async loadMemberRows(dim: DimId, memberKeys: readonly MemberId[]): Promise<ReadonlyMap<MemberId, JsonObject>> {
      const tenantId = scope('loadMemberRows');
      const out = new Map<MemberId, JsonObject>();
      const keys = [...new Set(memberKeys)];
      if (keys.length === 0) return out;
      if (dim === LINE_DIM) {
        const rows = await tx
          .select()
          .from(line_item)
          .where(and(eq(line_item.tenant_id, tenantId), inArray(line_item.member_key, keys)));
        for (const r of rows) out.set(r.member_key, lineRowJson(r));
        return out;
      }
      const rows = await tx
        .select()
        .from(dimension_member)
        .where(
          and(
            eq(dimension_member.tenant_id, tenantId),
            eq(dimension_member.dim_key, dim),
            inArray(dimension_member.member_key, keys),
          ),
        );
      for (const r of rows) {
        out.set(r.member_key, {
          label: r.label,
          attrs: (isObject(r.attrs) ? r.attrs : {}) as JsonObject,
          sort: r.sort,
          active: r.active,
        });
      }
      return out;
    },

    async loadChangeset(id: ChangesetId): Promise<Changeset | null> {
      const tenantId = scope('loadChangeset');
      if (!isUuid(id)) return null;
      const [found] = await changesets(tenantId, eq(changeset.id, id), [asc(changeset.id)]);
      return found ?? null;
    },

    async findChangesetByClientRequest(createdBy: UserId, clientRequestId: string): Promise<Changeset | null> {
      const tenantId = scope('findChangesetByClientRequest');
      if (!isUuid(createdBy)) return null;
      const [found] = await changesets(
        tenantId,
        and(
          eq(changeset.created_by, createdBy),
          sql`${changeset.summary} ->> 'client_request_id' = ${clientRequestId}`,
        ),
        [asc(changeset.created_at), asc(changeset.id)],
      );
      return found ?? null;
    },

    async changesSince(scenarioId: ScenarioId | null, fromVersion: number): Promise<readonly Changeset[]> {
      const tenantId = scope('changesSince');
      if (scenarioId !== null && !isUuid(scenarioId)) return [];
      return changesets(
        tenantId,
        and(
          sql`${changeset.scenario_id} is not distinct from ${scenarioId}::uuid`,
          inArray(changeset.status, ['applied', 'reverted']),
          gte(changeset.base_scenario_version, fromVersion),
        ),
        [asc(changeset.base_scenario_version), asc(changeset.created_at), asc(changeset.id)],
      );
    },

    async createScenario(row: ScenarioRow): Promise<void> {
      const tenantId = scope('createScenario');
      await tx.insert(scenario).values({
        tenant_id: tenantId,
        id: row.id,
        key: row.key,
        label: row.label,
        kind: row.kind,
        parent_id: row.parent_id,
        model_version_id: row.model_version_id,
        version: row.version,
        locked: row.locked,
        created_by: row.created_by,
        created_at: toDate(row.created_at),
      });
      known.add(row.id);
    },

    async insertChangeset(cs: Changeset): Promise<void> {
      const tenantId = scope('insertChangeset');
      await tx.insert(changeset).values({
        tenant_id: tenantId,
        id: cs.id,
        origin: cs.origin,
        scenario_id: cs.scenario_id,
        base_scenario_version: cs.base_scenario_version,
        status: cs.status,
        summary: jsonb(cs.summary),
        created_by: cs.created_by,
        created_at: toDate(cs.created_at),
        reverts_id: cs.reverts_id,
      });
      if (cs.changes.length === 0) return;
      await tx.insert(change).values(
        cs.changes.map((c: ChangeRow) => ({
          tenant_id: tenantId,
          changeset_id: cs.id,
          seq: c.seq,
          target: c.target,
          key: c.key,
          member_key: c.member_key,
          op: c.op,
          old_value: jsonb(c.old_value),
          new_value: jsonb(c.new_value),
          export_value: c.export_value,
          status: c.status,
          messages: jsonb(c.messages),
        })),
      );
    },

    async setChangesetStatus(id: ChangesetId, status: ChangesetStatus): Promise<void> {
      const tenantId = scope('setChangesetStatus');
      const done = isUuid(id)
        ? await tx
            .update(changeset)
            .set({ status })
            .where(and(eq(changeset.tenant_id, tenantId), eq(changeset.id, id)))
            .returning({ id: changeset.id })
        : [];
      if (done.length === 0) throw new Error(`data-access: no changeset ${id} in this tenant`);
    },

    writeValue,
    writeMember,

    async bumpVersion(scenarioId: ScenarioId, fromVersion: number): Promise<number> {
      const tenantId = scope('bumpVersion');
      const done = isUuid(scenarioId)
        ? await tx
            .update(scenario)
            .set({ version: fromVersion + 1 })
            .where(
              and(
                eq(scenario.tenant_id, tenantId),
                eq(scenario.id, scenarioId),
                eq(scenario.version, fromVersion),
              ),
            )
            .returning({ version: scenario.version })
        : [];
      if (done.length === 0) throw new ScenarioVersionError(scenarioId, fromVersion);
      return fromVersion + 1;
    },

    async findCalcRun(scenarioId: ScenarioId, inputHash: string): Promise<CalcRunRow | null> {
      const tenantId = scope('findCalcRun');
      if (!isUuid(scenarioId)) return null;
      const [r] = await tx
        .select()
        .from(calc_run)
        .where(
          and(
            eq(calc_run.tenant_id, tenantId),
            eq(calc_run.scenario_id, scenarioId),
            eq(calc_run.input_hash, inputHash),
          ),
        );
      return r
        ? {
            id: r.id,
            scenario_id: r.scenario_id,
            scenario_version: r.scenario_version,
            model_version_id: r.model_version_id,
            input_hash: r.input_hash,
            ms: r.ms,
            outputs: r.outputs as JsonValue,
            created_at: iso(r.created_at),
          }
        : null;
    },

    async upsertCalcRun(row: CalcRunRow): Promise<void> {
      const tenantId = scope('upsertCalcRun');
      // calc_run.ms is an integer column: a fractional duration is rounded.
      const set = {
        id: row.id,
        scenario_version: row.scenario_version,
        model_version_id: row.model_version_id,
        ms: Math.round(row.ms),
        outputs: jsonb(row.outputs),
        created_at: toDate(row.created_at),
      };
      await tx
        .insert(calc_run)
        .values({ tenant_id: tenantId, scenario_id: row.scenario_id, input_hash: row.input_hash, ...set })
        .onConflictDoUpdate({
          target: [calc_run.tenant_id, calc_run.scenario_id, calc_run.input_hash],
          set,
        });
    },

    async updateScenario(scenarioId: ScenarioId, patch: ScenarioPatch): Promise<void> {
      const tenantId = scope('updateScenario');
      // Metadata only (rename, lock, archive): the version and every other column stay as they are.
      const set = {
        ...(patch.label === undefined ? {} : { label: patch.label }),
        ...(patch.locked === undefined ? {} : { locked: patch.locked }),
        ...(patch.archived === undefined ? {} : { archived: patch.archived }),
      };
      if (Object.keys(set).length === 0) return;
      const done = isUuid(scenarioId)
        ? await tx
            .update(scenario)
            .set(set)
            .where(and(eq(scenario.tenant_id, tenantId), eq(scenario.id, scenarioId)))
            .returning({ id: scenario.id })
        : [];
      if (done.length === 0) throw new Error(`data-access: no scenario ${scenarioId} in this tenant`);
    },

    async appendAudit(entry: AuditEntry): Promise<void> {
      const tenantId = scope('appendAudit');
      await tx.insert(audit_log).values({
        tenant_id: tenantId,
        actor: entry.actor,
        action: entry.action,
        entity: entry.entity,
        entity_key: entry.entity_key,
        before: jsonb(entry.before),
        after: jsonb(entry.after),
        at: toDate(entry.at),
      });
    },
  };
}

// ---------------------------------------------------------------------------------- the store

/**
 * A ChangesetStore bound to the transaction `tx` of a running `withTenant`: `transaction(fn)` runs
 * `fn` in a savepoint of it, so a throw undoes what `fn` wrote and leaves the caller's transaction
 * usable, and a commit is the caller's. Throws TenantScopeError for any other transaction.
 */
export function createChangesetStore(tx: TenantTx, options: ChangesetStoreOptions = {}): ScenarioStore {
  tenantScope(tx, 'createChangesetStore');
  return {
    transaction: (fn) => tx.transaction((sp) => fn(changesetTx(sp as TenantTx, options))),
  };
}

/**
 * A ChangesetStore for the server: each `transaction(fn)` is its own `withTenant(db, tenantId, userId)`
 * transaction (RLS context set, committed when `fn` returns, rolled back when it throws).
 */
export function createTenantChangesetStore(
  db: Db,
  tenantId: string,
  userId: string,
  options: ChangesetStoreOptions = {},
): ScenarioStore {
  return {
    transaction: (fn) => withTenant(db, tenantId, userId, (tx) => fn(changesetTx(tx, options))),
  };
}
