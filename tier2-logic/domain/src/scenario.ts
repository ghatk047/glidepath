/**
 * Scenario operations (docs/architecture/04_data_and_api.md section 3, POST and PATCH scenarios):
 * create a copy, an empty child or a blend; rename, lock and archive.
 *
 * A new scenario's values and pins are one changeset through the write path (`applyChangeset`), in
 * the same transaction as its scenario row, so the input rules check them and history shows them.
 * Rename, lock and archive change scenario metadata, not inputs: no changeset, an audit entry.
 */
import {
  applyInTx,
  forkName,
  type ApplyOptions,
  type ApplyResult,
  type BoundsPolicy,
} from './apply';
import {
  ScenarioNotFoundError,
  ScenarioOperationError,
  ScenarioPermissionError,
} from './apply-errors';
import type {
  Change,
  ChangesetOrigin,
  JsonValue,
  ScenarioId,
  Timestamp,
  UserId,
} from './changeset';
import type {
  ChangesetStore,
  ChangesetTx,
  ScenarioKind,
  ScenarioPatch,
  ScenarioRow,
  ScenarioStore,
} from './ports';
import { resolveInputs, type NodeOverrideRow, type ResolvedInput } from './resolve';
import { toCellKey } from './validation';

// ------------------------------------------------------------------------------------------ roles

/** tenant_membership.role (schema.json), verbatim. */
export const TENANT_ROLES = ['owner', 'editor', 'viewer', 'advisor'] as const;
export type TenantRole = (typeof TENANT_ROLES)[number];

/** Roles that may rename, lock and archive scenarios; viewers and advisors only read. */
export const SCENARIO_EDIT_ROLES: readonly TenantRole[] = ['owner', 'editor'];

/** Roles that may unlock a preset: owners. Editors copy a preset to change it. */
export const PRESET_UNLOCK_ROLES: readonly TenantRole[] = ['owner'];

/** `scenario.kind` of the seeded presets (Rates, A to D). */
export const PRESET_KIND: ScenarioKind = 'preset';

// ------------------------------------------------------------------------------------------ create

/** A blend part: a scenario and its weight (the contract's `CreateScenarioRequest` blend part). */
export interface BlendPart {
  readonly scenario_id: ScenarioId;
  readonly weight: number;
}

interface CreateCommon {
  /** The new scenario's label; a name from its sources by default (`scenarioName`). */
  readonly label?: string;
  /** The new scenario's kind; `CREATE_KIND` of the mode by default (a solver's save passes `solver`). */
  readonly kind?: ScenarioKind;
}

/**
 * What to create (the contract's `CreateScenarioRequest`):
 * - `copy`: same parent as `from`, with `from`'s own values and pins, so it resolves as `from` does;
 * - `child`: an empty child of `parent_id`, which inherits every value and has no pins;
 * - `blend`: `x = Σ wᵢ·xᵢ / Σ wᵢ` per input cell and per pin (see `createScenario`).
 */
export type CreateScenarioSpec =
  | (CreateCommon & { readonly mode: 'copy'; readonly from: ScenarioId })
  | (CreateCommon & { readonly mode: 'child'; readonly parent_id: ScenarioId })
  | (CreateCommon & { readonly mode: 'blend'; readonly parts: readonly BlendPart[] });
export type CreateMode = CreateScenarioSpec['mode'];

/** `scenario.kind` of a new scenario by mode, unless the spec names one. */
export const CREATE_KIND: Readonly<Record<CreateMode, ScenarioKind>> = {
  copy: 'user',
  child: 'user',
  blend: 'blend',
};

/** Origin of the changeset that writes a new scenario's values, unless the options name one. */
export const DEFAULT_CREATE_ORIGIN: ChangesetOrigin = 'ui';

/**
 * Step 3 for a new scenario's values: they come from scenarios that hold them (a copy), or lie
 * between such values (a blend), so they are written as they are; VR04 stays a warning.
 */
export const CREATE_BOUNDS_POLICY: BoundsPolicy = 'warn';

/**
 * blend-from(A, B, λ): `x = A + λ(B − A)` (solvers.json `scenario_blend`), so λ = 0 is A and λ = 1 is
 * B. The parts are A and B with weights 1 − λ and λ.
 */
