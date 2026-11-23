import type {
  CellValues,
  ServerMessage,
  ViewName,
  ViewParams,
  ViewPayload,
} from '@glidepath/api-contract';

/**
 * Session view state (WEB-03, CON-05): the cell map and view map, exactly as tier 2 pushed them.
 *
 * This module is the one place received values are written. It copies, compares and keys;
 * it never computes (lint: `eslint-rule.ts`, `noArithmeticLintConfig`). `stale` marks a value
 * kept from before a drop: shown dimmed, never replaced by anything tier 2 did not send.
 */

type Of<T extends ServerMessage['type']> = Extract<ServerMessage, { type: T }>;
export type SnapshotMessage = Of<'snapshot'>;
export type DeltaMessage = Of<'delta'>;
export type ViewMessage = Of<'view'>;
export type WarningsMessage = Of<'warnings'>;
export type JobMessage = Of<'job'>;
export type ChangesetMessage = Of<'changeset'>;
export type ErrorMessage = Of<'error'>;
/** RFC 9457 problem tier 2 sent with `error` (a rejected frame, an unknown scenario on `open`). */
export type SessionProblem = ErrorMessage['problem'];

export type CellValue = number | null;

/** One subscribed cell: its last pushed value (`null` = tier 2 has none) and whether it is stale. */
export interface CellEntry {
  readonly value: CellValue;
  readonly stale: boolean;
}

/** One subscribed view (ADR-021): its last pushed payload. */
export interface ViewEntry<V extends ViewName = ViewName> {
  readonly view: V;
  readonly params: ViewParams<V>;
  readonly payload: ViewPayload<V>;
  readonly stale: boolean;
}

/**
 * `connecting`: first connection under way. `open`: live. `reconnecting`: dropped, values dim,
 * backing off. `closed`: ended by `close()`.
 */
export type SessionStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface SessionState {
  readonly status: SessionStatus;
  /**
   * Scenario the session is on: from the last `snapshot`, or the fork a `changeset{forkedFrom}`
   * of this scenario moved it to. `version` comes from that snapshot or the last `changeset`.
   */
  readonly scenarioId: string | null;
  readonly version: number | null;
  /** `editsCount` of the last `changeset` on this scenario; `null` until one arrives. */
  readonly editsCount: number | null;
  /**
   * Scenario an `open` was sent for whose `snapshot` has not arrived yet. Meanwhile
   * `delta` / `view` / `warnings` / `changeset` belong to the old scenario and are ignored.
   */
  readonly opening: string | null;
  /** Keyed by `CellKey` (`res.net[]`). Absent: not received yet; never filled in locally. */
  readonly cells: ReadonlyMap<string, CellEntry>;
  /** Keyed by `viewKey(view, params)`. */
  readonly views: ReadonlyMap<string, ViewEntry>;
  /** Last rule results (preview or commit), in tier 2's words. */
  readonly warnings: WarningsMessage | null;
  readonly jobs: ReadonlyMap<string, JobMessage>;
  /** Last changeset applied to the session's scenario (version, edits count, fork). */
  readonly changeset: ChangesetMessage | null;
  /** Problem of the last `error` tier 2 sent, for the error chip (`problem.detail`). */
  readonly lastError: SessionProblem | null;
}

export const initialSessionState = (): SessionState => ({
  status: 'connecting',
  scenarioId: null,
  version: null,
  editsCount: null,
  opening: null,
  cells: new Map(),
  views: new Map(),
  warnings: null,
  jobs: new Map(),
  changeset: null,
  lastError: null,
});

/** Stable key of a view subscription: name plus params with sorted keys. */
export const viewKey = (view: ViewName, params: object): string =>
  `${view}?${JSON.stringify(params, Object.keys(params).sort())}`;

/** Selector for one cell (use with zustand `useStore(client.store, selectCell(key))`). */
export const selectCell =
  (key: string) =>
  (s: SessionState): CellEntry | undefined =>
    s.cells.get(key);

/** Selector for one view. */
export const selectView =
  <V extends ViewName>(view: V, params: ViewParams<V>) =>
  (s: SessionState): ViewEntry<V> | undefined =>
    s.views.get(viewKey(view, params)) as ViewEntry<V> | undefined;

/** What the dispatcher needs from the client besides the messages. */
export interface ApplyContext {
  /** Highest preview `seq` applied so far (0 before any). */
  readonly lastSeq: number;
  /**
   * Answers with a lower `seq` are void (0 before any): the last `cancelPreview`'s seq (its own
   * answer applies), or after `open` the next seq the client will send (earlier previews are void).
   */
  readonly floorSeq: number;
  hasCell(key: string): boolean;
  hasView(key: string): boolean;
}

