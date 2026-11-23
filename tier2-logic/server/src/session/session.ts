import { WS_PROTOCOL_VERSION, parseClientMessage } from '@glidepath/api-contract';
import type {
  CellKey as WireCell,
  ClientMessage,
  MembershipRole,
  ServerMessage,
  TenantId,
  TenantSlug,
  UserId,
} from '@glidepath/api-contract';
import { EngineError } from '@glidepath/engine';
import type { CellKey as EngineCell, Change, Evaluation } from '@glidepath/engine';
import type { Logger } from '../app/logger';
import { toProblem } from '../app/problem';
import type { ProblemInit } from '../app/problem';
import { diffCells, engineCell, toEngineCell, wireValue } from './cells';
import type { WireValue } from './cells';
import type { ScenarioLoader, ScenarioState } from './loader';

/**
 * One what-if session: `Session(user, tenant, scenario)` of 03 §2, behind one `WS /ws/session` connection.
 *
 * It holds the scenario's compiled model (shared, from the ModelCache), the committed evaluation, the cells
 * the open screen subscribes to, the values last pushed for them, and, while previews are live, a scratch
 * evaluation. Nothing here reads or writes tier 3 except `open`, which asks the loader for another scenario.
 *
 * Frames are handled one at a time in arrival order; `open` (the only one that waits on IO) holds the frames
 * after it until the new scenario is in place.
 *
 * Previews (CON-02/CON-05 coalescing contract, `PREVIEW_MAX_PER_SECOND` in the contract):
 * - `seq` must increase across `preview` and `cancelPreview` (one counter per connection);
 * - a preview is validated whole (known variable, member key of the variable's dims) and queued; the queue
 *   runs once the frames already received have been handled (`schedule`, default `setImmediate`), so a burst
 *   becomes one rerun: queued previews apply in `seq` order (latest per cell wins, the cells of one preview
 *   together) with one `rerun` on the scratch copy, answered once by `delta{seq}` with the highest `seq`;
 * - a `delta` carries the subscribed cells whose value differs from the one last pushed to this client
 *   (snapshot or delta), so skipped intermediate values never show and unchanged cells are never sent;
 * - `cancelPreview{seq}` voids queued previews and the scratch and answers `delta{seq}` with the cells that
 *   go back to their committed value (empty when none);
 * - other frames first run queued previews, so answers leave in the order of the requests.
 * Rejected frames get `error{problem}` and change nothing.
 */

/** The cap on cells one session pushes: far above the input and node cells of a model, bounds a bad client. */
export const MAX_SUBSCRIBED_CELLS = 20_000;

export interface SessionMembership {
  readonly tenantId: TenantId;
  readonly slug: TenantSlug;
  readonly role: MembershipRole;
}

export interface SessionDeps {
  readonly userId: UserId;
  readonly tenant: SessionMembership;
  /** The scenario the connection opened on. */
  readonly state: ScenarioState;
  /** Loads the scenario of an `open`. */
  readonly loader: ScenarioLoader;
  /** Delivers one server message to the client. */
  readonly send: (message: ServerMessage) => void;
  /** Runs the preview queue after the frames already received; default `setImmediate`. */
  readonly schedule?: (run: () => void) => void;
  readonly logger?: Logger;
  readonly maxSubscribedCells?: number;
}

/** What a session did, for tests and benches. */
export interface SessionCounters {
  /** Previews accepted. */
  previews: number;
  /** Reruns run (each answers one `delta`). */
  reruns: number;
  cancels: number;
  rejected: number;
}

interface QueuedPreview {
  readonly seq: number;
  readonly cells: readonly (readonly [EngineCell, number])[];
}

type Of<T extends ClientMessage['type']> = Extract<ClientMessage, { type: T }>;

const V = WS_PROTOCOL_VERSION;

export class Session {
  readonly userId: UserId;
  readonly tenant: SessionMembership;
  readonly counters: SessionCounters = { previews: 0, reruns: 0, cancels: 0, rejected: 0 };

  private state: ScenarioState;
  private readonly loader: ScenarioLoader;
  private readonly out: (message: ServerMessage) => void;
  private readonly schedule: (run: () => void) => void;
  private readonly log: Logger | undefined;
  private readonly maxCells: number;

