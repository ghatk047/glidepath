import { z } from 'zod';
import { CellKey, JobId, MemberKey, OneLine, ScenarioId, TenantSlug, VarKey, Version } from './ids';
import { Problem, Violation } from './problem';
import { ChangesetResult } from './changeset';

/**
 * `WS /ws/session?tenant&scenario`: the what-if session (03 §2, ADR-004).
 *
 * Every frame is one JSON object with `type` (the message kind) and `v` (protocol version).
 * Parsers reject frames whose `type` is unknown for that direction or whose `v` differs.
 * Previews travel here; commits go over REST (`POST /changesets`) and come back as
 * `changeset` + `delta` on every session open on the scenario.
 */
export const WS_SESSION_PATH = '/ws/session';

/** Protocol version carried as `v` on every message; bump on any breaking change. */
export const WS_PROTOCOL_VERSION = 1;
const V = z.literal(WS_PROTOCOL_VERSION);

/** Query of the upgrade request: tenant slug and the scenario the session opens on. */
export const SessionQuery = z.object({ tenant: TenantSlug, scenario: ScenarioId });
export type SessionQuery = z.infer<typeof SessionQuery>;

/**
 * Preview coalescing contract (ADR-004, 07 §3, 03 §2):
 *
 * - The client sends at most `PREVIEW_MAX_PER_SECOND` previews per second per input cell
 *   (`var[member]`), i.e. one per `PREVIEW_MIN_INTERVAL_MS`, always the latest drag value.
 * - `seq` comes from one counter per connection, strictly increasing across `preview` and
 *   `cancelPreview`.
 * - The server queues previews while a rerun is busy and keeps only the latest `seq` per
 *   cell; superseded previews are dropped and never answered. The next rerun applies the
 *   kept previews on the session's scratch copy and answers once, with the highest `seq` it
 *   applied: `delta{seq}` (subscribed cells that changed), `view{seq}` for changed views and,
 *   when rules flag the scratch state, `warnings{seq}`.
 * - The client ignores a `delta` / `view` / `warnings` whose `seq` is lower than the last it
 *   applied. Messages with `seq: null` come from commits or jobs and always apply.
 */
export const PREVIEW_MAX_PER_SECOND = 30;
export const PREVIEW_MIN_INTERVAL_MS = 1000 / PREVIEW_MAX_PER_SECOND;

/** Client preview sequence number (see the coalescing contract above). */
export const Seq = z.number().int().positive();
export type Seq = z.infer<typeof Seq>;

/** The preview `seq` a server message answers; `null` when it stems from a commit or job. */
const AnswerSeq = Seq.nullable();

/** A pushed cell value; `null` when tier 2 has no value for the cell (e.g. an unset input). */
export const CellValue = z.number().nullable();
export const CellValues = z.record(CellKey, CellValue);
export type CellValues = z.infer<typeof CellValues>;

/** `solver_run.status`, verbatim from `docs/spec/schema.json`. */
export const JobStatus = z.enum(['queued', 'running', 'done', 'failed', 'cancelled']);
export type JobStatus = z.infer<typeof JobStatus>;

const message = <T extends string, S extends z.ZodRawShape>(type: T, shape: S) =>
  z.object({ v: V, type: z.literal(type) }).extend(shape);

// ---------------------------------------------------------------------------
// Views (ADR-021): derived display series computed by tier 2 (DOM-06), pushed like cells.
// Values are in the source nodes' units; tier 1 renders them and does no arithmetic.
// ---------------------------------------------------------------------------

export const viewNames = [
  'bridge',
  'baseline.groups',
  'baseline.summary',
  'levers.families',
  'levers.monthly',
  'levers.scale',
  'vps.domain_outlay',
] as const;
export const ViewName = z.enum(viewNames);
export type ViewName = z.infer<typeof ViewName>;

const NoParams = z.strictObject({});

/** Baseline grouping: a dimension id of `formula_graph.json`. */
export const BaselineGroupBy = z.enum(['pool', 'domain', 'vp']);
export type BaselineGroupBy = z.infer<typeof BaselineGroupBy>;

const bridgeStep = <K extends string>(key: K) =>
  z.object({
    key: z.literal(key),
    /** Node the step comes from, for the trace drawer. */
    cell: CellKey.nullable(),
    /** Level for `base` / `outlay`; signed change to outlay for the steps between. */
    value: z.number(),
    /** Bar extent, so tier 1 draws the waterfall without summing. */
    from: z.number(),
    to: z.number(),
  });

/** Cockpit "CY26 → CY27 outlay". */
export const BridgeView = z.object({
  steps: z.tuple([
    bridgeStep('base'),
    bridgeStep('growth'),
    bridgeStep('savings'),
    bridgeStep('oneTime'),
    bridgeStep('outlay'),
  ]),
  /** Dashed target line: `base.total − res.target`. */
  targetOutlay: z.number(),
  /** Red bracket: CY27 outlay minus target outlay. */
  gap: z.number(),
});
export type BridgeView = z.infer<typeof BridgeView>;

