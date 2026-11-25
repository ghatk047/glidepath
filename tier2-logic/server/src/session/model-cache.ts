import { compile as engineCompile } from '@glidepath/engine';
import type { CellKey, CompiledModel, Evaluation } from '@glidepath/engine';
import type { ModelBundle, TenantMembers } from '@glidepath/spec';

/**
 * ModelCache (03 §2): one `CompiledModel` per `(tenant, model_version, members_hash)`, shared by every
 * session open on that tenant's scenarios. A compiled model is pure and immutable, so sharing it is safe.
 *
 * - `members_hash` (`@glidepath/spec` `membersHash`, from DATA-05 `loadMembers`) ignores member order, but
 *   the engine sums in member order (PORTING.md S06). Each entry therefore also remembers the member order
 *   it was compiled with; a lookup whose order differs recompiles and replaces the entry (counted as a miss).
 * - Loads are de-duplicated: concurrent lookups of one key share one compile. A failed load is not kept.
 * - Least recently used entries are dropped beyond `maxModels` (sessions keep their own reference).
 * - Committed evaluations: `committed(scenarioId, values, overrides)` evaluates a scenario's resolved
 *   inputs once and hands the same immutable evaluation to every session whose inputs are bitwise the same
 *   (compared cell by cell, which costs a fraction of `inputHash`, itself about one `evaluate`; nothing here
 *   hashes inputs). `rerun` never modifies the evaluation it starts from, so sessions can share it.
 */

/** Cache key: the tenant, the model version it pins, and the hash of its active members. */
export interface ModelKey {
  readonly tenantId: string;
  readonly modelVersionId: string;
  readonly membersHash: string;
}

export const modelKeyString = (k: ModelKey): string => JSON.stringify([k.tenantId, k.modelVersionId, k.membersHash]);

/** Member ids per dimension, in order: the evaluation order `membersHash` leaves out. */
export function memberOrder(members: TenantMembers): string {
  return JSON.stringify(
    Object.keys(members)
      .sort()
      .map((dim) => [dim, (members[dim] ?? []).map((m) => m.id)]),
  );
}

/** A compiled model with what sessions need beside it. */
export interface CachedModel {
  readonly key: ModelKey;
  readonly model: CompiledModel;
  readonly bundle: ModelBundle;
  readonly members: TenantMembers;
  /** Variable id → its dims (a preview names `var` + `member`). */
  readonly variableDims: ReadonlyMap<string, readonly string[]>;
  /** Dimension id → its active member ids. */
  readonly memberIds: ReadonlyMap<string, ReadonlySet<string>>;
  /**
   * The evaluation of a scenario's resolved inputs: the one already held when `values` and `overrides`
   * equal the last ones seen for `scenarioId` cell by cell (bitwise), else a fresh `evaluate`.
   */
  committed(
    scenarioId: string,
    values: ReadonlyMap<CellKey, number>,
    overrides: ReadonlyMap<CellKey, number>,
  ): Evaluation;
}

export interface ModelCacheOptions {
  /** Compiled models kept (least recently used dropped first). Default {@link DEFAULT_MAX_MODELS}. */
  maxModels?: number;
  /** Committed evaluations kept per compiled model, one per scenario. Default {@link DEFAULT_MAX_SCENARIOS}. */
  maxScenariosPerModel?: number;
  /** The compiler; default `@glidepath/engine` `compile`. */
  compile?: (bundle: ModelBundle, members: TenantMembers) => CompiledModel;
}

/** A tenant's compiled model is about 5 MB (03 §2): a handful of tenants and model versions fit easily. */
export const DEFAULT_MAX_MODELS = 8;
export const DEFAULT_MAX_SCENARIOS = 32;

export interface ModelCacheStats {
  readonly hits: number;
  readonly misses: number;
  /** Compiles started (one per miss whose bundle loaded). */
  readonly compiles: number;
  /** Committed evaluations computed / handed out again. */
  readonly evaluations: number;
  readonly evaluationHits: number;
  readonly size: number;
}

