/**
 * The single write path (docs/architecture/04_data_and_api.md section 2, ADR-007, ADR-019). Every
 * write of tenant inputs, overrides and structural rows is `applyChangeset(store, draft, options)`:
 *
 * 1. lock the target (the scenario row, or the tenant-default lock), replay a known
 *    `clientRequestId`, and check `base_scenario_version` (else `ChangesetConflictError`);
 * 2. fork a locked preset into 'Custom (from X)' and retarget the draft (the seed writes in place);
 * 3. clamp, reject or flag values outside their registry min/max, per origin (`BOUNDS_POLICY`; an
 *    undo or redo restores values as they were, `UNDO_BOUNDS_POLICY`);
 * 4. run the input rules on the post-change resolved state (any error: `ChangesetRejectedError`);
 * 5. write the changeset and its change rows, then upsert or delete each row it changes;
 * 6. bump the scenario version and call the Recompute hook (DOM-05), all before the commit.
 *
 * Everything runs in one `store.transaction`; nothing is written before steps 1-4 pass, and a throw
 * from a later step (e.g. the Recompute hook) rolls the transaction back.
 */
import type {
  DimId,
  DimensionDef,
  Member,
  MemberId,
  ModelBundle,
  NodeDef,
  TenantMembers,
  VarId,
  VariableDef,
} from '@glidepath/spec';
import {
  ChangesetConflictError,
  ChangesetRejectedError,
  ScenarioNotFoundError,
  type StaleChange,
} from './apply-errors';
import {
  ChangesetDraftError,
  changeRowTarget,
  checkDraft,
  type Change,
  type ChangeRow,
  type ChangeRowOp,
  type ChangeRowTarget,
  type Changeset,
  type ChangesetDraft,
  type ChangesetId,
  type ChangesetOrigin,
  type DraftIssue,
  type JsonObject,
  type JsonValue,
  type ScenarioId,
  type StructuralChange,
  type Timestamp,
  type UserId,
  type ValueChange,
} from './changeset';
import { splitMemberKey } from './member-key';
import { memberOfRow } from './member-rows';
import type {
  ChangesetStore,
  ChangesetTx,
  MemberWrite,
  ScenarioKind,
  ScenarioRow,
  ValueWrite,
} from './ports';
import { resolveInputs, type InputValueRow, type NodeOverrideRow } from './resolve';
import {
  toCellKey,
  validateInputs,
  vr04RegistryBounds,
  type ValidationEntry,
  type ValidationState,
} from './validation';

// ------------------------------------------------------------------------------------------ rules

/** What happens to a value a draft sets outside its variable's registry min/max (step 3, VR04). */
export type BoundsPolicy = 'clamp' | 'reject' | 'warn';

/**
 * Step 3 per origin (schema.json VR04: "UI clamps sliders; import flags"):
 * - `clamp`: the value is written as the nearest bound (UI sliders and typed entries);
 * - `reject`: the changeset is rejected with the cell's VR04 entry as an error (Excel import, API,
 *   AI reconfiguration);
 * - `warn`: the value is written as given and VR04 stays a warning (system writes: the seed keeps the
 *   spec's values, some of which pass a registry max; solver results; market refreshes).
 */
export const BOUNDS_POLICY: Readonly<Record<ChangesetOrigin, BoundsPolicy>> = {
  ui: 'clamp',
  excel_import: 'reject',
  api: 'reject',
  ai_reconfig: 'reject',
  solver: 'warn',
  market_refresh: 'warn',
  seed: 'warn',
};

/**
 * Step 3 for an undo or redo (a draft with `reverts_id`), whatever its origin: it restores values a
 * changeset replaced, so they are written as they were, also past a bound (VR04 stays a warning).
 * Clamping or rejecting them would make the undo restore something else, or nothing.
 */
export const UNDO_BOUNDS_POLICY: BoundsPolicy = 'warn';

/** Origins that write a locked scenario in place (the seed fills the presets); others fork it (step 2). */
export const LOCKED_WRITE_ORIGINS: readonly ChangesetOrigin[] = ['seed'];

/** Origins whose changes are not edits: they leave the edits counter as it is (a preset's stays 0). */
export const UNCOUNTED_ORIGINS: readonly ChangesetOrigin[] = ['seed'];

/** `scenario.kind` of a fork. */
export const FORK_KIND: ScenarioKind = 'user';

/**
 * Key and label of the `n`-th fork of a preset (n from 1): `custom-C` 'Custom (from C)', then
 * `custom-C-2` 'Custom (from C) 2', ... A fork takes the first `n` whose key is free.
 */
export function forkName(
  preset: Pick<ScenarioRow, 'key'>,
  n: number,
): { readonly key: string; readonly label: string } {
  return n === 1
    ? { key: `custom-${preset.key}`, label: `Custom (from ${preset.key})` }
    : { key: `custom-${preset.key}-${n}`, label: `Custom (from ${preset.key}) ${n}` };
}

