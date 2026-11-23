import { z } from 'zod';
import {
  CellKey,
  ChangesetId,
  ClientRequestId,
  DimKey,
  InputHash,
  MemberKey,
  NodeKey,
  OneLine,
  ScenarioId,
  Timestamp,
  UserId,
  VarKey,
  Version,
} from './ids';
import { Problem, Violation } from './problem';

/** Enums verbatim from `docs/spec/schema.json` `tables.changeset`. */
export const ChangesetOrigin = z.enum([
  'ui',
  'excel_import',
  'api',
  'solver',
  'ai_reconfig',
  'market_refresh',
  'seed',
]);
export type ChangesetOrigin = z.infer<typeof ChangesetOrigin>;

export const ChangesetStatus = z.enum(['pending', 'applied', 'rejected', 'reverted']);
export type ChangesetStatus = z.infer<typeof ChangesetStatus>;

/** `tables.change.op`. */
export const ChangeOp = z.enum(['insert', 'update', 'delete']);
export type ChangeOp = z.infer<typeof ChangeOp>;

/**
 * What a change writes, in API terms. Tier 2 maps these onto `change.target`:
 * variable → scenario_value (or variable_value for tenant defaults), override → node_override,
 * structural → line_item / dimension_member (chosen by `key`, the dimension id).
 */
export const ChangeTarget = z.enum(['variable', 'override', 'structural']);
export type ChangeTarget = z.infer<typeof ChangeTarget>;

const Json = z.json();
const Note = z.string().optional();

/** Set a variable cell. `null` clears the scenario's own value so it inherits again. */
export const VariableChange = z.object({
  target: z.literal('variable'),
  key: VarKey,
  member: MemberKey,
  value: z.number().nullable(),
  note: Note,
});
/** Pin a calculated node cell. `null` removes the pin. */
export const OverrideChange = z.object({
  target: z.literal('override'),
  key: NodeKey,
  member: MemberKey,
  value: z.number().nullable(),
  note: Note,
});
/**
 * Insert or update a member of a tenant dimension (`key` = dim id such as `line`, `vendor`,
 * `domain`), with `value` its attributes; `null` deletes the member.
 */
export const StructuralChange = z.object({
  target: z.literal('structural'),
  key: DimKey,
  member: MemberKey,
  value: z.record(z.string(), Json).nullable(),
  note: Note,
});

export const Change = z.discriminatedUnion('target', [
  VariableChange,
  OverrideChange,
  StructuralChange,
]);
export type Change = z.infer<typeof Change>;

/**
 * `POST /api/t/:tenant/changesets`: a batch of UI edits against the version the client saw.
 *
 * `clientRequestId` makes the POST idempotent: tier 2 stores it with the changeset, and a
 * request whose id it already applied (for the same tenant and user) is not applied again;
 * it answers 200 with that changeset's result. Tier 1 reuses an id only to retry the same
 * request after a network failure; a re-send after 409 carries a new `baseVersion` and a
 * new id. Without the field every POST is a new commit.
 */
export const ChangesetRequest = z.object({
  scenarioId: ScenarioId,
  baseVersion: Version,
  changes: z.array(Change).min(1),
  clientRequestId: ClientRequestId.optional(),
});
export type ChangesetRequest = z.infer<typeof ChangesetRequest>;

/** `POST /api/t/:tenant/changesets/:id/revert`. */
export const RevertRequest = z.object({
  baseVersion: Version,
});
export type RevertRequest = z.infer<typeof RevertRequest>;

/** Headline output cells after recompute (04 §2 step 7). */
export const Outputs = z.record(CellKey, z.number());
export type Outputs = z.infer<typeof Outputs>;

/**
 * Result of an applied changeset. When the target was a locked preset, tier 2 forked
 * `Custom (from X)`: `scenarioId` is the new scenario and `forkedFrom` the preset.
 */
export const ChangesetResult = z.object({
  changesetId: ChangesetId,
  scenarioId: ScenarioId,
  version: Version,
  editsCount: z.number().int().nonnegative(),
  inputHash: InputHash,
  outputs: Outputs,
  warnings: z.array(Violation),
  forkedFrom: ScenarioId.optional(),
});
export type ChangesetResult = z.infer<typeof ChangesetResult>;

export const RevertResult = ChangesetResult.extend({
  reverts: ChangesetId,
});
export type RevertResult = z.infer<typeof RevertResult>;

/** Who made a changeset, as shown on the WS `changeset` message (toast, history). */
export const ChangesetAuthor = z.object({
  id: UserId,
  name: z.string(),
});
export type ChangesetAuthor = z.infer<typeof ChangesetAuthor>;

/** One stored change, as shown in history and in a 409 body. */
export const ChangeRecord = z.object({
  seq: z.number().int().nonnegative(),
  target: ChangeTarget,
  key: z.string().min(1),
  member: MemberKey,
  op: ChangeOp,
  oldValue: Json.nullable(),
  newValue: Json.nullable(),
  note: z.string().optional(),
});
export type ChangeRecord = z.infer<typeof ChangeRecord>;

/** A change some other commit made after the client's `baseVersion`. */
export const ConflictChange = ChangeRecord.extend({
  changesetId: ChangesetId,
});
export type ConflictChange = z.infer<typeof ConflictChange>;

/**
 * 409 body: a problem with the server's version and the changes made since `baseVersion`.
 * Nothing of the request was applied: tier 1 re-sends its pending edits on `serverVersion`
 * (04 §4); tier 2 never re-applies them on its own.
 */
export const ChangesetConflict = Problem.extend({
  status: z.literal(409),
  serverVersion: Version,
  changesSince: z.array(ConflictChange),
});
export type ChangesetConflict = z.infer<typeof ChangesetConflict>;

/** One entry of `GET /scenarios/:id/changesets`. */
export const ChangesetSummary = z.object({
  id: ChangesetId,
  scenarioId: ScenarioId.nullable(),
  origin: ChangesetOrigin,
  status: ChangesetStatus,
  baseVersion: Version,
  editsCount: z.number().int().nonnegative(),
  createdBy: UserId.nullable(),
  createdByName: z.string().nullable(),
  createdAt: Timestamp,
  revertsId: ChangesetId.nullable(),
  summary: OneLine.nullable(),
  changes: z.array(ChangeRecord),
});
export type ChangesetSummary = z.infer<typeof ChangesetSummary>;

export const ChangesetHistoryQuery = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().positive().optional(),
});
export type ChangesetHistoryQuery = z.infer<typeof ChangesetHistoryQuery>;

export const ChangesetHistoryResponse = z.object({
  scenarioId: ScenarioId,
  changesets: z.array(ChangesetSummary),
  nextCursor: z.string().min(1).nullable(),
});
export type ChangesetHistoryResponse = z.infer<typeof ChangesetHistoryResponse>;