  /** Subscribed wire cell → its engine key. */
  private readonly subscribed = new Map<WireCell, EngineCell>();
  /** Value last pushed for each subscribed cell. */
  private readonly sent = new Map<WireCell, WireValue>();
  /**
   * The scratch copy: committed state + every cell previewed since the last cancel or open, and the highest
   * `seq` applied to it (what a rebase after a commit answers with, API-07).
   */
  private scratch: { readonly at: Evaluation; readonly seq: number } | null = null;
  private queue: QueuedPreview[] = [];
  private runQueued = false;
  private lastSeq = 0;

  private readonly inbox: unknown[] = [];
  private draining = false;
  private closed = false;

  constructor(deps: SessionDeps) {
    this.userId = deps.userId;
    this.tenant = deps.tenant;
    this.state = deps.state;
    this.loader = deps.loader;
    this.out = deps.send;
    this.schedule = deps.schedule ?? ((run) => void setImmediate(run));
    this.log = deps.logger;
    this.maxCells = deps.maxSubscribedCells ?? MAX_SUBSCRIBED_CELLS;
  }

  get scenarioId(): string {
    return this.state.scenarioId;
  }

  /** The scenario state: compiled model (from the ModelCache) and committed evaluation. */
  get scenario(): ScenarioState {
    return this.state;
  }

  /** What the client sees now: the scratch while previews are live, else the committed state. */
  get current(): Evaluation {
    return this.scratch?.at ?? this.state.committed;
  }

  /** One client frame (JSON text or decoded object), handled after the frames before it. */
  receive(frame: unknown): void {
    if (this.closed) return;
    this.inbox.push(frame);
    if (!this.draining) void this.drain();
  }

  /** The connection is gone: drop everything queued. */
  close(): void {
    this.closed = true;
    this.inbox.length = 0;
    this.queue = [];
    this.scratch = null;
  }

  private async drain(): Promise<void> {
    this.draining = true;
    try {
      while (this.inbox.length > 0 && !this.closed) {
        const frame = this.inbox.shift();
        try {
          const pending = this.handle(frame);
          if (pending) await pending;
        } catch (err) {
          this.failed(err);
        }
      }
    } finally {
      this.draining = false;
    }
  }

  private handle(frame: unknown): Promise<void> | void {
    const parsed = parseClientMessage(frame);
    if (!parsed.ok) return this.reject({ status: 400, title: 'Bad frame', detail: parsed.detail });
    const m = parsed.message;
    switch (m.type) {
      case 'preview':
        return this.preview(m);
      case 'cancelPreview':
        return this.cancel(m);
      case 'open':
        return this.open(m);
      case 'subscribe':
        this.runQueue();
        return this.subscribe(m.cells);
      case 'unsubscribe':
        this.runQueue();
        for (const c of m.cells) {
          this.subscribed.delete(c);
          this.sent.delete(c);
        }
        return;
      case 'subscribeView':
      case 'unsubscribeView':
        // ADR-021 views are served from API-12 on; until then a view subscription is refused.
        return this.reject({
          status: 501,
          title: 'Views not available',
          detail: `View '${m.view}' is not served yet. Subscribe to its cells instead.`,
        });
    }
  }

  private subscribe(cells: readonly WireCell[]): void {
    const fresh = new Set(cells.filter((c) => !this.subscribed.has(c)));
    if (this.subscribed.size + fresh.size > this.maxCells) {
      return this.reject({
        status: 422,
        title: 'Too many cells',
        detail: `A session pushes at most ${this.maxCells} cells. Unsubscribe the cells you no longer show.`,
      });
    }
    const at = this.current;
    const values: Record<string, WireValue> = {};
    for (const c of cells) {
      const engine = this.subscribed.get(c) ?? toEngineCell(c);
      this.subscribed.set(c, engine);
      const v = wireValue(at, engine);
      this.sent.set(c, v);
      values[c] = v;
    }
    this.send({ v: V, type: 'snapshot', scenarioId: this.state.scenarioId, version: this.state.version, cells: values });
  }

  private nextSeq(seq: number): boolean {
    if (seq > this.lastSeq) return true;
    this.reject({
      status: 400,
      title: 'Stale seq',
      detail: `seq ${seq} is not above ${this.lastSeq}. Use one increasing counter per connection.`,
    });
    return false;
  }