// ------------------------------------------------------------------------------------------ records

/** `changeset.summary` as applyChangeset writes it (schema.json: "counts, impact preview"). */
export interface ChangesetSummaryData {
  /** Change rows in the changeset. */
  readonly changes: number;
  /**
   * What the changeset adds to its scenario's edits counter: its change count for an edit, 0 for an
   * uncounted origin (the seed) or a fork's copy of the preset's pins, and minus the undone
   * changeset's `edits` for an undo (so a redo adds them back).
   */
  readonly edits: number;
  /** The scenario's edits counter after the changeset (the contract's `editsCount`). */
  readonly edits_count: number;
  /** The contract's `ChangesetRequest.clientRequestId`, for idempotent retries. */
  readonly client_request_id?: string;
  /** The locked preset this changeset forked its scenario from. */
  readonly forked_from?: ScenarioId;
}

/** `change.messages` as applyChangeset writes it: the change's note and the rule warnings on its cell. */
export interface ChangeMessages {
  /** The draft change's note (the contract's `ChangeRecord.note`); change has no note column. */
  readonly note?: string;
  /** The post-change warnings that point at the change's cell (VR04 past a bound, for `warn` origins). */
  readonly warnings?: readonly ValidationEntry[];
}

const num = (v: JsonValue | undefined): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;
const str = (v: JsonValue | undefined): string | undefined =>
  typeof v === 'string' ? v : undefined;
const asObject = (v: JsonValue): JsonObject =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as JsonObject) : {};

/** A stored changeset's summary read leniently: counts it does not record fall back to its change rows. */
export function summaryOf(changeset: Pick<Changeset, 'summary' | 'changes'>): ChangesetSummaryData {
  const s = asObject(changeset.summary);
  const applied = changeset.changes.filter((r) => r.status === 'clean' || r.status === 'accepted');
  const clientRequestId = str(s.client_request_id);
  const forkedFrom = str(s.forked_from);
  return {
    changes: num(s.changes) ?? changeset.changes.length,
    edits: num(s.edits) ?? applied.length,
    edits_count: num(s.edits_count) ?? 0,
    ...(clientRequestId === undefined ? {} : { client_request_id: clientRequestId }),
    ...(forkedFrom === undefined ? {} : { forked_from: forkedFrom }),
  };
}

/** A stored change row's messages. */
export function messagesOf(row: Pick<ChangeRow, 'messages'>): ChangeMessages {
  const m = asObject(row.messages);
  const note = str(m.note);
  const warnings = Array.isArray(m.warnings) ? (m.warnings as unknown as ValidationEntry[]) : [];
  return {
    ...(note === undefined ? {} : { note }),
    ...(warnings.length === 0 ? {} : { warnings }),
  };
}

const entryJson = (e: ValidationEntry): JsonObject => ({
  rule: e.rule,
  severity: e.severity,
  cells: [...e.cells],
  message: e.message,
});

function messagesJson(note: string | undefined, warnings: readonly ValidationEntry[]): JsonObject {
  return {
    ...(note === undefined ? {} : { note }),
    ...(warnings.length === 0 ? {} : { warnings: warnings.map(entryJson) }),
  };
}

function summaryJson(s: ChangesetSummaryData): JsonObject {
  return {
    changes: s.changes,
    edits: s.edits,
    edits_count: s.edits_count,
    ...(s.client_request_id === undefined ? {} : { client_request_id: s.client_request_id }),
    ...(s.forked_from === undefined ? {} : { forked_from: s.forked_from }),
  };
}

// ------------------------------------------------------------------------------------------ API

/** The parts of the tenant's pinned model the write path reads. */
export type ApplyBundle = Pick<ModelBundle, 'variables' | 'nodes' | 'dimensions'>;

/** What the Recompute hook gets, inside the transaction, after the writes and the version bump. */
export interface RecomputeInput {
  readonly tx: ChangesetTx;
  /** The changeset as written, with its change rows. */
  readonly changeset: Changeset;
  /** The scenario with its new version; null for tenant defaults. */
  readonly scenario: ScenarioRow | null;
  /** The post-change state the input rules passed: bundle, members and resolved input values. */
  readonly state: ValidationState;
  /** The scenario's node overrides after the change; empty for tenant defaults. */
  readonly overrides: readonly NodeOverrideRow[];
}

/**
 * Step 6 hook: recompute and store `calc_run` (DOM-05). It runs before the commit, so a throw (e.g.
 * a `ChangesetRejectedError` for VR05 or VR08) rolls the whole changeset back. Its result is returned
 * as `ApplyResult.recomputed`.
 */
export type Recompute<R> = (input: RecomputeInput) => Promise<R>;

/** The default Recompute hook: does nothing. The server passes `recomputeHook` (DOM-05, ./recompute). */
export const noRecompute: Recompute<undefined> = () => Promise.resolve(undefined);

