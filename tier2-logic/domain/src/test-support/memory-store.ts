// Test support only (never exported by the package): an in-memory ScenarioStore (ADR-019). One
// transaction at a time; a throw inside it restores the tables as they were at its start. `calls` logs
// `begin`, every port method and `commit` / `rollback`, in order, so tests can assert the write order.
import type { DimId, MemberId, TenantMembers } from '@glidepath/spec';
import type {
  Changeset,
  ChangesetId,
  ChangesetStatus,
  JsonObject,
  ScenarioId,
  UserId,
} from '../changeset';
import { LINE_ITEM_DIM } from '../changeset';
import { memberOfRow } from '../member-rows';
import type {
  AuditEntry,
  CalcRunRow,
  InputState,
  ScenarioRow,
  ScenarioStore,
  ScenarioTx,
  ValueWrite,
} from '../ports';
import { resolveScenarioChain, type InputValueRow, type NodeOverrideRow } from '../resolve';

const cellId = (key: string, memberKey: string): string => `${key}[${memberKey}]`;

export interface MemoryTables {
  scenarios: Map<ScenarioId, ScenarioRow>;
  /** variable_value: cell -> row (note, changeset_id kept for assertions). */
  variableValues: Map<string, InputValueRow & { note?: string; changeset_id: ChangesetId }>;
  /** scenario_value per scenario. */
  scenarioValues: Map<ScenarioId, Map<string, InputValueRow & { changeset_id: ChangesetId }>>;
  /** node_override per scenario. */
  nodeOverrides: Map<ScenarioId, Map<string, NodeOverrideRow>>;
  /** dimension_member rows per dim, in insertion order. */
  dimensionMembers: Map<DimId, Map<MemberId, JsonObject>>;
  /** line_item rows, in insertion order. */
  lineItems: Map<MemberId, JsonObject>;
  /** In insertion order. */
  changesets: Map<ChangesetId, Changeset>;
  calcRuns: CalcRunRow[];
  audit: AuditEntry[];
}

export interface MemoryStoreInit {
  /** Members no tenant row holds (canonical pools, addr tags, system dims): served by loadMembers as is. */
  readonly globalMembers?: TenantMembers;
  readonly scenarios?: readonly ScenarioRow[];
  /** variable_value rows. */
  readonly defaults?: readonly InputValueRow[];
  /** scenario_value rows per scenario id. */
  readonly scenarioValues?: Readonly<Record<ScenarioId, readonly InputValueRow[]>>;
  readonly nodeOverrides?: Readonly<Record<ScenarioId, readonly NodeOverrideRow[]>>;
  /** dimension_member rows per dim and member key. */
  readonly dimensionMembers?: Readonly<Record<DimId, Readonly<Record<MemberId, JsonObject>>>>;
  readonly lineItems?: Readonly<Record<MemberId, JsonObject>>;
  readonly changesets?: readonly Changeset[];
}

const SEEDED = 'seed-init';

export class MemoryChangesetStore implements ScenarioStore {
  tables: MemoryTables;
  readonly globalMembers: TenantMembers;
  /** `begin`, each port method name, `commit` or `rollback`; tests may push their own markers. */
  readonly calls: string[] = [];
  private open = false;

  constructor(init: MemoryStoreInit = {}) {
    this.globalMembers = init.globalMembers ?? {};
    const byCell = <T extends { var_key: string; member_key: string }>(rows: readonly T[]) =>
      new Map(rows.map((r) => [cellId(r.var_key, r.member_key), { ...r, changeset_id: SEEDED }]));
    this.tables = {
      scenarios: new Map((init.scenarios ?? []).map((s) => [s.id, s])),
      variableValues: byCell(init.defaults ?? []),
      scenarioValues: new Map(
        Object.entries(init.scenarioValues ?? {}).map(([id, rows]) => [id, byCell(rows)]),
      ),
      nodeOverrides: new Map(
        Object.entries(init.nodeOverrides ?? {}).map(([id, rows]) => [
          id,
          new Map(rows.map((o) => [cellId(o.node_key, o.member_key), o])),
        ]),
      ),
      dimensionMembers: new Map(
        Object.entries(init.dimensionMembers ?? {}).map(([dim, rows]) => [
          dim,
          new Map(Object.entries(rows)),
        ]),
      ),
      lineItems: new Map(Object.entries(init.lineItems ?? {})),
      changesets: new Map((init.changesets ?? []).map((c) => [c.id, c])),
      calcRuns: [],
      audit: [],
    };
  }

