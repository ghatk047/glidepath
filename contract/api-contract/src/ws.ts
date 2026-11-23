import { z } from 'zod';
import {
  CellKey,
  ChangesetId,
  JobId,
  MemberKey,
  OneLine,
  ScenarioId,
  TenantSlug,
  VarKey,
  Version,
} from './ids';
import { Problem, Violation } from './problem';
import {
  ChangesetAuthor,
  ChangesetConflict,
  ChangesetOrigin,
  ChangesetRequest,
  ChangesetResult,
} from './changeset';

/**
 * `WS /ws/session?tenant&scenario`: the what-if session (03 §2, ADR-004).
 *
 * Every frame is one JSON object with `type` (the message kind) and `v` (protocol version).
 * Parsers reject frames whose `type` is unknown for that direction or whose `v` differs.
 * Previews travel here; commits go over REST (`POST /changesets`) and come back as
 * `changeset` + `delta` on every session open on the scenario (see `SessionStep` for the
 * scratch lifecycle around a commit). `open{scenarioId}` switches the session's scenario.
 */
export const WS_SESSION_PATH = '/ws/session';

/** Protocol version carried as `v` on every message; bump on any breaking change. */
export const WS_PROTOCOL_VERSION = 1;
const V = z.literal(WS_PROTOCOL_VERSION);

/**
 * Query of the upgrade request: tenant slug and the scenario the session opens on first.
 * Later switches go through the `open` message on the same connection.
 */
export const SessionQuery = z.object({ tenant: TenantSlug, scenario: ScenarioId });
export type SessionQuery = z.infer<typeof SessionQuery>;

/**
 * Preview rate and coalescing contract (ADR-004, 07 §3, 03 §2):
 *
 * - Rate: the client sends at most `PREVIEW_MAX_PER_SECOND` `preview` messages per second
 *   **per connection** (one per `PREVIEW_MIN_INTERVAL_MS`, across all cells), always with the
 *   latest values. Cells that move together (e.g. two `org.dom_share` cells of one domain
 *   row) go in one `preview` with several `changes`, never in several previews.
 *   `cancelPreview` and `open` are not rate-limited. Tier 2 does not reject a faster client;
 *   coalescing absorbs the excess.
 * - `seq` comes from one counter per connection, strictly increasing across `preview` and
 *   `cancelPreview`.
 * - The server queues previews while a rerun is busy. The next rerun applies every queued
 *   preview in `seq` order on the session's scratch copy, so for each cell the value of the
 *   latest `seq` wins; all cells of one preview are applied in the same rerun (atomic). A
 *   preview whose cells are all overwritten by later queued previews is superseded: dropped
 *   and never answered. The rerun answers once, with the highest `seq` it applied:
 *   `delta{seq}` (subscribed cells that changed), `view{seq}` for changed views and, when
 *   rules flag the scratch state, `warnings{seq}`.
 * - The client ignores a `delta` / `view` / `warnings` whose `seq` is lower than the last it
 *   applied (an equal `seq` applies: a rebase answers with the scratch's `seq` again).
 *   Messages with `seq: null` come from commits, `open` or jobs and always apply.
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
/** One input cell a preview sets: `var[member]` = `value`. */
export const PreviewChange = z.object({ var: VarKey, member: MemberKey, value: z.number() });
export type PreviewChange = z.infer<typeof PreviewChange>;

/**
 * Try values for 1..n input cells on the session's scratch copy; nothing is written. The
 * cells of one preview are applied atomically (same rerun), e.g. the two `org.dom_share`
 * cells a VP ownership drag moves. A cell appears at most once per preview.
 * Rate and `seq` rules: see `PREVIEW_MAX_PER_SECOND`; lifecycle: see `SessionStep`.
 *
 * The CON-02 single-cell form `{var, member, value, seq}` is not part of the schema;
 * `parseClientMessage` still accepts it on the wire and normalises it to `changes: [cell]`.
 */
export const Preview = message('preview', {
  seq: Seq,
  changes: z
    .array(PreviewChange)
    .min(1)
    .refine(
      (cells) => new Set(cells.map((c) => `${c.var}[${c.member}]`)).size === cells.length,
      'each cell at most once per preview',
    ),
});
/**
 * Drop the scratch copy (Escape / cancelled drag, or the commit settled): every preview with
 * a lower `seq` is void. `seq` is a fresh value from the same counter; the server answers
 * `delta{seq}` with the subscribed cells whose value goes back to the committed one (empty
 * when nothing differs, e.g. after a commit of exactly the previewed values) and, when the
 * scratch had warnings, `warnings{seq, violations: []}` to clear them.
 */