export interface ApplyOptions<R = undefined> {
  /**
   * The user applying the changeset, written to changeset.created_by, audit_log.actor and a fork's
   * created_by. Explicit: the store's context carries the tenant only.
   */
  readonly actor: UserId;
  /** The tenant's pinned model: registry bounds (step 3), rules (step 4), keys of changes. */
  readonly bundle: ApplyBundle;
  /**
   * The contract's `ChangesetRequest.clientRequestId`. Kept in the changeset summary; when `actor`
   * already applied a changeset under it, nothing is applied and that changeset's result returns.
   */
  readonly clientRequestId?: string;
  /** Step 6; `noRecompute` by default, `recomputeHook(...)` on the server. */
  readonly recompute?: Recompute<R>;
  /** Ids of new rows (changesets, forks); `crypto.randomUUID` by default. */
  readonly newId?: () => string;
  /** created_at and audit times; the current time by default. */
  readonly now?: () => Timestamp;
}

/** A value the `ui` origin clamped to its registry bounds. */
export interface ClampedValue {
  /** The index of the change in the draft. */
  readonly index: number;
  /** CellKey `var[member_key]`. */
  readonly cell: string;
  /** The value the draft asked for. */
  readonly requested: number;
  /** The value written: the nearest bound. */
  readonly value: number;
}

/**
 * An applied changeset, in the terms the contract's `ChangesetResult` and WS `changeset` message
 * need (DOM-05's Recompute adds inputHash and outputs).
 */
export interface ApplyResult<R = undefined> {
  readonly changesetId: ChangesetId;
  /** Where the changes landed: the draft's scenario or the fork of a locked preset; null = tenant defaults. */
  readonly scenarioId: ScenarioId | null;
  /** The scenario's version after the changeset (tenant defaults: their changeset count). */
  readonly version: number;
  /** The scenario's edits counter after the changeset (`ChangesetSummaryData.edits_count`). */
  readonly editsCount: number;
  /** The locked preset the draft targeted, when it was forked; the author's sessions follow the fork. */
  readonly forkedFrom?: ScenarioId;
  /** The changeset as stored (origin, created_by and reverts_id for the WS message and history). */
  readonly changeset: Changeset;
  /**
   * Rule warnings on the post-change state (VR04, also on cells the draft did not touch). On a replay,
   * the warnings recorded on its change rows.
   */
  readonly warnings: readonly ValidationEntry[];
  /** Values the `ui` origin clamped; empty for other origins and replays. */
  readonly clamped: readonly ClampedValue[];
  /** True when `clientRequestId` was already applied: nothing was written this time. */
  readonly replayed: boolean;
  /** What the Recompute hook returned; undefined on a replay. */
  readonly recomputed: R | undefined;
}

/**
 * Apply `draft` through `store`, as the actor in `options`. Throws, writing nothing:
 * - `ChangesetDraftError`: the draft is invalid (`checkDraft`), or invalid against the stored state
 *   (unknown variable, node, tenant dimension or member; arity of a member key; inserting a member
 *   that exists, changing one that does not; unsetting a row the level does not have; an unknown or
 *   not applied `reverts_id`, or one on another or a locked scenario);
 * - `ScenarioNotFoundError`: the draft's scenario does not exist;
 * - `ChangesetConflictError`: `base_scenario_version` is not the stored version, or an `old_value`
 *   is stale;
 * - `ChangesetRejectedError`: a rule error on the post-change state, or a value past its registry
 *   bounds from a `reject` origin;
 * - whatever the store or the Recompute hook throws.
 */
export async function applyChangeset<R = undefined>(
  store: ChangesetStore,
  draft: ChangesetDraft,
  options: ApplyOptions<R>,
): Promise<ApplyResult<R>> {
  checkDraft(draft);
  const ctx = contextOf(options);
  return store.transaction((tx) => applyIn(tx, draft, ctx, {}));
}

/**
 * How the scenario operations of this package (./scenario, ./history) write through the path; not
 * exported by the package. `bounds` replaces step 3's policy; `uncounted` leaves the edits counter as
 * it is (a new scenario's first values are no edits).
 */
export interface WriteMode {
  readonly bounds?: BoundsPolicy;
  readonly uncounted?: boolean;
}

/**
 * `applyChangeset` inside a transaction the caller already holds, so a scenario operation commits or
 * rolls back as one (e.g. `createScenario`: the scenario row and its first values). Package-internal.
 */
export function applyInTx<R = undefined>(
  tx: ChangesetTx,
  draft: ChangesetDraft,
  options: ApplyOptions<R>,
  mode: WriteMode = {},
): Promise<ApplyResult<R>> {
  checkDraft(draft);
  return applyIn(tx, draft, contextOf(options), mode);
}

