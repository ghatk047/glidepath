import { z } from 'zod';

/**
 * Ids are plain branded strings: no format is enforced at the contract (uuid or not is a
 * tier 3 detail), but the brand stops a ScenarioId being passed where a ChangesetId is expected.
 * Spec ids (`g.target_net`, `res.net`, `'pilots,fy27'`) are carried verbatim.
 */
const id = <B extends string>() => z.string().min(1).brand<B>();

export const TenantId = id<'TenantId'>();
export type TenantId = z.infer<typeof TenantId>;

/** Tenant path segment in `/api/t/:tenant/...` (an IATA-style monogram slug). */
export const TenantSlug = id<'TenantSlug'>();
export type TenantSlug = z.infer<typeof TenantSlug>;

export const UserId = id<'UserId'>();
export type UserId = z.infer<typeof UserId>;

export const ScenarioId = id<'ScenarioId'>();
export type ScenarioId = z.infer<typeof ScenarioId>;

export const ChangesetId = id<'ChangesetId'>();
export type ChangesetId = z.infer<typeof ChangesetId>;

export const ModelVersionId = id<'ModelVersionId'>();
export type ModelVersionId = z.infer<typeof ModelVersionId>;

/**
 * Idempotency key of one commit attempt, chosen by tier 1 (e.g. a UUID). Opaque to tier 2;
 * at most 128 characters.
 */
export const ClientRequestId = z.string().min(1).max(128).brand<'ClientRequestId'>();
export type ClientRequestId = z.infer<typeof ClientRequestId>;

/**
 * A background job, as reported in WS `job` messages: a `solver_run.id`, an `import_job.id`
 * or an `ai_reconfig_job.id` (the message's `kind` says which).
 */
export const JobId = id<'JobId'>();
export type JobId = z.infer<typeof JobId>;

/** An Excel export (`export_job.id`); its snapshot is the E side of an import's 3-way diff. */
export const ExportId = id<'ExportId'>();
export type ExportId = z.infer<typeof ExportId>;

/**
 * A downloadable file held by tier 2 (workbook, CSV, AI audit file). Tier 1 fetches it with
 * `GET /api/t/:tenant/files/:id` only: no storage key, bucket or URL ever crosses the contract.
 */
export const FileId = id<'FileId'>();
export type FileId = z.infer<typeof FileId>;

/** A `market_snapshot` row. */
export const MarketSnapshotId = id<'MarketSnapshotId'>();
export type MarketSnapshotId = z.infer<typeof MarketSnapshotId>;

/** A research source cited by an AI reconfiguration job. */
export const SourceId = id<'SourceId'>();
export type SourceId = z.infer<typeof SourceId>;

/** Registry variable id, e.g. `g.target_net`. */
export const VarKey = id<'VarKey'>();
export type VarKey = z.infer<typeof VarKey>;

/** Formula graph node id, e.g. `res.net`. */
export const NodeKey = id<'NodeKey'>();
export type NodeKey = z.infer<typeof NodeKey>;

/** Dimension id, e.g. `line`, `vp`, `lever`. */
export const DimKey = id<'DimKey'>();
export type DimKey = z.infer<typeof DimKey>;

/** Comma-joined member ids in the variable's dims order; `''` for scalars (schema.json principles). */
export const MemberKey = z.string().brand<'MemberKey'>();
export type MemberKey = z.infer<typeof MemberKey>;

/** Engine input hash (cache key of `calc_run`). */
export const InputHash = id<'InputHash'>();
export type InputHash = z.infer<typeof InputHash>;

/**
 * One evaluated cell: `${id}[${memberKey}]` exactly as the engine's CellKey (03 §1).
 * Scalars have an empty member: `res.net[]`.
 */
export const CellKey = z
  .string()
  .regex(/^[^[\]\s]+\[[^[\]]*\]$/, 'cell key must look like id[member]')
  .brand<'CellKey'>();
export type CellKey = z.infer<typeof CellKey>;

/** Formats a cell key; formatting only, no lookup. */
export const toCellKey = (nodeOrVar: string, member = ''): CellKey =>
  `${nodeOrVar}[${member}]` as CellKey;

/** ISO 8601 timestamp with offset. */
export const Timestamp = z.iso.datetime({ offset: true });

/** Non-negative integer version of a scenario (bumps on every applied changeset). */
export const Version = z.number().int().nonnegative();

/** One line of human text, suitable for a chip or a toast. */
export const OneLine = z
  .string()
  .trim()
  .min(1)
  .regex(/^[^\r\n]*$/, 'must be one line');

/** ISO 8601 calendar date (`YYYY-MM-DD`). */
export const IsoDate = z.iso.date();
