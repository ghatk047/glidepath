/**
 * Ports (ADR-019): the domain is pure, so everything that reads or writes state goes through these
 * interfaces. `data-access` implements ChangesetStore over Postgres (DATA-06) inside the caller's
 * tenant transaction; the server owns the ModelCache. Tests use in-memory implementations.
 *
 * Rows omit `tenant_id`: the store is opened inside a tenant context and sets it (ADR-015).
 */
import {
  membersHash,
  type DimId,
  type MemberId,
  type NodeId,
  type TenantMembers,
  type VarId,
} from '@glidepath/spec';
import type {
  Changeset,
  ChangesetId,
  ChangesetStatus,
  JsonObject,
  JsonValue,
  ScenarioId,
  Timestamp,
  UserId,
} from './changeset';
import type { MemberKey } from './member-key';
import type { InputValueRow, NodeOverrideRow, ScenarioLevel } from './resolve';

/** scenario.kind */
export const SCENARIO_KINDS = ['preset', 'user', 'solver', 'blend'] as const;
export type ScenarioKind = (typeof SCENARIO_KINDS)[number];

/** One scenario row (schema.json tables.scenario, without tenant_id). */
export interface ScenarioRow {
  readonly id: ScenarioId;
  /** rates, A, B, C, D, or a user key; unique per tenant. */
  readonly key: string;
  readonly label: string;
  readonly kind: ScenarioKind;
  /** Inherits values not set here. */
  readonly parent_id: ScenarioId | null;
  readonly model_version_id: string;
  /** Bumps on every applied changeset. */
  readonly version: number;
  /** Presets are locked; copy to edit. */
  readonly locked: boolean;
  readonly created_by: UserId;
  readonly created_at: Timestamp;
}

/** Everything `resolveInputs` needs for one scenario, as stored. */
export interface InputState {
  /** variable_value rows (tenant defaults). */
  readonly defaults: readonly InputValueRow[];
  /**
   * scenario_value rows per scenario, from the root ancestor to the scenario: one level per scenario,
   * also when it has no rows, so the last level is the scenario itself. Empty for tenant defaults.
   */
  readonly chain: readonly ScenarioLevel[];
  /** The scenario's own node_override rows; empty for tenant defaults. */
  readonly overrides: readonly NodeOverrideRow[];
}

/**
 * Upsert or delete one value row; `value` null deletes it. Fields are the table's columns; the store
 * fills the rest (tenant_id, updated_at, ...).
 */
export type ValueWrite =
  | {
      readonly target: 'variable_value';
      readonly key: VarId;
      readonly member_key: MemberKey;
      readonly value: number | null;
      readonly note?: string;
      readonly changeset_id: ChangesetId;
    }
  | {
      readonly target: 'scenario_value';
      readonly scenario_id: ScenarioId;
      readonly key: VarId;
      readonly member_key: MemberKey;
      readonly value: number | null;
      readonly changeset_id: ChangesetId;
    }
  | {
      readonly target: 'node_override';
      readonly scenario_id: ScenarioId;
      readonly key: NodeId;
      readonly member_key: MemberKey;
      readonly value: number | null;
      /**
       * Why the node is pinned (node_override.reason): the change's note, else the pin's reason so far,
       * else ''. Set whenever `value` is not null.
       */
      readonly reason?: string;
    };

/**
 * Insert, replace or delete one structural row: a line_item (dim_key `line`) or a dimension_member.
 * `row` holds the table's other columns; null deletes it.
 */
export interface MemberWrite {
  readonly target: 'line_item' | 'dimension_member';
  readonly dim_key: DimId;
  readonly member_key: MemberId;
  readonly row: JsonObject | null;
}

/** One calc_run row (schema.json tables.calc_run, without tenant_id). */
export interface CalcRunRow {
  readonly id: string;
  readonly scenario_id: ScenarioId;
  readonly scenario_version: number;
  readonly model_version_id: string;
  /** Cache key: hash of the resolved inputs and the model version. */
  readonly input_hash: string;
  readonly ms: number;
  /** Output nodes only. */
  readonly outputs: JsonValue;
  readonly created_at: Timestamp;
}

/** One audit_log row to append (schema.json tables.audit_log, without tenant_id and the bigserial id). */
export interface AuditEntry {
  readonly actor: UserId;
  readonly action: string;
  readonly entity: string;
  readonly entity_key: string;
  readonly before: JsonValue;
  readonly after: JsonValue;
  readonly at: Timestamp;
}

/**
 * Reads and writes of the single write path (docs/architecture/04_data_and_api.md section 2), all
 * inside one transaction of the tenant set by the caller.
 */