interface Context<R> {
  readonly actor: UserId;
  readonly bundle: ApplyBundle;
  readonly clientRequestId: string | undefined;
  readonly recompute: Recompute<R>;
  readonly newId: () => string;
  readonly now: () => Timestamp;
}

function contextOf<R>(options: ApplyOptions<R>): Context<R> {
  return {
    actor: options.actor,
    bundle: options.bundle,
    clientRequestId: options.clientRequestId,
    recompute: options.recompute ?? (noRecompute as Recompute<R>),
    newId: options.newId ?? (() => crypto.randomUUID()),
    now: options.now ?? (() => new Date().toISOString()),
  };
}

const draftError = (message: string): ChangesetDraftError =>
  new ChangesetDraftError([{ index: null, message }]);

async function applyIn<R>(
  tx: ChangesetTx,
  draft: ChangesetDraft,
  ctx: Context<R>,
  mode: WriteMode,
): Promise<ApplyResult<R>> {
  // Step 1: lock, replay, version.
  let scenario: ScenarioRow | null = null;
  if (draft.scenario_id === null) {
    await tx.lockTenantDefaults();
  } else {
    scenario = await tx.loadScenarioForUpdate(draft.scenario_id);
    if (scenario === null) throw new ScenarioNotFoundError(draft.scenario_id);
  }
  if (ctx.clientRequestId !== undefined) {
    const prior = await tx.findChangesetByClientRequest(ctx.actor, ctx.clientRequestId);
    if (prior !== null) return replayResult(prior, draft.scenario_id);
  }
  const previous = await checkVersion(tx, draft, scenario);
  const reverted = await revertTarget(tx, draft, scenario);

  // Step 2: a locked preset forks; the draft is retargeted to the fork.
  let target = scenario;
  let base = draft.base_scenario_version;
  let previousCount = previous === null ? 0 : summaryOf(previous).edits_count;
  let forkedFrom: ScenarioId | undefined;
  if (scenario?.locked && !LOCKED_WRITE_ORIGINS.includes(draft.origin)) {
    target = await fork(tx, scenario, draft.origin, ctx);
    base = target.version;
    previousCount = 0;
    forkedFrom = scenario.id;
  }

  // Steps 3 and 4: the post-change state, bounds and input rules.
  const changesetId = ctx.newId();
  const policy =
    mode.bounds ?? (reverted !== null ? UNDO_BOUNDS_POLICY : BOUNDS_POLICY[draft.origin]);
  const plan = await planChanges(tx, draft, target, base, changesetId, policy, ctx);
  const entries = validateInputs(plan.state);
  const errors = entries.filter((e) => e.severity === 'error');
  if (errors.length > 0) throw new ChangesetRejectedError(errors);
  const warnings = entries.filter((e) => e.severity === 'warning');

  // Step 5: the changeset, its change rows, then the rows it changes.
  const onCell = new Map<string, ValidationEntry[]>();
  for (const w of warnings)
    for (const cell of w.cells) onCell.set(cell, [...(onCell.get(cell) ?? []), w]);
  const changes: ChangeRow[] = plan.changes.map((p, seq) => ({
    changeset_id: changesetId,
    seq,
    target: p.target,
    key: p.change.key,
    member_key: p.change.member_key,
    op: p.op,
    old_value: p.old,
    new_value: p.new,
    export_value: null,
    status: 'clean',
    messages: messagesJson(
      p.change.note,
      onCell.get(toCellKey(p.change.key, p.change.member_key)) ?? [],
    ),
  }));
  const edits =
    reverted !== null
      ? -summaryOf(reverted).edits
      : mode.uncounted === true || UNCOUNTED_ORIGINS.includes(draft.origin)
        ? 0
        : changes.length;
  const summary: ChangesetSummaryData = {
    changes: changes.length,
    edits,
    edits_count: Math.max(0, previousCount + edits),
    ...(ctx.clientRequestId === undefined ? {} : { client_request_id: ctx.clientRequestId }),
    ...(forkedFrom === undefined ? {} : { forked_from: forkedFrom }),
  };
  const at = ctx.now();
  const changeset: Changeset = {
    id: changesetId,
    origin: draft.origin,
    scenario_id: target?.id ?? null,
    base_scenario_version: base,
    status: 'applied',
    summary: summaryJson(summary),
    created_by: ctx.actor,
    created_at: at,
    reverts_id: draft.reverts_id ?? null,
    changes,
  };
  await tx.insertChangeset(changeset);
  for (const w of plan.writes) {
    if (w.kind === 'value') await tx.writeValue(w.write);
    else await tx.writeMember(w.write);
  }
  if (reverted !== null) await tx.setChangesetStatus(reverted.id, 'reverted');

  // Step 6: version, audit, recompute (before the commit).
  const version = target === null ? base + 1 : await tx.bumpVersion(target.id, base);
  const after: ScenarioRow | null = target === null ? null : { ...target, version };
  await tx.appendAudit({
    actor: ctx.actor,
    action: 'changeset.apply',
    entity: 'changeset',
    entity_key: changesetId,
    before: null,
    after: {
      origin: changeset.origin,
      scenario_id: changeset.scenario_id,
      base_scenario_version: base,
      version,
      reverts_id: changeset.reverts_id,
      summary: changeset.summary,
    },
    at,
  });
  if (reverted !== null) {
    await tx.appendAudit({
      actor: ctx.actor,
      action: 'changeset.revert',
      entity: 'changeset',
      entity_key: reverted.id,
      before: { status: reverted.status },
      after: { status: 'reverted', reverted_by: changesetId },
      at,
    });
  }
  const recomputed = await ctx.recompute({
    tx,
    changeset,
    scenario: after,
    state: plan.state,
    overrides: plan.overrides,
  });
  return {
    changesetId,
    scenarioId: changeset.scenario_id,
    version,
    editsCount: summary.edits_count,
    ...(forkedFrom === undefined ? {} : { forkedFrom }),
    changeset,
    warnings,
    clamped: plan.clamped,
    replayed: false,
    recomputed,
  };
}