/** Baseline treemap: group → line, values in the grouping's split (VP splits by `org.dom_share`). */
export const BaselineGroupsView = z.object({
  total: z.number(),
  groups: z.array(
    z.object({
      /** Member of the grouping dimension. */
      key: MemberKey,
      label: z.string(),
      value: z.number(),
      /** Line labels and attributes come from `members`. */
      lines: z.array(z.object({ key: MemberKey, value: z.number() })),
    }),
  ),
});
export type BaselineGroupsView = z.infer<typeof BaselineGroupsView>;

/** Baseline header strip counts. */
export const BaselineSummaryView = z.object({
  lines: z.number().int().nonnegative(),
  linesInScope: z.number().int().nonnegative(),
});
export type BaselineSummaryView = z.infer<typeof BaselineSummaryView>;

/** Lever list families: Σ `lev.iy` by lever `category`. */
export const LeversFamiliesView = z.object({
  total: z.number(),
  families: z.array(
    z.object({
      /** Lever `category` attribute value. */
      key: z.string().min(1),
      label: z.string(),
      value: z.number(),
      /** Lever member keys in display order. */
      levers: z.array(MemberKey),
    }),
  ),
});
export type LeversFamiliesView = z.infer<typeof LeversFamiliesView>;

/** Months in the target year shown by `levers.monthly`. */
export const MONTHS_IN_YEAR = 12;
const Monthly = z.array(z.number()).length(MONTHS_IN_YEAR);

/** "2027 by month": family areas (already summed) and one series per lever. */
export const LeversMonthlyView = z.object({
  families: z.array(z.object({ key: z.string().min(1), values: Monthly })),
  levers: z.array(z.object({ key: MemberKey, family: z.string().min(1), values: Monthly })),
});
export type LeversMonthlyView = z.infer<typeof LeversMonthlyView>;

/** Common scale for the lever in-year bars. */
export const LeversScaleView = z.object({ max: z.number() });
export type LeversScaleView = z.infer<typeof LeversScaleView>;

/** Outlay per domain for the ownership editor. */
export const VpsDomainOutlayView = z.object({
  domains: z.array(z.object({ key: MemberKey, value: z.number() })),
});
export type VpsDomainOutlayView = z.infer<typeof VpsDomainOutlayView>;

/** Params and payload schema of every view. `params` is a strict object; `{}` when none. */
export const viewSchemas = {
  bridge: { params: NoParams, payload: BridgeView },
  'baseline.groups': {
    params: z.strictObject({ by: BaselineGroupBy }),
    payload: BaselineGroupsView,
  },
  'baseline.summary': { params: NoParams, payload: BaselineSummaryView },
  'levers.families': { params: NoParams, payload: LeversFamiliesView },
  'levers.monthly': { params: NoParams, payload: LeversMonthlyView },
  'levers.scale': { params: NoParams, payload: LeversScaleView },
  'vps.domain_outlay': { params: NoParams, payload: VpsDomainOutlayView },
} as const satisfies Record<ViewName, { params: z.ZodType; payload: z.ZodType }>;

export type ViewParams<V extends ViewName> = z.infer<(typeof viewSchemas)[V]['params']>;
export type ViewPayload<V extends ViewName> = z.infer<(typeof viewSchemas)[V]['payload']>;

const viewRef = <T extends string, V extends ViewName>(type: T, view: V) =>
  message(type, { view: z.literal(view), params: viewSchemas[view].params });

const viewSubscription = <T extends 'subscribeView' | 'unsubscribeView'>(type: T) =>
  z.discriminatedUnion('view', [
    viewRef(type, 'bridge'),
    viewRef(type, 'baseline.groups'),
    viewRef(type, 'baseline.summary'),
    viewRef(type, 'levers.families'),
    viewRef(type, 'levers.monthly'),
    viewRef(type, 'levers.scale'),
    viewRef(type, 'vps.domain_outlay'),
  ]);

const viewMessage = <V extends ViewName>(view: V) =>
  viewRef('view', view).extend({ seq: AnswerSeq, payload: viewSchemas[view].payload });

// ---------------------------------------------------------------------------
// Client → server
// ---------------------------------------------------------------------------