export function blendFrom(
  a: ScenarioId,
  b: ScenarioId,
  lambda: number,
  label?: string,
): CreateScenarioSpec {
  if (!Number.isFinite(lambda) || lambda < 0 || lambda > 1) {
    throw new ScenarioOperationError(
      `A blend from one scenario towards another needs λ from 0 to 1, not ${lambda}.`,
    );
  }
  return {
    mode: 'blend',
    parts: [
      { scenario_id: a, weight: 1 - lambda },
      { scenario_id: b, weight: lambda },
    ],
    ...(label === undefined ? {} : { label }),
  };
}

/**
 * Key and default label of the `n`-th new scenario (n from 1) of a mode from its sources; a new
 * scenario takes the first `n` whose key is free:
 * - copy: `copy-C` 'Copy of <C's label>', then `copy-C-2` 'Copy of <label> 2', ...;
 * - child: `forkName`, `custom-C` 'Custom (from C)', as the first edit of a preset forks it;
 * - blend: `blend-C-D` 'Blend of C and D', ...
 */
export function scenarioName(
  mode: CreateMode,
  sources: readonly Pick<ScenarioRow, 'key' | 'label'>[],
  n: number,
): { readonly key: string; readonly label: string } {
  if (mode === 'child') return forkName(sources[0]!, n);
  const base =
    mode === 'copy'
      ? { key: `copy-${sources[0]!.key}`, label: `Copy of ${sources[0]!.label}` }
      : { key: `blend-${sources.map((s) => s.key).join('-')}`, label: `Blend of ${list(sources)}` };
  return n === 1 ? base : { key: `${base.key}-${n}`, label: `${base.label} ${n}` };
}

const list = (sources: readonly Pick<ScenarioRow, 'key'>[]): string => {
  const keys = sources.map((s) => s.key);
  return keys.length === 1 ? keys[0]! : `${keys.slice(0, -1).join(', ')} and ${keys.at(-1)!}`;
};

export interface CreateScenarioOptions<R = undefined> extends Omit<
  ApplyOptions<R>,
  'clientRequestId'
> {
  /** Origin of the changeset that writes the new scenario's values; `DEFAULT_CREATE_ORIGIN` by default. */
  readonly origin?: ChangesetOrigin;
}

export interface CreateScenarioResult<R = undefined> {
  /** The new scenario, at the version its first changeset left it (0 without one). */
  readonly scenario: ScenarioRow;
  /** The changeset that wrote its values and pins (copy, blend); null when there was nothing to write. */
  readonly applied: ApplyResult<R> | null;
  /**
   * CellKeys a blend could not carry: an input cell a weighted part has no value for, and a pin that
   * not every weighted part has (the other parts' value is calculated; only the engine knows it).
   */
  readonly unblended: readonly string[];
}

/**
 * Create a scenario, unlocked and of `spec.kind` (else `CREATE_KIND`), in one transaction: the
 * scenario row, a `scenario.create` audit entry, then (unless there is nothing to write) one
 * changeset of `options.origin` with its values and pins. That changeset is no edit (the edits
 * counter stays 0, and the tray does not offer to undo it) and keeps values past a registry bound
 * (`CREATE_BOUNDS_POLICY`); the input rules run on the new scenario's state as for any changeset.
 *
 * A blend's parent is the deepest scenario all parts descend from (or are), null if none. It sets
 * every input cell that some part resolves from a scenario below that parent, to
 * `x₀ + Σᵢ (wᵢ / W)·(xᵢ − x₀)` over the parts with a weight above 0 (W their sum): `A + λ(B − A)` for
 * blend-from(A, B, λ), and exactly x where the parts agree. A pin every weighted part has is blended
 * the same way. Cells the parts all inherit are left to inherit, so the blend follows later changes
 * of the parent as each part does.
 *
 * Throws `ScenarioNotFoundError` (a source), `ScenarioOperationError` (an empty label; a blend with
 * fewer than two parts, a negative or non-finite weight, weights summing to 0, or parts of different
 * model versions), and whatever applying the changeset throws (e.g. `ChangesetRejectedError` when a
 * blend breaks an input rule). Nothing is written then.
 */