/**
 * The result of a changeset already applied under the request's clientRequestId, for a request on
 * `scenarioId` (the changeset's scenario, or the preset it forked). Package-internal.
 */
export function replayResult<R>(prior: Changeset, scenarioId: ScenarioId | null): ApplyResult<R> {
  const summary = summaryOf(prior);
  if (prior.scenario_id !== scenarioId && summary.forked_from !== scenarioId) {
    throw draftError(
      `clientRequestId ${summary.client_request_id ?? ''} was used for changeset ${prior.id} on another scenario`,
    );
  }
  const seen = new Set<string>();
  const warnings = prior.changes
    .flatMap((r) => messagesOf(r).warnings ?? [])
    .filter((w) => {
      const id = JSON.stringify(w);
      return seen.has(id) ? false : (seen.add(id), true);
    });
  return {
    changesetId: prior.id,
    scenarioId: prior.scenario_id,
    version: prior.base_scenario_version + 1,
    editsCount: summary.edits_count,
    ...(summary.forked_from === undefined ? {} : { forkedFrom: summary.forked_from }),
    changeset: prior,
    warnings,
    clamped: [],
    replayed: true,
    recomputed: undefined,
  };
}

/**
 * Step 1: throw a conflict unless the draft starts from the stored version. Returns the changeset
 * that produced that version (its summary holds the edits counter so far), or null.
 */
async function checkVersion(
  tx: ChangesetTx,
  draft: ChangesetDraft,
  scenario: ScenarioRow | null,
): Promise<Changeset | null> {
  const base = draft.base_scenario_version;
  if (scenario !== null) {
    if (base !== scenario.version) {
      throw new ChangesetConflictError(
        base,
        scenario.version,
        await tx.changesSince(scenario.id, base),
      );
    }
  } else {
    // Tenant defaults: the version is the number of changesets applied, with bases 0, 1, ...
    const since = await tx.changesSince(null, base);
    if (since.length > 0) throw new ChangesetConflictError(base, base + since.length, since);
  }
  if (base === 0) return null;
  const last = (await tx.changesSince(draft.scenario_id, base - 1)).find(
    (c) => c.base_scenario_version === base - 1,
  );
  if (last !== undefined || scenario !== null) return last ?? null;
  // Tenant defaults: the draft starts past the last changeset.
  throw new ChangesetConflictError(base, (await tx.changesSince(null, 0)).length, []);
}

/** The changeset an undo draft reverts (`reverts_id`), checked; null when the draft is no undo. */
async function revertTarget(
  tx: ChangesetTx,
  draft: ChangesetDraft,
  scenario: ScenarioRow | null,
): Promise<Changeset | null> {
  const id = draft.reverts_id ?? null;
  if (id === null) return null;
  const target = await tx.loadChangeset(id);
  if (target === null) throw draftError(`reverts_id ${id}: no such changeset`);
  if (target.scenario_id !== draft.scenario_id) {
    throw draftError(`reverts_id ${id}: the changeset belongs to another scenario`);
  }
  if (target.status !== 'applied') {
    throw draftError(`reverts_id ${id}: the changeset is ${target.status}, not applied`);
  }
  if (scenario?.locked && !LOCKED_WRITE_ORIGINS.includes(draft.origin)) {
    throw draftError(
      `reverts_id ${id}: scenario ${scenario.key} is locked; its changesets cannot be undone`,
    );
  }
  return target;
}

/**
 * Step 2: create the fork of a locked preset, version 0, inheriting the preset's values through
 * `parent_id`. Node overrides are not inherited, so the preset's pins are copied in a changeset of
 * their own (version 1), which an undo of the first edit leaves in place.
 */