  async transaction<T>(fn: (tx: ScenarioTx) => Promise<T>): Promise<T> {
    if (this.open) throw new Error('MemoryChangesetStore: nested transaction');
    const snapshot = structuredClone(this.tables);
    this.open = true;
    this.calls.push('begin');
    try {
      const result = await fn(this.tx());
      this.calls.push('commit');
      return result;
    } catch (e) {
      this.tables = snapshot;
      this.calls.push('rollback');
      throw e;
    } finally {
      this.open = false;
    }
  }

  /** The port methods called since the last `reset`, without begin/commit markers. */
  methods(): string[] {
    return this.calls.filter((c) => c !== 'begin' && c !== 'commit' && c !== 'rollback');
  }

  /** What loadInputs returns, outside a transaction (assertions). */
  inputs(scenarioId: ScenarioId | null): InputState {
    const t = this.tables;
    const defaults = [...t.variableValues.values()].map(({ var_key, member_key, value }) => ({
      var_key,
      member_key,
      value,
    }));
    if (scenarioId === null) return { defaults, chain: [], overrides: [] };
    const chain = resolveScenarioChain([...t.scenarios.values()], scenarioId).map((id) => ({
      scenario_id: id,
      values: [...(t.scenarioValues.get(id)?.values() ?? [])].map(
        ({ var_key, member_key, value }) => ({ var_key, member_key, value }),
      ),
    }));
    const overrides = [...(t.nodeOverrides.get(scenarioId)?.values() ?? [])];
    return { defaults, chain, overrides };
  }

  /** What loadMembers returns, outside a transaction (assertions). */
  members(): TenantMembers {
    const out: Record<DimId, ReturnType<typeof memberOfRow>[]> = {};
    for (const [dim, ms] of Object.entries(this.globalMembers)) out[dim] = [...ms];
    for (const [dim, rows] of this.tables.dimensionMembers) {
      out[dim] = [...(out[dim] ?? []), ...[...rows].map(([id, row]) => memberOfRow(dim, id, row))];
    }
    if (this.tables.lineItems.size > 0) {
      out[LINE_ITEM_DIM] = [
        ...(out[LINE_ITEM_DIM] ?? []),
        ...[...this.tables.lineItems].map(([id, row]) => memberOfRow(LINE_ITEM_DIM, id, row)),
      ];
    }
    return Object.fromEntries(
      Object.entries(out).map(([dim, ms]) => [dim, ms.filter((m) => m !== null)]),
    );
  }