export async function createScenario<R = undefined>(
  store: ChangesetStore,
  spec: CreateScenarioSpec,
  options: CreateScenarioOptions<R>,
): Promise<CreateScenarioResult<R>> {
  const label = spec.label === undefined ? undefined : checkedLabel(spec.label);
  if (spec.mode === 'blend') checkParts(spec.parts);
  const newId = options.newId ?? (() => crypto.randomUUID());
  const now = options.now ?? (() => new Date().toISOString());

  return store.transaction(async (tx) => {
    const scenarios = await tx.loadScenarios();
    const byId = new Map(scenarios.map((s) => [s.id, s]));
    const get = (id: ScenarioId): ScenarioRow => {
      const s = byId.get(id);
      if (s === undefined) throw new ScenarioNotFoundError(id);
      return s;
    };
    const plan =
      spec.mode === 'copy'
        ? await copyPlan(tx, get(spec.from), options)
        : spec.mode === 'child'
          ? childPlan(get(spec.parent_id))
          : await blendPlan(
              tx,
              spec.parts.map((p) => ({ row: get(p.scenario_id), weight: p.weight })),
              options,
            );

    const taken = new Set(scenarios.map((s) => s.key));
    let n = 1;
    while (taken.has(scenarioName(spec.mode, plan.sources, n).key)) n += 1;
    const name = scenarioName(spec.mode, plan.sources, n);
    const row: ScenarioRow = {
      id: newId(),
      key: name.key,
      label: label ?? name.label,
      kind: spec.kind ?? CREATE_KIND[spec.mode],
      parent_id: plan.parent_id,
      model_version_id: plan.model_version_id,
      version: 0,
      locked: false,
      created_by: options.actor,
      created_at: now(),
    };
    await tx.createScenario(row);
    await tx.appendAudit({
      actor: options.actor,
      action: 'scenario.create',
      entity: 'scenario',
      entity_key: row.id,
      before: null,
      after: {
        ...row,
        mode: spec.mode,
        from: plan.sources.map((s) => s.id),
        ...(spec.mode === 'blend' ? { weights: spec.parts.map((p) => p.weight) } : {}),
      },
      at: row.created_at,
    });
    if (plan.changes.length === 0)
      return { scenario: row, applied: null, unblended: plan.unblended };

    const applied = await applyInTx(
      tx,
      {
        origin: options.origin ?? DEFAULT_CREATE_ORIGIN,
        scenario_id: row.id,
        base_scenario_version: 0,
        changes: plan.changes,
      },
      {
        actor: options.actor,
        bundle: options.bundle,
        ...(options.recompute === undefined ? {} : { recompute: options.recompute }),
        newId,
        now,
      },
      { bounds: CREATE_BOUNDS_POLICY, uncounted: true },
    );
    return {
      scenario: { ...row, version: applied.version },
      applied,
      unblended: plan.unblended,
    };
  });
}