/** Add cells to the session's push set; answered with a `snapshot` of those cells. */
export const Subscribe = message('subscribe', { cells: z.array(CellKey).min(1) });
/** Remove cells from the push set. */
export const Unsubscribe = message('unsubscribe', { cells: z.array(CellKey).min(1) });
/** Start pushing a view; answered with a `view` message, then one after every change. */
export const SubscribeView = viewSubscription('subscribeView');
/** Stop pushing a view (same `view` + `params` as subscribed). */
export const UnsubscribeView = viewSubscription('unsubscribeView');
/**
 * Try a value for input cell `var[member]` on the session's scratch copy; nothing is written.
 * Rate and `seq` rules: see `PREVIEW_MAX_PER_SECOND`.
 */
export const Preview = message('preview', {
  var: VarKey,
  member: MemberKey,
  value: z.number(),
  seq: Seq,
});
/**
 * Drop the scratch copy (Escape / cancelled drag): every preview with a lower `seq` is void.
 * `seq` is a fresh value from the same counter; the server answers `delta{seq}` with the
 * subscribed cells that change back to committed values.
 */
export const CancelPreview = message('cancelPreview', { seq: Seq });

export const ClientMessage = z.discriminatedUnion('type', [
  Subscribe,
  Unsubscribe,
  SubscribeView,
  UnsubscribeView,
  Preview,
  CancelPreview,
]);
export type ClientMessage = z.infer<typeof ClientMessage>;
export type ClientMessageType = ClientMessage['type'];
export const clientMessageTypes = [
  'subscribe',
  'unsubscribe',
  'subscribeView',
  'unsubscribeView',
  'preview',
  'cancelPreview',
] as const satisfies readonly ClientMessageType[];

// ---------------------------------------------------------------------------
// Server → client
// ---------------------------------------------------------------------------

/** Full values of the subscribed cells on `scenarioId` at `version` (on subscribe, reconnect, switch). */
export const Snapshot = message('snapshot', {
  scenarioId: ScenarioId,
  version: Version,
  cells: CellValues,
});
/** Subscribed cells whose value changed, answering preview `seq` or (`null`) a commit. */
export const Delta = message('delta', { seq: AnswerSeq, cells: CellValues });
/** A view's current payload (ADR-021). */
export const View = z.discriminatedUnion('view', [
  viewMessage('bridge'),
  viewMessage('baseline.groups'),
  viewMessage('baseline.summary'),
  viewMessage('levers.families'),
  viewMessage('levers.monthly'),
  viewMessage('levers.scale'),
  viewMessage('vps.domain_outlay'),
]);
/**
 * Rule results for preview `seq` in tier 2's words (an empty list clears earlier warnings).
 * With `seq: null` and a `problem`, a rejected client message (unknown view or params, bad
 * frame); the session stays open.
 */
export const Warnings = message('warnings', {
  seq: AnswerSeq,
  violations: z.array(Violation),
  problem: Problem.optional(),
});
/** Background job progress (`solver_run`), at most every 250 ms. */
export const Job = message('job', {
  id: JobId,
  status: JobStatus,
  /** Fraction done, 0..1. */
  progress: z.number().min(0).max(1),
  note: OneLine.nullable(),
});
/** A changeset was applied to the session's scenario (by this or another user). */
export const ChangesetApplied = message(
  'changeset',
  ChangesetResult.pick({ scenarioId: true, version: true, editsCount: true, forkedFrom: true })
    .shape,
);

export const ServerMessage = z.discriminatedUnion('type', [
  Snapshot,
  Delta,
  View,
  Warnings,
  Job,
  ChangesetApplied,
]);
export type ServerMessage = z.infer<typeof ServerMessage>;
export type ServerMessageType = ServerMessage['type'];
export const serverMessageTypes = [
  'snapshot',
  'delta',
  'view',
  'warnings',
  'job',
  'changeset',
] as const satisfies readonly ServerMessageType[];

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/** Parse outcome; `detail` is one line, fit for a `warnings.problem.detail`. */
export type ParseResult<T> = { ok: true; message: T } | { ok: false; detail: string };

const parseWith =
  <T>(schema: z.ZodType<T>) =>
  (frame: unknown): ParseResult<T> => {
    let data = frame;
    if (typeof frame === 'string') {
      try {
        data = JSON.parse(frame);
      } catch {
        return { ok: false, detail: 'Frame is not JSON. Send one JSON object per frame.' };
      }
    }
    const result = schema.safeParse(data);
    if (result.success) return { ok: true, message: result.data };
    const issue = result.error.issues[0];
    const path = issue?.path.length ? issue.path.join('.') : 'message';
    const why = (issue?.message ?? 'invalid').replace(/\s+/g, ' ');
    return { ok: false, detail: `Invalid ${path}: ${why}` };
  };

/** Parse a client frame (JSON text or decoded object). Unknown `type` or other `v` fail. */
export const parseClientMessage = parseWith(ClientMessage);
/** Parse a server frame (JSON text or decoded object). Unknown `type` or other `v` fail. */
export const parseServerMessage = parseWith(ServerMessage);