  private tx(): ScenarioTx {
    const t = (): MemoryTables => this.tables;
    const log = (method: keyof ScenarioTx): void => {
      if (!this.open) throw new Error(`MemoryChangesetStore: ${method} outside a transaction`);
      this.calls.push(method);
    };
    const scenario = (id: ScenarioId): ScenarioRow => {
      const s = t().scenarios.get(id);
      if (!s) throw new Error(`MemoryChangesetStore: no scenario ${id}`);
      return s;
    };
    const applied = (c: Changeset): boolean => c.status === 'applied' || c.status === 'reverted';
    const writeValue = (w: ValueWrite): void => {
      const id = cellId(w.key, w.member_key);
      if (w.target === 'variable_value') {
        if (w.value === null) t().variableValues.delete(id);
        else {
          t().variableValues.set(id, {
            var_key: w.key,
            member_key: w.member_key,
            value: w.value,
            ...(w.note === undefined ? {} : { note: w.note }),
            changeset_id: w.changeset_id,
          });
        }
        return;
      }
      scenario(w.scenario_id);
      if (w.target === 'scenario_value') {
        const rows = t().scenarioValues.get(w.scenario_id) ?? new Map();
        t().scenarioValues.set(w.scenario_id, rows);
        if (w.value === null) rows.delete(id);
        else {
          rows.set(id, {
            var_key: w.key,
            member_key: w.member_key,
            value: w.value,
            changeset_id: w.changeset_id,
          });
        }
        return;
      }
      const rows = t().nodeOverrides.get(w.scenario_id) ?? new Map<string, NodeOverrideRow>();
      t().nodeOverrides.set(w.scenario_id, rows);
      if (w.value === null) rows.delete(id);
      else {
        rows.set(id, {
          node_key: w.key,
          member_key: w.member_key,
          value: w.value,
          reason: w.reason ?? '',
        });
      }
    };

    return {
      loadScenarioForUpdate: async (id) => {
        log('loadScenarioForUpdate');
        return t().scenarios.get(id) ?? null;
      },
      loadScenarios: async () => {
        log('loadScenarios');
        return [...t().scenarios.values()];
      },
      loadInputs: async (id) => {
        log('loadInputs');
        return this.inputs(id);
      },
      loadMembers: async () => {
        log('loadMembers');
        return this.members();
      },
      loadMemberRows: async (dim, keys) => {
        log('loadMemberRows');
        const rows = dim === LINE_ITEM_DIM ? t().lineItems : t().dimensionMembers.get(dim);
        const out = new Map<MemberId, JsonObject>();
        for (const k of keys) {
          const row = rows?.get(k);
          if (row) out.set(k, row);
        }
        return out;
      },
      loadChangeset: async (id) => {
        log('loadChangeset');
        return t().changesets.get(id) ?? null;
      },
      findChangesetByClientRequest: async (createdBy: UserId, clientRequestId: string) => {
        log('findChangesetByClientRequest');
        for (const c of t().changesets.values()) {
          const s = c.summary as { client_request_id?: unknown } | null;
          if (c.created_by === createdBy && s?.client_request_id === clientRequestId) return c;
        }
        return null;
      },
      changesSince: async (id, fromVersion) => {
        log('changesSince');
        return [...t().changesets.values()]
          .filter(
            (c) => c.scenario_id === id && applied(c) && c.base_scenario_version >= fromVersion,
          )
          .sort((a, b) => a.base_scenario_version - b.base_scenario_version);
      },
      lockTenantDefaults: async () => {
        log('lockTenantDefaults');
      },
      createScenario: async (row) => {
        log('createScenario');
        if (t().scenarios.has(row.id)) throw new Error(`scenario ${row.id} exists`);
        for (const s of t().scenarios.values()) {
          if (s.key === row.key) throw new Error(`scenario key ${row.key} is taken`);
        }
        t().scenarios.set(row.id, row);
      },
      updateScenario: async (id, patch) => {
        log('updateScenario');
        const defined = Object.fromEntries(
          Object.entries(patch).filter(([, v]) => v !== undefined),
        ) as Partial<ScenarioRow>;
        t().scenarios.set(id, { ...scenario(id), ...defined });
      },
      insertChangeset: async (cs) => {
        log('insertChangeset');
        if (t().changesets.has(cs.id)) throw new Error(`changeset ${cs.id} exists`);
        t().changesets.set(cs.id, cs);
      },
      setChangesetStatus: async (id: ChangesetId, status: ChangesetStatus) => {
        log('setChangesetStatus');
        const cs = t().changesets.get(id);
        if (!cs) throw new Error(`no changeset ${id}`);
        t().changesets.set(id, { ...cs, status });
      },
      writeValue: async (w) => {
        log('writeValue');
        writeValue(w);
      },
      writeMember: async (w) => {
        log('writeMember');
        const tables = t();
        let rows =
          w.target === 'line_item' ? tables.lineItems : tables.dimensionMembers.get(w.dim_key);
        if (!rows) tables.dimensionMembers.set(w.dim_key, (rows = new Map()));
        if (w.row === null) rows.delete(w.member_key);
        else rows.set(w.member_key, w.row);
      },
      bumpVersion: async (id, fromVersion) => {
        log('bumpVersion');
        const s = scenario(id);
        if (s.version !== fromVersion) {
          throw new Error(`bumpVersion: scenario ${id} is at ${s.version}, not ${fromVersion}`);
        }
        t().scenarios.set(id, { ...s, version: fromVersion + 1 });
        return fromVersion + 1;
      },
      findCalcRun: async (id, inputHash) => {
        log('findCalcRun');
        return t().calcRuns.find((r) => r.scenario_id === id && r.input_hash === inputHash) ?? null;
      },
      upsertCalcRun: async (row) => {
        log('upsertCalcRun');
        const runs = t().calcRuns.filter(
          (r) => !(r.scenario_id === row.scenario_id && r.input_hash === row.input_hash),
        );
        t().calcRuns = [...runs, row];
      },
      appendAudit: async (entry) => {
        log('appendAudit');
        t().audit.push(entry);
      },
    };
  }
}