/** A new scenario's sources, place and first changes. */
interface CreatePlan {
  readonly sources: readonly ScenarioRow[];
  readonly parent_id: ScenarioId | null;
  readonly model_version_id: string;
  readonly changes: readonly Change[];
  readonly unblended: readonly string[];
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const setValue = (
  target: 'variable' | 'override',
  key: string,
  member_key: string,
  value: number,
  note?: string,
): Change => ({
  target,
  key,
  member_key,
  op: 'set',
  new_value: value,
  ...(note === undefined || note === '' ? {} : { note }),
});

/** The variables and nodes of the pinned model: rows of others (an older model) are not carried. */
const modelIds = (options: Pick<ApplyOptions<unknown>, 'bundle'>) => ({
  variables: options.bundle.variables.map((v) => v.id),
  nodes: new Set(options.bundle.nodes.map((n) => n.id)),
});

async function copyPlan(
  tx: ChangesetTx,
  source: ScenarioRow,
  options: Pick<ApplyOptions<unknown>, 'bundle'>,
): Promise<CreatePlan> {
  const inputs = await tx.loadInputs(source.id);
  const own = inputs.chain[inputs.chain.length - 1];
  if (own?.scenario_id !== source.id) {
    throw new Error(`loadInputs(${source.id}): the chain does not end at the scenario itself`);
  }
  const { variables, nodes } = modelIds(options);
  const defined = new Set(variables);
  const values = own.values
    .filter((r) => defined.has(r.var_key))
    .sort((a, b) => compare(a.var_key, b.var_key) || compare(a.member_key, b.member_key))
    .map((r) => setValue('variable', r.var_key, r.member_key, r.value));
  const pins = sortedPins(inputs.overrides.filter((o) => nodes.has(o.node_key))).map((o) =>
    setValue('override', o.node_key, o.member_key, o.value, o.reason),
  );
  return {
    sources: [source],
    parent_id: source.parent_id,
    model_version_id: source.model_version_id,
    changes: [...values, ...pins],
    unblended: [],
  };
}

function childPlan(parent: ScenarioRow): CreatePlan {
  return {
    sources: [parent],
    parent_id: parent.id,
    model_version_id: parent.model_version_id,
    changes: [],
    unblended: [],
  };
}

const sortedPins = (pins: readonly NodeOverrideRow[]): NodeOverrideRow[] =>
  [...pins].sort((a, b) => compare(a.node_key, b.node_key) || compare(a.member_key, b.member_key));

function checkParts(parts: readonly BlendPart[]): void {
  if (parts.length < 2) {
    throw new ScenarioOperationError(`A blend needs at least two scenarios, not ${parts.length}.`);
  }
  const bad = parts.find((p) => !Number.isFinite(p.weight) || p.weight < 0);
  if (bad !== undefined) {
    throw new ScenarioOperationError(
      `Blend weight ${bad.weight} of scenario ${bad.scenario_id} is not a number of 0 or more.`,
    );
  }
  if (!(parts.reduce((s, p) => s + p.weight, 0) > 0)) {
    throw new ScenarioOperationError(
      'Blend weights sum to 0; give at least one scenario a weight.',
    );
  }
}

/** The longest common prefix of two root-first chains. */
function commonPrefix(a: readonly ScenarioId[], b: readonly ScenarioId[]): ScenarioId[] {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  return a.slice(0, i);
}

async function blendPlan(
  tx: ChangesetTx,
  parts: readonly { readonly row: ScenarioRow; readonly weight: number }[],
  options: Pick<ApplyOptions<unknown>, 'bundle'>,
): Promise<CreatePlan> {
  const model = parts[0]!.row.model_version_id;
  const other = parts.find((p) => p.row.model_version_id !== model);
  if (other !== undefined) {
    throw new ScenarioOperationError(
      `Scenarios ${parts[0]!.row.key} and ${other.row.key} use different model versions; blend scenarios of one model.`,
    );
  }
  const { variables, nodes } = modelIds(options);
  const loaded: {
    readonly weight: number;
    readonly chain: readonly ScenarioId[];
    readonly values: ReadonlyMap<string, ResolvedInput>;
    readonly pins: ReadonlyMap<string, NodeOverrideRow>;
  }[] = [];
  for (const p of parts) {
    const inputs = await tx.loadInputs(p.row.id);
    const r = resolveInputs(inputs.defaults, inputs.chain, inputs.overrides, { variables });
    loaded.push({
      weight: p.weight,
      chain: inputs.chain.map((l) => l.scenario_id),
      values: new Map(r.values.map((v) => [toCellKey(v.var_key, v.member_key), v])),
      pins: new Map(
        r.overrides
          .filter((o) => nodes.has(o.node_key))
          .map((o) => [toCellKey(o.node_key, o.member_key), o]),
      ),
    });
  }

  // The parent: the deepest scenario every part descends from (or is). Cells resolved below it vary.
  const common = loaded.slice(1).reduce((c, l) => commonPrefix(c, l.chain), [...loaded[0]!.chain]);
  const shared = new Set(common);
  const varying = new Map<string, ResolvedInput>();
  for (const l of loaded) {
    for (const [cell, v] of l.values) {
      if (v.scenario_id !== null && !shared.has(v.scenario_id)) varying.set(cell, v);
    }
  }

  const weighted = loaded.filter((l) => l.weight > 0);
  const total = weighted.reduce((s, l) => s + l.weight, 0);
  /** x₀ + Σᵢ (wᵢ / W)·(xᵢ − x₀) over the weighted parts: exactly x₀ where they agree. */
  const mix = (xs: readonly number[]): number =>
    xs.slice(1).reduce((x, xi, i) => x + (weighted[i + 1]!.weight / total) * (xi - xs[0]!), xs[0]!);

  const changes: Change[] = [];
  const unblended: string[] = [];
  const byCell = ([a, x]: [string, ResolvedInput], [b, y]: [string, ResolvedInput]): number =>
    compare(x.var_key, y.var_key) || compare(x.member_key, y.member_key) || compare(a, b);
  for (const [cell, v] of [...varying].sort(byCell)) {
    const xs = weighted.map((l) => l.values.get(cell)?.value);
    if (xs.some((x) => x === undefined)) unblended.push(cell);
    else changes.push(setValue('variable', v.var_key, v.member_key, mix(xs as number[])));
  }
  const pinned = sortedPins([...new Map(weighted.flatMap((l) => [...l.pins])).values()]);
  for (const pin of pinned) {
    const cell = toCellKey(pin.node_key, pin.member_key);
    const ps = weighted.map((l) => l.pins.get(cell));
    if (ps.some((p) => p === undefined)) {
      unblended.push(cell);
      continue;
    }
    const rows = ps as NodeOverrideRow[];
    const reasons = [...new Set(rows.map((p) => p.reason).filter((r) => r !== ''))];
    changes.push(
      setValue(
        'override',
        pin.node_key,
        pin.member_key,
        mix(rows.map((p) => p.value)),
        reasons.join(' / '),
      ),
    );
  }
  return {
    sources: parts.map((p) => p.row),
    parent_id: common.at(-1) ?? null,
    model_version_id: model,
    changes,
    unblended,
  };
}

function checkedLabel(label: string): string {
  const trimmed = label.trim();
  if (trimmed === '')
    throw new ScenarioOperationError('A scenario needs a label that is not empty.');
  return trimmed;
}

// ------------------------------------------------------------------------------------------ patch

export interface PatchScenarioOptions {
  /** The member making the change: audit_log.actor. */
  readonly actor: UserId;
  /** The actor's tenant_membership.role in the scenario's tenant. */
  readonly role: TenantRole;
  /** The audit time; the current time by default. */
  readonly now?: () => Timestamp;
}

/**
 * Rename, lock, unlock, archive or unarchive a scenario (the contract's `PatchScenarioRequest`), in
 * one transaction: lock the row, check, `updateScenario` with the columns that change, then a
 * `scenario.update` audit entry with their old and new values. A patch that changes nothing writes
 * nothing. Returns the scenario as it now is.
 *
 * - Only `SCENARIO_EDIT_ROLES` change scenarios (`ScenarioPermissionError`).
 * - Only `PRESET_UNLOCK_ROLES` unlock a preset: editors cannot (`ScenarioPermissionError`); they copy
 *   it instead. Locking is open to every editing role.
 * - A label is trimmed and must not be empty; a scenario that stays locked keeps its label: unlock
 *   it in the same patch, or copy it (`ScenarioOperationError`).
 * - The key stays: it names the scenario in URLs.
 *
 * Also `ScenarioOperationError` for an empty patch, `ScenarioNotFoundError` for an unknown scenario.
 */
export async function patchScenario(
  store: ScenarioStore,
  scenarioId: ScenarioId,
  patch: ScenarioPatch,
  options: PatchScenarioOptions,
): Promise<ScenarioRow> {
  if (patch.label === undefined && patch.locked === undefined && patch.archived === undefined) {
    throw new ScenarioOperationError('Nothing to change: give a label, locked or archived.');
  }
  const label = patch.label === undefined ? undefined : checkedLabel(patch.label);
  if (!SCENARIO_EDIT_ROLES.includes(options.role)) {
    throw new ScenarioPermissionError(
      `A ${options.role} cannot rename, lock or archive scenarios; ask an owner or editor.`,
    );
  }
  const now = options.now ?? (() => new Date().toISOString());

  return store.transaction(async (tx) => {
    const row = await tx.loadScenarioForUpdate(scenarioId);
    if (row === null) throw new ScenarioNotFoundError(scenarioId);
    const next = {
      label: label ?? row.label,
      locked: patch.locked ?? row.locked,
      archived: patch.archived ?? row.archived ?? false,
    };
    if (
      row.locked &&
      !next.locked &&
      row.kind === PRESET_KIND &&
      !PRESET_UNLOCK_ROLES.includes(options.role)
    ) {
      throw new ScenarioPermissionError(
        `Preset ${row.key} stays locked: only an owner can unlock a preset. Copy it to change it.`,
      );
    }
    if (next.label !== row.label && row.locked && next.locked) {
      throw new ScenarioOperationError(
        `${row.label} is locked; unlock it or copy it to give it another name.`,
      );
    }

    const changed: Record<string, string | boolean> = {};
    const before: Record<string, JsonValue> = {};
    for (const field of ['label', 'locked', 'archived'] as const) {
      const was = field === 'archived' ? (row.archived ?? false) : row[field];
      if (next[field] === was) continue;
      changed[field] = next[field];
      before[field] = was;
    }
    if (Object.keys(changed).length === 0) return row;
    await tx.updateScenario(row.id, changed as ScenarioPatch);
    await tx.appendAudit({
      actor: options.actor,
      action: 'scenario.update',
      entity: 'scenario',
      entity_key: row.id,
      before,
      after: changed,
      at: now(),
    });
    return { ...row, ...next };
  });
}