/** Copy-on-write map: cloned at the first write of a batch, so unchanged maps keep identity. */
function cow<K, V>(source: ReadonlyMap<K, V>) {
  let map: Map<K, V> | null = null;
  return {
    set(k: K, v: V) {
      map ??= new Map(source);
      map.set(k, v);
    },
    delete(k: K) {
      if (!source.has(k) && !map?.has(k)) return;
      map ??= new Map(source);
      map.delete(k);
    },
    result: (): ReadonlyMap<K, V> => map ?? source,
  };
}

/**
 * The message dispatcher: applies one frame's batch of server messages in arrival order.
 *
 * - A `delta` / `view` / `warnings` whose `seq` is below the last applied (or below the floor)
 *   is ignored. An equal `seq` applies: after a commit the rebase answers with the scratch's
 *   `seq` again (CON-05). `seq: null` (commit, `open` or job) always applies.
 * - While an `open` is pending (`opening`), only the `snapshot` of that scenario, `job` and
 *   `error` apply. That snapshot ends the switch and clears the old scratch's warnings; a new
 *   scenario starts with no changeset. An `error` ends it too: tier 2 refused the `open` and
 *   the session stays where it was.
 * - `changeset` precedes its `delta{seq: null}` and sets `version` and `editsCount`; one whose
 *   `forkedFrom` is the session's scenario moves the session onto the fork.
 * Values of cells or views nobody subscribes to are dropped.
 */
export function applyMessages(
  state: SessionState,
  messages: readonly ServerMessage[],
  ctx: ApplyContext,
): { state: SessionState; lastSeq: number } {
  const cells = cow(state.cells);
  const views = cow(state.views);
  const jobs = cow(state.jobs);
  let { scenarioId, version, editsCount, opening, warnings, changeset, lastError } = state;
  let lastSeq = ctx.lastSeq;

  const current = (seq: number | null) => {
    if (opening !== null) return false;
    if (seq === null) return true;
    if (seq < lastSeq || seq < ctx.floorSeq) return false;
    lastSeq = seq;
    return true;
  };
  const putCells = (values: CellValues) => {
    for (const [key, value] of Object.entries(values)) {
      if (ctx.hasCell(key)) cells.set(key, { value, stale: false });
    }
  };

  for (const m of messages) {
    switch (m.type) {
      case 'snapshot':
        if (opening !== null) {
          if (m.scenarioId !== opening) break; // the old scenario's, or an earlier open's
          opening = null;
          warnings = null;
        }
        if (m.scenarioId !== scenarioId) {
          editsCount = null;
          changeset = null;
        }
        scenarioId = m.scenarioId;
        version = m.version;
        putCells(m.cells);
        break;
      case 'delta':
        if (current(m.seq)) putCells(m.cells);
        break;
      case 'view': {
        const key = viewKey(m.view, m.params);
        if (current(m.seq) && ctx.hasView(key)) {
          views.set(key, {
            view: m.view,
            params: m.params,
            payload: m.payload,
            stale: false,
          } as ViewEntry);
        }
        break;
      }
      case 'warnings':
        if (current(m.seq)) warnings = m;
        break;
      case 'job':
        jobs.set(m.id, m);
        break;
      case 'changeset':
        if (opening !== null) break;
        if (m.forkedFrom !== undefined && m.forkedFrom === scenarioId) scenarioId = m.scenarioId;
        if (m.scenarioId === scenarioId) {
          changeset = m;
          version = m.version;
          editsCount = m.editsCount;
        }
        break;
      case 'error':
        lastError = m.problem;
        opening = null;
        break;
    }
  }

  return {
    state: {
      ...state,
      scenarioId,
      version,
      editsCount,
      opening,
      warnings,
      changeset,
      lastError,
      cells: cells.result(),
      views: views.result(),
      jobs: jobs.result(),
    },
    lastSeq,
  };
}

/** After a drop: every value stays as received, flagged stale (shown dimmed). */
export function markStale(state: SessionState, status: SessionStatus): SessionState {
  const cells = new Map<string, CellEntry>();
  for (const [k, e] of state.cells) cells.set(k, e.stale ? e : { value: e.value, stale: true });
  const views = new Map<string, ViewEntry>();
  for (const [k, e] of state.views) views.set(k, e.stale ? e : { ...e, stale: true });
  return { ...state, status, cells, views };
}

/** Removes entries nobody subscribes to any more. */
export function prune(
  state: SessionState,
  hasCell: (key: string) => boolean,
  hasView: (key: string) => boolean,
): SessionState {
  const cells = cow(state.cells);
  for (const k of state.cells.keys()) if (!hasCell(k)) cells.delete(k);
  const views = cow(state.views);
  for (const k of state.views.keys()) if (!hasView(k)) views.delete(k);
  const c = cells.result();
  const v = views.result();
  return c === state.cells && v === state.views ? state : { ...state, cells: c, views: v };
}