async function fork<R>(
  tx: ChangesetTx,
  preset: ScenarioRow,
  origin: ChangesetOrigin,
  ctx: Context<R>,
): Promise<ScenarioRow> {
  const taken = new Set((await tx.loadScenarios()).map((s) => s.key));
  let n = 1;
  while (taken.has(forkName(preset, n).key)) n += 1;
  const at = ctx.now();
  const row: ScenarioRow = {
    id: ctx.newId(),
    ...forkName(preset, n),
    kind: FORK_KIND,
    parent_id: preset.id,
    model_version_id: preset.model_version_id,
    version: 0,
    locked: false,
    created_by: ctx.actor,
    created_at: at,
  };
  await tx.createScenario(row);
  await tx.appendAudit({
    actor: ctx.actor,
    action: 'scenario.fork',
    entity: 'scenario',
    entity_key: row.id,
    before: null,
    after: { ...row, forked_from: preset.id },
    at,
  });

  const pins = (await tx.loadInputs(preset.id)).overrides;
  if (pins.length === 0) return row;
  const id = ctx.newId();
  await tx.insertChangeset({
    id,
    origin,
    scenario_id: row.id,
    base_scenario_version: 0,
    status: 'applied',
    summary: summaryJson({
      changes: pins.length,
      edits: 0,
      edits_count: 0,
      forked_from: preset.id,
    }),
    created_by: ctx.actor,
    created_at: at,
    reverts_id: null,
    changes: pins.map((p, seq) => ({
      changeset_id: id,
      seq,
      target: 'node_override',
      key: p.node_key,
      member_key: p.member_key,
      op: 'insert',
      old_value: null,
      new_value: p.value,
      export_value: null,
      status: 'clean',
      messages: messagesJson(p.reason, []),
    })),
  });
  for (const p of pins) {
    await tx.writeValue({
      target: 'node_override',
      scenario_id: row.id,
      key: p.node_key,
      member_key: p.member_key,
      value: p.value,
      reason: p.reason,
    });
  }
  const version = await tx.bumpVersion(row.id, 0);
  return { ...row, version };
}

// ------------------------------------------------------------------------------------------ plan

interface PlannedChange {
  readonly change: Change;
  readonly target: ChangeRowTarget;
  readonly op: ChangeRowOp;
  readonly old: JsonValue;
  readonly new: JsonValue;
}

type Write =
  | { readonly kind: 'value'; readonly write: ValueWrite }
  | { readonly kind: 'member'; readonly write: MemberWrite };

interface Plan {
  /** In draft order. */
  readonly changes: readonly PlannedChange[];
  /** In draft order. */
  readonly writes: readonly Write[];
  readonly clamped: readonly ClampedValue[];
  readonly state: ValidationState;
  readonly overrides: readonly NodeOverrideRow[];
}

const STRUCTURAL_OPS: Readonly<Record<StructuralChange['op'], ChangeRowOp>> = {
  insert: 'insert',
  set: 'update',
  delete: 'delete',
};

/** A tenant dimension holds tenant rows (scope `tenant` or `global+tenant`). */
const isTenantDim = (d: DimensionDef | undefined): boolean =>
  d !== undefined && d.scope.split('+').includes('tenant');

/** JSON equality, object keys in any order. */
function sameJson(a: JsonValue, b: JsonValue): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    const x = a as readonly JsonValue[];
    const y = b as readonly JsonValue[];
    return (
      Array.isArray(a) === Array.isArray(b) &&
      x.length === y.length &&
      x.every((v, i) => sameJson(v, y[i]!))
    );
  }
  const x = a as JsonObject;
  const y = b as JsonObject;
  const keys = Object.keys(x);
  return (
    keys.length === Object.keys(y).length &&
    keys.every((k) => Object.hasOwn(y, k) && sameJson(x[k]!, y[k]!))
  );
}

const clampTo = (v: number, min: number | null, max: number | null): number =>
  Math.min(Math.max(v, min ?? -Infinity), max ?? Infinity);

/**
 * Steps 3 and 4 up to the rules: walk the draft over the stored state of the target level (with each
 * change seeing the earlier ones), collect draft problems, stale `old_value`s and bound breaches,
 * and build the change rows, the writes and the post-change state.
 */
