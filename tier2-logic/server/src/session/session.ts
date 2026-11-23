import { PREVIEW_MAX_PER_SECOND, WS_PROTOCOL_VERSION, parseClientMessage } from '@glidepath/api-contract';
import type {
  CellKey as WireCell,
  ClientMessage,
  MembershipRole,
  ScenarioId,
  ServerMessage,
  TenantId,
  TenantSlug,
  UserId,
  Violation,
} from '@glidepath/api-contract';
import { EngineError } from '@glidepath/engine';
import type { CellKey as EngineCell, Change, Evaluation } from '@glidepath/engine';
import type { Logger } from '../app/logger';
import { toProblem } from '../app/problem';
import type { ProblemInit } from '../app/problem';
import { diffCells, engineCell, toEngineCell, wireValue } from './cells';
import type { WireValue } from './cells';
import { systemClock } from './clock';
import type { Clock, Timer } from './clock';
import type { ScenarioLoader, ScenarioState } from './loader';
import type { CachedModel } from './model-cache';
import { SCALE_PRESET_KEY, computeView, viewKey } from './views';
import type { ViewSub } from './views';
import { previewViolations, sameViolations } from './warnings';

/**
 * One what-if session: `Session(user, tenant, scenario)` of 03 §2, behind one `WS /ws/session` connection.
 *
 * It holds the scenario's compiled model (shared, from the ModelCache), the committed evaluation, the cells
 * the open screen subscribes to, the values last pushed for them, and, while previews are live, a scratch
 * evaluation. Nothing here reads or writes tier 3 except `open`, which asks the loader for another scenario.
 *
 * Frames are handled one at a time in arrival order; `open` (the only one that waits on IO) holds the frames
 * after it until the new scenario is in place. Commits from the hub queue with the frames.
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
 *   go back to their committed value (empty when none), then `warnings{seq, []}` when warnings showed;
 * - other frames first run queued previews, so answers leave in the order of the requests;
 * - reruns are capped at `PREVIEW_MAX_PER_SECOND` per connection (a token bucket of that size): a faster
 *   client is never refused, its previews wait and coalesce into the next allowed rerun.
 * Rejected frames get `error{problem}` and change nothing.
 *
 * Lifecycle (API-07):
 * - warnings: after a rerun the scratch is checked with DOM `validatePreview` (deferred through `schedule`,
 *   skipped when a later preview superseded it) and `warnings{seq}` is pushed when the list differs from
 *   the one last pushed;
 * - commits (`applyCommit`, from the hub once a write committed): `changeset{…}`, then `delta{null}`, then,
 *   with a scratch, the rebase answered `delta{S}` and `warnings{S}` (S the scratch's seq);
 * Views (API-12, ADR-021): `subscribeView{view, params}` is answered by `view{seq: null}` with the payload of
 * what the client sees now; then `view{seq}` follows the `delta` of every rerun, `cancelPreview`, commit
 * (`seq: null`, then the rebase's `S`) and `open` (always, after the snapshot) whose payload differs from the
 * one last pushed. An unknown view or params fail the parser: `error{problem}`, the session stays open.
 * - `lastActivity`: when the client last sent a frame (the hub closes idle sessions).
 */

/** The cap on cells one session pushes: far above the input and node cells of a model, bounds a bad client. */
export const MAX_SUBSCRIBED_CELLS = 20_000;

/** The cap on views one session pushes: the contract has seven names, so this only bounds param variants. */
export const MAX_SUBSCRIBED_VIEWS = 64;

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
  /** Time for the rerun cap and `lastActivity`; default the system clock. */
  readonly clock?: Clock;
  /** Reruns per second (token bucket); default the contract's `PREVIEW_MAX_PER_SECOND`. */
  readonly maxRerunsPerSecond?: number;
}

/** The WS `changeset` message. */
export type ChangesetMessage = Extract<ServerMessage, { type: 'changeset' }>;

