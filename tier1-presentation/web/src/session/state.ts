import type {
  CellValues,
  ServerMessage,
  ViewName,
  ViewParams,
  ViewPayload,
} from '@glidepath/api-contract';

/**
 * Session view state (WEB-03): the cell map and view map, exactly as tier 2 pushed them.
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
  /** Scenario and version of the last `snapshot` (or `changeset` on that scenario). */
  readonly scenarioId: string | null;
  readonly version: number | null;
  /** Keyed by `CellKey` (`res.net[]`). Absent: not received yet; never filled in locally. */
  readonly cells: ReadonlyMap<string, CellEntry>;
  /** Keyed by `viewKey(view, params)`. */
  readonly views: ReadonlyMap<string, ViewEntry>;
  /** Last rule results (preview or commit), in tier 2's words. */
  readonly warnings: WarningsMessage | null;
  readonly jobs: ReadonlyMap<string, JobMessage>;
  /** Last changeset applied to the session's scenario (version, edits count, fork). */
  readonly changeset: ChangesetMessage | null;
}

export const initialSessionState = (): SessionState => ({
  status: 'connecting',
  scenarioId: null,
  version: null,
  cells: new Map(),
  views: new Map(),
  warnings: null,
  jobs: new Map(),
  changeset: null,
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
  /** `seq` of the last `cancelPreview`: answers to older previews are void (0 before any). */
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
 * A `delta` / `view` / `warnings` with a `seq` below the last applied (or below the last
 * cancel) is ignored; `seq: null` (commit or job) always applies. Values of cells or views
 * nobody subscribes to are dropped.
 */
export function applyMessages(
  state: SessionState,
  messages: readonly ServerMessage[],
  ctx: ApplyContext,
): { state: SessionState; lastSeq: number } {
  const cells = cow(state.cells);
  const views = cow(state.views);
  const jobs = cow(state.jobs);
  let { scenarioId, version, warnings, changeset } = state;
  let lastSeq = ctx.lastSeq;

  const current = (seq: number | null) => {
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
        changeset = m;
        if (m.scenarioId === scenarioId) version = m.version;
        break;
    }
  }

  return {
    state: {
      ...state,
      scenarioId,
      version,
      warnings,
      changeset,
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