async function planChanges<R>(
  tx: ChangesetTx,
  draft: ChangesetDraft,
  target: ScenarioRow | null,
  base: number,
  changesetId: ChangesetId,
  policy: BoundsPolicy,
  ctx: Context<R>,
): Promise<Plan> {
  const { bundle } = ctx;
  const scenarioId = target?.id ?? null;
  const variableIds = bundle.variables.map((v) => v.id);
  const variables = new Map<VarId, VariableDef>(bundle.variables.map((v) => [v.id, v]));
  const nodes = new Map(bundle.nodes.map((n) => [n.id, n]));
  const dimensions = new Map(bundle.dimensions.map((d) => [d.id, d]));

  const issues: DraftIssue[] = [];
  const stale: StaleChange[] = [];
  const rejected: ValidationEntry[] = [];
  const clamped: ClampedValue[] = [];
  const planned: (PlannedChange | undefined)[] = [];
  const writes: (Write | undefined)[] = [];

  const inputs = await tx.loadInputs(scenarioId);
  const stored = await tx.loadMembers();
  const indexed = draft.changes.map((change, index) => ({ change, index }));

  // Structural rows first: the value checks and the rules see the post-change members.
  const members = new Map<DimId, Member[]>(Object.entries(stored).map(([d, ms]) => [d, [...ms]]));
  const structural = indexed.filter(
    (x): x is { change: StructuralChange; index: number } => x.change.target === 'structural',
  );
  const rowsOf = new Map<DimId, Map<MemberId, JsonObject>>();
  for (const { change } of structural) {
    if (rowsOf.has(change.key) || !isTenantDim(dimensions.get(change.key))) continue;
    const keys = [
      ...new Set(
        structural.filter((x) => x.change.key === change.key).map((x) => x.change.member_key),
      ),
    ];
    rowsOf.set(change.key, new Map(await tx.loadMemberRows(change.key, keys)));
  }
  for (const { change: c, index } of structural) {
    const cell = toCellKey(c.key, c.member_key);
    const rows = rowsOf.get(c.key);
    if (rows === undefined) {
      issues.push({ index, message: `${cell}: ${c.key} is not a tenant dimension` });
      continue;
    }
    const current = rows.get(c.member_key) ?? null;
    if ((c.op === 'insert') !== (current === null)) {
      issues.push({
        index,
        message:
          c.op === 'insert'
            ? `${cell}: the member exists; set it instead`
            : `${cell}: the member does not exist; insert it first`,
      });
      continue;
    }
    if (c.old_value !== undefined && !sameJson(c.old_value, current)) {
      stale.push({ index, cell, expected: c.old_value, actual: current });
    }
    if (c.new_value === null) rows.delete(c.member_key);
    else rows.set(c.member_key, c.new_value);
    const list = members.get(c.key) ?? [];
    members.set(c.key, list);
    const at = list.findIndex((m) => m.id === c.member_key);
    const next =
      c.new_value === null ? null : memberOfRow(c.key, c.member_key, c.new_value, list[at]);
    if (at >= 0 && next !== null) list[at] = next;
    else if (at >= 0) list.splice(at, 1);
    else if (next !== null) list.push(next);
    const rowTarget = changeRowTarget(c, scenarioId) as MemberWrite['target'];
    planned[index] = {
      change: c,
      target: rowTarget,
      op: STRUCTURAL_OPS[c.op],
      old: current,
      new: c.new_value,
    };
    writes[index] = {
      kind: 'member',
      write: {
        target: rowTarget,
        dim_key: c.key,
        member_key: c.member_key,
        row: c.new_value,
      },
    };
  }
  const postMembers: TenantMembers = Object.fromEntries(members);
  const idsOf = new Map<DimId, Set<MemberId>>();
  const hasMember = (dim: DimId, id: MemberId): boolean => {
    let ids = idsOf.get(dim);
    if (ids === undefined)
      idsOf.set(dim, (ids = new Set((members.get(dim) ?? []).map((m) => m.id))));
    return ids.has(id);
  };

  // Values: the target level's own rows, and what its cells inherit.
  const own: readonly InputValueRow[] =
    target === null ? inputs.defaults : levelOf(inputs.chain, target.id);
  const ownValues = new Map(own.map((r) => [toCellKey(r.var_key, r.member_key), r]));
  const inherited = new Map(
    target === null
      ? []
      : resolveInputs(inputs.defaults, inputs.chain.slice(0, -1), [], {
          variables: variableIds,
        }).values.map((r) => [toCellKey(r.var_key, r.member_key), r.value]),
  );
  const ownOverrides = new Map(
    inputs.overrides.map((o) => [toCellKey(o.node_key, o.member_key), o]),
  );

  for (const { change: c, index } of indexed) {
    if (c.target === 'structural') continue;
    const cell = toCellKey(c.key, c.member_key);
    const def = c.target === 'variable' ? variables.get(c.key) : nodes.get(c.key);
    if (def === undefined) {
      issues.push({
        index,
        message: `${cell}: the model has no ${c.target === 'variable' ? 'variable' : 'node'} ${c.key}`,
      });
      continue;
    }
    const problem = memberProblem(def, c, hasMember);
    if (problem !== null) {
      issues.push({ index, message: `${cell}: ${problem}` });
      continue;
    }
    let old: number | null;
    let op: ChangeRowOp;
    let value = c.new_value;
    if (c.target === 'variable') {
      const mine = ownValues.get(cell);
      old = mine?.value ?? inherited.get(cell) ?? null;
      if (value === null) {
        if (mine === undefined) {
          issues.push({
            index,
            message: `${cell}: the scenario sets no value of its own to unset`,
          });
          continue;
        }
        op = 'delete';
        ownValues.delete(cell);
      } else {
        const breach = vr04RegistryBounds({
          bundle: { variables: [def as VariableDef], nodes: [] },
          members: postMembers,
          values: [{ var_key: c.key, member_key: c.member_key, value }],
        })[0];
        if (breach !== undefined && policy === 'clamp') {
          const v = clampTo(value, (def as VariableDef).min, (def as VariableDef).max);
          clamped.push({ index, cell, requested: value, value: v });
          value = v;
        } else if (breach !== undefined && policy === 'reject') {
          rejected.push({ ...breach, severity: 'error' });
        }
        op = mine === undefined ? 'insert' : 'update';
        ownValues.set(cell, { var_key: c.key, member_key: c.member_key, value });
      }
    } else {
      const pin = ownOverrides.get(cell);
      old = pin?.value ?? null;
      if (value === null) {
        if (pin === undefined) {
          issues.push({ index, message: `${cell}: the scenario has no pin to remove` });
          continue;
        }
        op = 'delete';
        ownOverrides.delete(cell);
      } else {
        op = pin === undefined ? 'insert' : 'update';
        ownOverrides.set(cell, {
          node_key: c.key,
          member_key: c.member_key,
          value,
          reason: c.note ?? pin?.reason ?? '',
        });
      }
    }
    if (c.old_value !== undefined && c.old_value !== old) {
      stale.push({ index, cell, expected: c.old_value, actual: old });
    }
    planned[index] = { change: c, target: changeRowTarget(c, scenarioId), op, old, new: value };
    writes[index] = {
      kind: 'value',
      write: valueWrite(c, scenarioId, changesetId, value, ownOverrides.get(cell)?.reason),
    };
  }

  if (issues.length > 0) {
    throw new ChangesetDraftError(issues.sort((a, b) => (a.index ?? -1) - (b.index ?? -1)));
  }
  if (stale.length > 0) {
    throw new ChangesetConflictError(
      base,
      base,
      [],
      stale.sort((a, b) => a.index - b.index),
    );
  }
  if (rejected.length > 0) throw new ChangesetRejectedError(rejected);

  const ownRows = [...ownValues.values()];
  const overrides = [...ownOverrides.values()];
  const resolved =
    target === null
      ? resolveInputs(ownRows, [], [], { variables: variableIds })
      : resolveInputs(
          inputs.defaults,
          [...inputs.chain.slice(0, -1), { scenario_id: target.id, values: ownRows }],
          overrides,
          { variables: variableIds },
        );
  return {
    changes: planned.filter((p): p is PlannedChange => p !== undefined),
    writes: writes.filter((w): w is Write => w !== undefined),
    clamped,
    state: { bundle, members: postMembers, values: resolved.values },
    overrides: resolved.overrides,
  };
}