export interface ChangesetTx {
  /** Step 1: the scenario row locked for the transaction (SELECT ... FOR UPDATE); null if absent. */
  loadScenarioForUpdate(scenarioId: ScenarioId): Promise<ScenarioRow | null>;
  /** Every scenario of the tenant (chains, fork naming). */
  loadScenarios(): Promise<readonly ScenarioRow[]>;
  /** The stored rows `resolveInputs` takes for a scenario, or for the tenant defaults when null. */
  loadInputs(scenarioId: ScenarioId | null): Promise<InputState>;
  /**
   * The tenant's dimension members with attributes (v_dimension_members, active rows only): rules and
   * the ModelCache key. A line_item or dimension_member row becomes a member as `memberOfRow` shows.
   */
  loadMembers(): Promise<TenantMembers>;
  /**
   * The stored structural rows of `memberKeys` in dimension `dim`: line_item rows for dim `line`, else
   * dimension_member rows, as their columns other than tenant_id, dim_key and member_key (the content
   * of `MemberWrite.row`). Members without a row are absent from the map.
   */
  loadMemberRows(
    dim: DimId,
    memberKeys: readonly MemberId[],
  ): Promise<ReadonlyMap<MemberId, JsonObject>>;
  /** A changeset with its change rows, or null. */
  loadChangeset(id: ChangesetId): Promise<Changeset | null>;
  /**
   * The changeset `createdBy` applied under `clientRequestId` (the contract's ChangesetRequest
   * idempotency key, kept in `changeset.summary.client_request_id`), or null.
   */
  findChangesetByClientRequest(
    createdBy: UserId,
    clientRequestId: string,
  ): Promise<Changeset | null>;
  /**
   * Changesets that were applied (status `applied` or `reverted`) on a scenario (null = tenant
   * defaults) whose base_scenario_version is >= `fromVersion`, with their change rows, oldest first:
   * the "changes since" of a version conflict, and rebase input.
   */
  changesSince(scenarioId: ScenarioId | null, fromVersion: number): Promise<readonly Changeset[]>;
  /**
   * Step 1 for tenant defaults, which have no scenario row to lock: hold the tenant's tenant-default
   * write lock until the transaction ends (e.g. a transaction-scoped advisory lock), so two
   * tenant-default changesets never start from the same version.
   */
  lockTenantDefaults(): Promise<void>;

  /** Step 2: a new scenario (e.g. the fork 'Custom (from X)' of a locked preset). */
  createScenario(row: ScenarioRow): Promise<void>;
  /** Step 5: the changeset row and its change rows. */
  insertChangeset(changeset: Changeset): Promise<void>;
  /** E.g. mark a changeset reverted once its undo is applied. */
  setChangesetStatus(id: ChangesetId, status: ChangesetStatus): Promise<void>;
  /** Step 5: upsert or delete a variable_value, scenario_value or node_override row. */
  writeValue(write: ValueWrite): Promise<void>;
  /** Step 5: upsert or delete a line_item or dimension_member row. */
  writeMember(write: MemberWrite): Promise<void>;
  /**
   * Step 6: set scenario.version to `fromVersion + 1` if it still is `fromVersion`, and return the new
   * version; rejects if the version moved. Tenant defaults have no scenario row and are not bumped:
   * their version is the count of tenant-default changesets applied (ChangesetDraft).
   */
  bumpVersion(scenarioId: ScenarioId, fromVersion: number): Promise<number>;
  /** The calc_run of a scenario for an input hash, or null (cache lookup). */
  findCalcRun(scenarioId: ScenarioId, inputHash: string): Promise<CalcRunRow | null>;
  /** Step 6: store a calc_run keyed (scenario_id, input_hash). */
  upsertCalcRun(row: CalcRunRow): Promise<void>;
  appendAudit(entry: AuditEntry): Promise<void>;
}

/**
 * Persistence of changesets, implemented by data-access. The store knows the tenant, not the user:
 * `applyChangeset` takes the actor as an argument and passes it in the rows it writes.
 */
export interface ChangesetStore {
  /**
   * Run `fn` in one transaction: everything it does commits together, or nothing does if it throws.
   * The store is already in the caller's tenant context (withTenant).
   */
  transaction<T>(fn: (tx: ChangesetTx) => Promise<T>): Promise<T>;
}

/** Key of a compiled model: one per (tenant, model_version, members_hash). */
export interface ModelCacheKey {
  readonly tenant_id: string;
  readonly model_version_id: string;
  /** `membersHash` of the tenant's dimension members (@glidepath/spec). */
  readonly members_hash: string;
}

export function modelCacheKey(
  tenantId: string,
  modelVersionId: string,
  members: TenantMembers,
): ModelCacheKey {
  return {
    tenant_id: tenantId,
    model_version_id: modelVersionId,
    members_hash: membersHash(members),
  };
}

/**
 * Compiled models shared across sessions and requests (docs/architecture/03_engine_and_solvers.md
 * section 2). `TModel` is the engine's CompiledModel.
 */
export interface ModelCache<TModel> {
  /** The model cached under `key`; on a miss, `compile()` it, cache it and return it. */
  getOrCompile(key: ModelCacheKey, compile: () => TModel): TModel;
}