export const CancelPreview = message('cancelPreview', { seq: Seq });
/**
 * Switch the session to another scenario of the same tenant (scenario bar). Tier 2 drops the
 * scratch copy (pending previews are void), keeps every cell and view subscription, and
 * answers `snapshot{scenarioId}` with all subscribed cells, then one `view{seq: null}` per
 * subscribed view. Until that `snapshot` arrives the client ignores `delta` / `view` /
 * `warnings` (they belong to the old scenario). An unknown or forbidden scenario is answered
 * with `error{problem}` and the session stays where it was.
 */
export const Open = message('open', { scenarioId: ScenarioId });

export const ClientMessage = z.discriminatedUnion('type', [
  Subscribe,
  Unsubscribe,
  SubscribeView,
  UnsubscribeView,
  Preview,
  CancelPreview,
  Open,
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
  'open',
] as const satisfies readonly ClientMessageType[];

// ---------------------------------------------------------------------------
// Server → client
// ---------------------------------------------------------------------------

/** Full values of the subscribed cells on `scenarioId` at `version` (on subscribe, reconnect, `open`). */
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
 * Warnings are about model state only; a rejected frame is answered with `error`, never here.
 */
export const Warnings = message('warnings', {
  seq: AnswerSeq,
  violations: z.array(Violation),
});
/**
 * A client frame was rejected: not JSON, unknown `type` or `v`, malformed body, unknown view
 * or params, unknown or forbidden scenario on `open`. `problem.detail` is the one-line
 * reason (the parsers' `detail`). The session stays open and its state is unchanged.
 */
export const ErrorMessage = message('error', { problem: Problem });
/**
 * Which background job a `job` message reports (CON-03): a solver run (`solver.*` queues),
 * an import preview, or an AI reconfiguration (`ai.reconfig`). Absent means `solver`.
 */
export const JobKind = z.enum(['solver', 'import', 'ai.reconfig']);
export type JobKind = z.infer<typeof JobKind>;

/** Job progress fraction, 0..1 (`solver_run.progress`, DATA-11). */
export const JobProgressFraction = z.number().min(0).max(1);

/**
 * Background job progress, at most every 250 ms. `progress` and `note` are `solver_run.progress`
 * and `progress_note` (DATA-11), as the REST job resources carry them (`progress`,
 * `progressNote`). `kind` and `cancelRequested` (CON-03) are optional; `cancelRequested` is
 * true once a cancel was asked for and the job has not yet stopped (status still `running`).
 */
export const Job = message('job', {
  id: JobId,
  status: JobStatus,
  /** Fraction done, 0..1. */
  progress: JobProgressFraction,
  note: OneLine.nullable(),
  kind: JobKind.optional(),
  cancelRequested: z.boolean().optional(),
});
/**
 * A changeset was applied to the session's scenario (by this or another user, or a job).
 * It always precedes the `delta{seq: null}` that carries its values (see `SessionStep`).
 * `changesetId`, `origin` and `author` let tier 1 match its own POST and name who changed
 * what; `author` is `null` for system changesets (seed, scheduled market refresh).
 *
 * Fork: when the commit forked a locked preset, `scenarioId` is the new scenario and
 * `forkedFrom` the preset. The sessions that caused it, i.e. the author's sessions open on
 * the preset, follow the fork: from this message on their scenario is `scenarioId` (the
 * `delta{seq: null}` after it is relative to the preset's values, and later commits,
 * rebases and `cancelPreview` act on the fork). Other sessions on the preset are not moved
 * and get no message (the preset did not change). Any other switch is an explicit `open`.
 */
export const ChangesetApplied = message('changeset', {
  ...ChangesetResult.pick({ scenarioId: true, version: true, editsCount: true, forkedFrom: true })
    .shape,
  changesetId: ChangesetId.optional(),
  origin: ChangesetOrigin.optional(),
  author: ChangesetAuthor.nullable().optional(),
});

export const ServerMessage = z.discriminatedUnion('type', [
  Snapshot,
  Delta,
  View,
  Warnings,
  Job,
  ChangesetApplied,
  ErrorMessage,
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
  'error',
] as const satisfies readonly ServerMessageType[];

// ---------------------------------------------------------------------------
// Scratch lifecycle around a commit (03 §2, 04 §4)
// ---------------------------------------------------------------------------

/**
 * One step of a session timeline: a WS frame either way, or tier 1's `POST /changesets`
 * and how it settled. Typed so fixtures (and tier 1 / tier 2 tests) can spell out a whole
 * exchange and have it checked.
 *
 * Scratch lifecycle. The session holds its scenario's committed state and, while previews
 * are live, a scratch copy = committed state + the latest previewed value of every cell
 * previewed since the last `cancelPreview` / `open`.
 *
 * 1. Preview: `preview{seq, changes}` updates the scratch; answers carry that `seq`.
 * 2. Commit: on release or typed entry tier 1 sends `POST /changesets` (optionally with a
 *    `clientRequestId`). The scratch stays while the request is in flight, so the numbers
 *    do not snap back.
 * 3. Broadcast: tier 2 tells the sessions before it answers the POST. Every session on the
 *    scenario gets, in this order: `changeset{…}`, then `delta{seq: null}` with the
 *    subscribed cells whose committed value changed, then `view{seq: null}` for changed views.
 * 4. Rebase: a session with a scratch re-applies the scratch cells onto the new committed
 *    state and reruns, then answers `delta{seq: S}` (cells where scratch ≠ committed, may be
 *    empty), `view{seq: S}` and `warnings{seq: S}` as for a preview, S being the highest
 *    `seq` in the scratch. Previews are therefore always rebased onto each commit, whoever
 *    made it.
 * 5. Close: tier 1 sends `cancelPreview{seq}` once its POST has settled: resolved (2xx) or
 *    failed (409, 422, network). On 409 it first re-sends its edits on `serverVersion` and
 *    cancels when that re-send settles. Because of step 3, the `cancelPreview` always
 *    reaches the session after the commit it follows.
 * Fork: see `ChangesetApplied`; the author's sessions follow `changeset{forkedFrom}`.
 */
export const SessionStep = z.discriminatedUnion('by', [
  /** Tier 1 → tier 2 over the socket. */
  z.object({ by: z.literal('client'), message: ClientMessage }),
  /** Tier 2 → tier 1 over the socket. */
  z.object({ by: z.literal('server'), message: ServerMessage }),
  /** Tier 1 sends `POST /api/t/:tenant/changesets`. */
  z.object({ by: z.literal('post'), request: ChangesetRequest }),
  /** That POST resolved. */
  z.object({ by: z.literal('postResolved'), result: ChangesetResult }),
  /** That POST failed (a 409 carries `serverVersion` and `changesSince`). */
  z.object({ by: z.literal('postFailed'), problem: z.union([ChangesetConflict, Problem]) }),
]);
export type SessionStep = z.infer<typeof SessionStep>;
export const SessionTimeline = z.array(SessionStep).min(1);
export type SessionTimeline = z.infer<typeof SessionTimeline>;

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/** Parse outcome; `detail` is one line, fit for an `error.problem.detail`. */
export type ParseResult<T> = { ok: true; message: T } | { ok: false; detail: string };

const parseWith =
  <T>(schema: z.ZodType<T>, normalise: (data: unknown) => unknown = (d) => d) =>
  (frame: unknown): ParseResult<T> => {
    let data = frame;
    if (typeof frame === 'string') {
      try {
        data = JSON.parse(frame);
      } catch {
        return { ok: false, detail: 'Frame is not JSON. Send one JSON object per frame.' };
      }
    }
    const result = schema.safeParse(normalise(data));
    if (result.success) return { ok: true, message: result.data };
    const issue = result.error.issues[0];
    const path = issue?.path.length ? issue.path.join('.') : 'message';
    const why = (issue?.message ?? 'invalid').replace(/\s+/g, ' ');
    return { ok: false, detail: `Invalid ${path}: ${why}` };
  };

/**
 * Wire compatibility: a CON-02 single-cell `preview{var, member, value, seq}` becomes
 * `preview{seq, changes: [{var, member, value}]}`. Anything else passes through unchanged.
 */
export const normaliseClientFrame = (data: unknown): unknown => {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return data;
  const frame = data as Record<string, unknown>;
  if (frame.type !== 'preview' || 'changes' in frame || !('var' in frame)) return data;
  const { var: key, member, value, ...rest } = frame;
  return { ...rest, changes: [{ var: key, member, value }] };
};

/**
 * Parse a client frame (JSON text or decoded object). Unknown `type` or other `v` fail.
 * A single-cell `preview` is normalised first (see `normaliseClientFrame`).
 */
export const parseClientMessage = parseWith(ClientMessage, normaliseClientFrame);
/** Parse a server frame (JSON text or decoded object). Unknown `type` or other `v` fail. */
export const parseServerMessage = parseWith(ServerMessage);