/** The scenario's own rows: the last level of its chain. */
function levelOf(
  chain: readonly { readonly scenario_id: ScenarioId; readonly values: readonly InputValueRow[] }[],
  scenarioId: ScenarioId,
): readonly InputValueRow[] {
  const last = chain[chain.length - 1];
  if (last?.scenario_id !== scenarioId) {
    throw new Error(`loadInputs(${scenarioId}): the chain does not end at the scenario itself`);
  }
  return last.values;
}

/** Why a value change's member key does not fit its definition, or null. Unset may name gone members. */
function memberProblem(
  def: VariableDef | NodeDef,
  c: ValueChange,
  hasMember: (dim: DimId, id: MemberId) => boolean,
): string | null {
  let binding: Record<DimId, MemberId>;
  try {
    binding = splitMemberKey(def, c.member_key);
  } catch (e) {
    return (e as Error).message.replace(/^splitMemberKey: /, '');
  }
  if (c.op === 'unset') return null;
  const missing = Object.entries(binding).filter(([dim, id]) => !hasMember(dim, id));
  return missing.length === 0
    ? null
    : `no ${missing.map(([dim, id]) => `${dim} member '${id}'`).join(', ')}`;
}

/** The row write of a value change. */
function valueWrite(
  c: ValueChange,
  scenarioId: ScenarioId | null,
  changesetId: ChangesetId,
  value: number | null,
  reason: string | undefined,
): ValueWrite {
  const cell = { key: c.key, member_key: c.member_key, value };
  if (c.target === 'override') {
    return {
      target: 'node_override',
      scenario_id: scenarioId!,
      ...cell,
      ...(value === null || reason === undefined ? {} : { reason }),
    };
  }
  if (scenarioId === null) {
    return {
      target: 'variable_value',
      ...cell,
      ...(c.note === undefined ? {} : { note: c.note }),
      changeset_id: changesetId,
    };
  }
  return { target: 'scenario_value', scenario_id: scenarioId, ...cell, changeset_id: changesetId };
}