/** A committed write, as the hub hands it to each session it concerns. */
export interface CommitUpdate {
  /**
   * The scenario the session must be on for this to apply: the committed one, or the locked preset the
   * commit forked (the author's sessions follow the fork). A session that moved on meanwhile ignores it.
   */
  readonly on: string;
  /** The committed scenario read from tier 3 after the commit; null when it could not be read. */
  readonly state: ScenarioState | null;
  readonly message: ChangesetMessage;
}

/** What a session did, for tests and benches. */
export interface SessionCounters {
  /** Previews accepted. */
  previews: number;
  /** Reruns run (each answers one `delta`). */
  reruns: number;
  cancels: number;
  rejected: number;
  /** Commits adopted (each answered by a `delta{null}`). */
  commits: number;
  /** Scratch copies re-applied on a new committed state. */
  rebases: number;
  /** `warnings` messages pushed. */
  warnings: number;
  /** `view` messages pushed. */
  views: number;
}

interface QueuedPreview {
  readonly seq: number;
  readonly cells: readonly (readonly [EngineCell, number])[];
}

type Of<T extends ClientMessage['type']> = Extract<ClientMessage, { type: T }>;

type InboxItem =
  | { readonly frame: unknown }
  | { readonly task: () => void | Promise<void>; readonly done: () => void };

/** The scratch copy: committed state + every cell previewed since the last cancel or open. */
interface Scratch {
  readonly at: Evaluation;
  /** Highest `seq` applied to it (what a rebase after a commit answers with). */
  readonly seq: number;
  /** The previewed cells, latest value each: what a rebase re-applies. */
  readonly cells: ReadonlyMap<EngineCell, number>;
}

const variableChanges = (cells: ReadonlyMap<EngineCell, number>): Change[] =>
  [...cells].map(([cell, value]) => ({ target: 'variable', cell, value }));

const V = WS_PROTOCOL_VERSION;

export class Session {
  readonly userId: UserId;
  readonly tenant: SessionMembership;
  readonly counters: SessionCounters = {
    previews: 0,
    reruns: 0,
    cancels: 0,
    rejected: 0,
    commits: 0,
    rebases: 0,
    warnings: 0,
    views: 0,
  };

  private state: ScenarioState;
  private readonly loader: ScenarioLoader;
  private readonly out: (message: ServerMessage) => void;
  private readonly schedule: (run: () => void) => void;
  private readonly log: Logger | undefined;
  private readonly maxCells: number;
  private readonly clock: Clock;
  private readonly rate: number;

  /** Subscribed wire cell → its engine key. */
  private readonly subscribed = new Map<WireCell, EngineCell>();
  /** Value last pushed for each subscribed cell. */
  private readonly sent = new Map<WireCell, WireValue>();
  /** Subscribed views by `viewKey`. */
  private readonly views = new Map<string, ViewSub>();
  /** Evaluation of the scale preset per compiled model (`levers.scale`); the preset is locked. */
  private readonly scaleEvals = new WeakMap<CachedModel, Evaluation>();
  private scratch: Scratch | null = null;
  private queue: QueuedPreview[] = [];
  private runQueued = false;
  private runTimer: Timer | null = null;
  private lastSeq = 0;
  /** Rerun tokens left and when they were last counted (token bucket of `rate`). */
  private tokens: number;
  private tokensAt: number;
  /** Warnings last pushed (empty: none show). */
  private warned: readonly Violation[] = [];
  private warnQueued = false;
  private active: number;