  /** Checks every cell of a preview (atomic: one bad cell rejects the frame); null when all are inputs. */
  private previewError(m: Of<'preview'>): string | null {
    const { variableDims, memberIds } = this.state.model;
    for (const c of m.changes) {
      const dims = variableDims.get(c.var);
      if (!dims) return `${c.var} is not an input variable of this model. Preview input variables only.`;
      const parts = c.member === '' ? [] : c.member.split(',');
      if (parts.length !== dims.length) {
        return `${c.var} takes a member key of ${dims.length} part(s) (${dims.join(', ') || 'scalar'}), not '${c.member}'.`;
      }
      for (let i = 0; i < parts.length; i++) {
        const dim = dims[i]!;
        if (!memberIds.get(dim)?.has(parts[i]!)) return `'${parts[i]}' is not a member of ${dim} (in ${c.var}[${c.member}]).`;
      }
    }
    return null;
  }

  private preview(m: Of<'preview'>): void {
    if (!this.nextSeq(m.seq)) return;
    const invalid = this.previewError(m);
    if (invalid) return this.reject({ status: 422, title: 'Invalid preview', detail: invalid });
    this.lastSeq = m.seq;
    this.counters.previews += 1;
    this.queue.push({ seq: m.seq, cells: m.changes.map((c) => [engineCell(c.var, c.member), c.value] as const) });
    if (this.runQueued) return;
    this.runQueued = true;
    this.schedule(() => {
      this.runQueued = false;
      try {
        this.runQueue();
      } catch (err) {
        this.failed(err);
      }
    });
  }

  /** Applies every queued preview in one rerun on the scratch copy and answers the highest `seq`. */
  private runQueue(): void {
    if (this.closed || this.queue.length === 0) return;
    const queued = this.queue;
    this.queue = [];
    const cells = new Map<EngineCell, number>();
    for (const p of queued) for (const [cell, value] of p.cells) cells.set(cell, value);
    const seq = queued[queued.length - 1]!.seq;
    const changes: Change[] = [];
    for (const [cell, value] of cells) changes.push({ target: 'variable', cell, value });

    let at: Evaluation;
    try {
      at = this.state.model.model.rerun(this.current, changes);
    } catch (err) {
      if (!(err instanceof EngineError)) throw err;
      return this.reject({
        status: 422,
        title: 'Preview not evaluated',
        detail: `The model cannot be evaluated with these values (${err.message}). Try other values.`,
      });
    }
    this.scratch = { at, seq };
    this.counters.reruns += 1;
    this.send({ v: V, type: 'delta', seq, cells: diffCells(at, this.subscribed, this.sent) });
  }

  private cancel(m: Of<'cancelPreview'>): void {
    if (!this.nextSeq(m.seq)) return;
    this.lastSeq = m.seq;
    this.counters.cancels += 1;
    this.queue = [];
    this.scratch = null;
    this.send({ v: V, type: 'delta', seq: m.seq, cells: diffCells(this.state.committed, this.subscribed, this.sent) });
  }

  /**
   * Switches to another scenario of the tenant: queued previews are void, the scratch is dropped, the
   * subscriptions stay and are answered with a `snapshot` of every subscribed cell. An unknown scenario is
   * an `error` and the session stays where it was.
   */
  private async open(m: Of<'open'>): Promise<void> {
    this.queue = [];
    let next: ScenarioState | null;
    try {
      next = await this.loader.load({ tenantId: this.tenant.tenantId, userId: this.userId }, m.scenarioId);
    } catch (err) {
      this.log?.error('session open failed', { err });
      return this.reject({ status: 500, title: 'Internal error', detail: 'The scenario could not be opened. Try again.' });
    }
    if (this.closed) return;
    if (!next) {
      return this.reject({
        status: 404,
        title: 'Unknown scenario',
        detail: `Scenario ${m.scenarioId} does not exist in this tenant. Pick one from the scenario bar.`,
      });
    }
    this.state = next;
    this.scratch = null;
    this.queue = [];
    this.sent.clear();
    const values: Record<string, WireValue> = {};
    for (const [wire, engine] of this.subscribed) {
      const v = wireValue(next.committed, engine);
      this.sent.set(wire, v);
      values[wire] = v;
    }
    this.send({ v: V, type: 'snapshot', scenarioId: next.scenarioId, version: next.version, cells: values });
  }

  /** A bug, not a bad frame: logged, and the client told without detail. */
  private failed(err: unknown): void {
    this.log?.error('session frame failed', { err });
    this.reject({ status: 500, title: 'Internal error', detail: 'The session could not handle this message. Try again.' });
  }

  private reject(init: ProblemInit): void {
    this.counters.rejected += 1;
    this.log?.debug('session frame rejected', { status: init.status, title: init.title });
    this.send({ v: V, type: 'error', problem: toProblem(init) });
  }

  private send(message: unknown): void {
    if (!this.closed) this.out(message as ServerMessage);
  }
}