/** Same cells, same float64 values (`Object.is`: 0 and −0 differ). */
function sameCells(a: ReadonlyMap<CellKey, number>, b: ReadonlyMap<CellKey, number>): boolean {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) {
    const w = b.get(k);
    if (w === undefined || !Object.is(v, w)) return false;
  }
  return true;
}

interface Entry {
  readonly order: string;
  readonly promise: Promise<CachedModel>;
}

export class ModelCache {
  private readonly entries = new Map<string, Entry>();
  private readonly maxModels: number;
  private readonly maxScenarios: number;
  private readonly compileFn: (bundle: ModelBundle, members: TenantMembers) => CompiledModel;
  private counts = { hits: 0, misses: 0, compiles: 0, evaluations: 0, evaluationHits: 0 };

  constructor(options: ModelCacheOptions = {}) {
    this.maxModels = Math.max(1, options.maxModels ?? DEFAULT_MAX_MODELS);
    this.maxScenarios = Math.max(1, options.maxScenariosPerModel ?? DEFAULT_MAX_SCENARIOS);
    this.compileFn = options.compile ?? engineCompile;
  }

  /**
   * The compiled model of `key`. On a miss, `loadBundle` supplies the model version's bundle and the
   * model is compiled with `members` (array order = evaluation order).
   */
  get(key: ModelKey, members: TenantMembers, loadBundle: () => Promise<ModelBundle>): Promise<CachedModel> {
    const k = modelKeyString(key);
    const order = memberOrder(members);
    const found = this.entries.get(k);
    if (found && found.order === order) {
      this.counts.hits += 1;
      this.entries.delete(k); // most recently used last
      this.entries.set(k, found);
      return found.promise;
    }
    this.counts.misses += 1;
    const promise = loadBundle().then((bundle) => {
      this.counts.compiles += 1;
      return this.build(key, bundle, members);
    });
    const entry: Entry = { order, promise };
    this.entries.delete(k);
    this.entries.set(k, entry);
    promise.catch(() => {
      if (this.entries.get(k) === entry) this.entries.delete(k);
    });
    while (this.entries.size > this.maxModels) {
      const oldest = this.entries.keys().next().value as string;
      this.entries.delete(oldest);
    }
    return promise;
  }

  /** Keys held now, least recently used first. */
  keys(): ModelKey[] {
    return [...this.entries.keys()].map((k) => {
      const [tenantId, modelVersionId, membersHash] = JSON.parse(k) as [string, string, string];
      return { tenantId, modelVersionId, membersHash };
    });
  }

  stats(): ModelCacheStats {
    return { ...this.counts, size: this.entries.size };
  }

  clear(): void {
    this.entries.clear();
  }

  private build(key: ModelKey, bundle: ModelBundle, members: TenantMembers): CachedModel {
    const model = this.compileFn(bundle, members);
    const variableDims = new Map(bundle.variables.map((v) => [v.id, [...v.dims]] as const));
    const memberIds = new Map(
      Object.entries(members).map(([dim, list]) => [dim, new Set(list.map((m) => m.id))] as const),
    );
    const held = new Map<
      string,
      { values: ReadonlyMap<CellKey, number>; overrides: ReadonlyMap<CellKey, number>; at: Evaluation }
    >();
    const counts = this.counts;
    const maxScenarios = this.maxScenarios;
    return {
      key,
      model,
      bundle,
      members,
      variableDims,
      memberIds,
      committed(scenarioId, values, overrides) {
        const last = held.get(scenarioId);
        if (last && sameCells(last.values, values) && sameCells(last.overrides, overrides)) {
          counts.evaluationHits += 1;
          held.delete(scenarioId);
          held.set(scenarioId, last);
          return last.at;
        }
        const at = model.evaluate(values, overrides);
        counts.evaluations += 1;
        held.delete(scenarioId);
        held.set(scenarioId, { values, overrides, at });
        while (held.size > maxScenarios) held.delete(held.keys().next().value as string);
        return at;
      },
    };
  }
}