  private readonly inbox: InboxItem[] = [];
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
    this.clock = deps.clock ?? systemClock;
    this.rate = Math.max(1, deps.maxRerunsPerSecond ?? PREVIEW_MAX_PER_SECOND);
    this.tokens = this.rate;
    this.tokensAt = this.active = this.clock.now();
  }

  get scenarioId(): ScenarioId {
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

  /** When the client last sent a frame (clock time); the hub closes sessions idle for too long. */
  get lastActivity(): number {
    return this.active;
  }

  /** Warnings last pushed to the client (empty when none show). */
  get warnings(): readonly Violation[] {
    return this.warned;
  }

  get isClosed(): boolean {
    return this.closed;
  }

  /** One client frame (JSON text or decoded object), handled after the frames before it. */
  receive(frame: unknown): void {
    if (this.closed) return;
    this.active = this.clock.now();
    this.inbox.push({ frame });
    if (!this.draining) void this.drain();
  }

  /**
   * A write committed on this session's scenario (or forked the preset it is on): queued behind the frames
   * already received, then `changeset`, `delta{null}` and the rebase. Resolves once handled (or dropped).
   */
  applyCommit(update: CommitUpdate): Promise<void> {
    if (this.closed) return Promise.resolve();
    return new Promise<void>((done) => {
      this.inbox.push({ task: () => this.adopt(update), done });
      if (!this.draining) void this.drain();
    });
  }

  /** The connection is gone: drop everything queued. */
  close(): void {
    this.closed = true;
    for (const item of this.inbox.splice(0)) if ('task' in item) item.done();
    this.queue = [];
    this.scratch = null;
    this.runTimer?.cancel();
    this.runTimer = null;
  }

  private async drain(): Promise<void> {
    this.draining = true;
    try {
      while (this.inbox.length > 0 && !this.closed) {
        const item = this.inbox.shift()!;
        if ('task' in item) {
          try {
            await item.task();
          } catch (err) {
            this.log?.error('session commit update failed', { err });
          } finally {
            item.done();
          }
          continue;
        }
        try {
          const pending = this.handle(item.frame);
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
        this.runQueue();
        return this.subscribeView(m.view, m.params);
      case 'unsubscribeView':
        this.runQueue();
        this.views.delete(viewKey(m.view, m.params));
        return;
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

  /** `levers.scale` reads preset D: its evaluation, loaded once per compiled model; null when it is missing. */
  private async scaleEval(state: ScenarioState): Promise<Evaluation | null> {
    const cached = this.scaleEvals.get(state.model);
    if (cached) return cached;
    const scope = { tenantId: this.tenant.tenantId, userId: this.userId };
    const preset = await (this.loader.loadPreset?.(scope, SCALE_PRESET_KEY) ?? this.loader.load(scope, SCALE_PRESET_KEY));
    if (!preset) return null;
    this.scaleEvals.set(state.model, preset.committed);
    return preset.committed;
  }

  /** Loads the scale preset for `state` when a `levers.scale` view is subscribed (or `extra` is it). */
  private async needScale(state: ScenarioState, extra?: string): Promise<Evaluation | null> {
    const wanted = extra === 'levers.scale' || [...this.views.values()].some((s) => s.view === 'levers.scale');
    return wanted ? this.scaleEval(state) : null;
  }

  private async subscribeView(view: ViewSub['view'], params: Record<string, unknown>): Promise<void> {
    const key = viewKey(view, params);
    if (!this.views.has(key) && this.views.size >= MAX_SUBSCRIBED_VIEWS) {
      return this.reject({
        status: 422,
        title: 'Too many views',
        detail: `A session pushes at most ${MAX_SUBSCRIBED_VIEWS} views. Unsubscribe the views you no longer show.`,
      });
    }
    const state = this.state;
    const scale = await this.needScale(state, view);
    if (this.closed || this.state !== state) return; // moved on; `open` answers every subscribed view
    if (view === 'levers.scale' && !scale) {
      return this.reject({
        status: 404,
        title: 'Unknown scale preset',
        detail: `Preset ${SCALE_PRESET_KEY} is not one of this tenant's scenarios, so levers.scale has nothing to scale to.`,
      });
    }
    const sub: ViewSub = this.views.get(key) ?? { view, params, sent: null };
    const text = computeView(sub, this.current, state.model.members, scale);
    this.views.set(key, sub);
    this.pushView(sub, null, text, true);
  }

  private pushView(sub: ViewSub, seq: number | null, text: string, always = false): void {
    if (!always && sub.sent === text) return;
    sub.sent = text;
    this.counters.views += 1;
    this.send({ v: V, type: 'view', view: sub.view, params: sub.params, seq, payload: JSON.parse(text) });
  }

  /** The payload text of `sub` on `at`, a state of `state`'s model. */
  private viewText(sub: ViewSub, at: Evaluation, state: ScenarioState): string {
    const scale = sub.view === 'levers.scale' ? (this.scaleEvals.get(state.model) ?? null) : null;
    return computeView(sub, at, state.model.members, scale);
  }

  /** `view{seq}` for each subscribed view whose payload on `at` differs from the one last pushed. */
  private pushViews(at: Evaluation, seq: number | null): void {
    for (const sub of this.views.values()) this.pushView(sub, seq, this.viewText(sub, at, this.state));
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
    const fire = () => {
      this.runTimer = null;
      this.runQueued = false;
      try {
        this.runQueue();
      } catch (err) {
        this.failed(err);
      }
    };
    const wait = this.rerunWait();
    if (wait <= 0) this.schedule(fire);
    else this.runTimer = this.clock.after(wait, () => this.schedule(fire));
  }

  /** Refills the rerun bucket; the ms until a rerun token is available (0: now). */
  private rerunWait(): number {
    const now = this.clock.now();
    this.tokens = Math.min(this.rate, this.tokens + ((now - this.tokensAt) * this.rate) / 1000);
    this.tokensAt = now;
    return this.tokens >= 1 ? 0 : ((1 - this.tokens) * 1000) / this.rate;
  }

  /** Applies every queued preview in one rerun on the scratch copy and answers the highest `seq`. */
  private runQueue(): void {
    if (this.closed || this.queue.length === 0) return;
    const queued = this.queue;
    this.queue = [];
    const cells = new Map<EngineCell, number>();
    for (const p of queued) for (const [cell, value] of p.cells) cells.set(cell, value);
    const seq = queued[queued.length - 1]!.seq;
    this.rerunWait();
    this.tokens -= 1;

    let at: Evaluation;
    try {
      at = this.state.model.model.rerun(this.current, variableChanges(cells));
    } catch (err) {
      if (!(err instanceof EngineError)) throw err;
      return this.reject({
        status: 422,
        title: 'Preview not evaluated',
        detail: `The model cannot be evaluated with these values (${err.message}). Try other values.`,
      });
    }
    const scratchCells = new Map(this.scratch?.cells ?? []);
    for (const [cell, value] of cells) scratchCells.set(cell, value);
    this.scratch = { at, seq, cells: scratchCells };
    this.counters.reruns += 1;
    this.send({ v: V, type: 'delta', seq, cells: diffCells(at, this.subscribed, this.sent) });
    this.pushViews(at, seq);
    this.queueWarnings();
  }

  /**
   * Checks the scratch with DOM `validatePreview` once the frames already received are handled: it costs a
   * few reruns, so it never delays a `delta`, and a scratch that a queued preview supersedes is not checked.
   */
  private queueWarnings(): void {
    if (this.warnQueued) return;
    this.warnQueued = true;
    this.schedule(() => {
      this.warnQueued = false;
      try {
        this.checkWarnings();
      } catch (err) {
        this.log?.error('session preview warnings failed', { err });
      }
    });
  }

  private checkWarnings(): void {
    const scratch = this.scratch;
    if (this.closed || !scratch || this.queue.length > 0) return; // the queued rerun checks again
    this.pushWarnings(scratch.seq, previewViolations(this.state.model, scratch.at));
  }

  /** `warnings{seq}` when `violations` differ from what the client shows. */
  private pushWarnings(seq: number | null, violations: readonly Violation[]): void {
    if (sameViolations(violations, this.warned)) return;
    this.warned = violations;
    this.counters.warnings += 1;
    this.send({ v: V, type: 'warnings', seq, violations });
  }

  private cancel(m: Of<'cancelPreview'>): void {
    if (!this.nextSeq(m.seq)) return;
    this.lastSeq = m.seq;
    this.counters.cancels += 1;
    this.queue = [];
    this.scratch = null;
    this.send({ v: V, type: 'delta', seq: m.seq, cells: diffCells(this.state.committed, this.subscribed, this.sent) });
    this.pushViews(this.state.committed, m.seq);
    this.pushWarnings(m.seq, []);
  }

  /**
   * A commit on the session's scenario (CON-02 `SessionStep` 3 and 4): `changeset`, then `delta{null}` with
   * the subscribed cells whose committed value changed (without a scratch also any cell the client shows
   * otherwise), then the rebase of a scratch: its cells re-applied on the new committed state in one rerun,
   * answered `delta{S}` with the cells where scratch and committed differ or the client shows another value,
   * and `warnings{S}` as for a preview. A rebase the engine cannot evaluate drops the scratch (the client
   * then shows the committed values). A state not newer than the session's (racing notices) only sends the
   * `changeset`.
   */
  private async adopt(update: CommitUpdate): Promise<void> {
    if (this.closed || this.state.scenarioId !== update.on) return; // moved on (open) meanwhile
    this.runQueue();
    this.send(update.message);
    const next = update.state;
    if (!next || (next.scenarioId === this.state.scenarioId && next.version <= this.state.version)) return;

    if (next.model !== this.state.model && this.views.size > 0) {
      try {
        await this.needScale(next);
      } catch (err) {
        this.log?.error('session scale preset not loaded', { err });
      }
      if (this.closed || this.state.scenarioId !== update.on) return;
    }
    const before = this.state.committed;
    const now = next.committed;
    const prev = this.state;
    this.state = next;
    this.counters.commits += 1;
    const scratch = this.scratch;
    const committed: Record<string, WireValue> = {};
    for (const [wire, engine] of this.subscribed) {
      const v = wireValue(now, engine);
      if (wireValue(before, engine) !== v || (!scratch && this.sent.get(wire) !== v)) {
        committed[wire] = v;
        this.sent.set(wire, v);
      }
    }
    this.send({ v: V, type: 'delta', seq: null, cells: committed });
    const nowViews = new Map<ViewSub, string>();
    for (const sub of this.views.values()) {
      const text = this.viewText(sub, now, next);
      nowViews.set(sub, text);
      const changed = scratch ? this.viewText(sub, before, prev) !== text : sub.sent !== text;
      if (changed) this.pushView(sub, null, text, true);
    }
    if (!scratch) return;

    let at: Evaluation | null = null;
    try {
      at = next.model.model.rerun(now, variableChanges(scratch.cells));
    } catch (err) {
      if (!(err instanceof EngineError)) throw err;
      this.log?.warn('session rebase not evaluated, scratch dropped', { err });
    }
    this.counters.rebases += 1;
    this.scratch = at ? { at, seq: scratch.seq, cells: scratch.cells } : null;
    const shown = at ?? now;
    const rebased: Record<string, WireValue> = {};
    for (const [wire, engine] of this.subscribed) {
      const v = wireValue(shown, engine);
      if ((at && v !== wireValue(now, engine)) || this.sent.get(wire) !== v) {
        rebased[wire] = v;
        this.sent.set(wire, v);
      }
    }
    this.send({ v: V, type: 'delta', seq: scratch.seq, cells: rebased });
    for (const sub of this.views.values()) {
      const text = this.viewText(sub, shown, next);
      if ((at && text !== nowViews.get(sub)) || sub.sent !== text) this.pushView(sub, scratch.seq, text, true);
    }
    if (at) this.queueWarnings();
    else this.pushWarnings(scratch.seq, []);
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
    this.warned = []; // the client drops the old scenario's warnings with this snapshot
    this.sent.clear();
    const values: Record<string, WireValue> = {};
    for (const [wire, engine] of this.subscribed) {
      const v = wireValue(next.committed, engine);
      this.sent.set(wire, v);
      values[wire] = v;
    }
    this.send({ v: V, type: 'snapshot', scenarioId: next.scenarioId, version: next.version, cells: values });
    if (this.views.size === 0) return;
    try {
      await this.needScale(next);
    } catch (err) {
      this.log?.error('session scale preset not loaded', { err });
    }
    if (this.closed || this.state !== next) return;
    for (const sub of this.views.values()) this.pushView(sub, null, this.viewText(sub, next.committed, next), true);
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
