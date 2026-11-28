/**
 * SRC-10 · F8 vendor consolidation optimizer: move tail spend to preferred vendors that already serve the same
 * pool, under a concentration cap, a minimum vendor count and a maximum number of moves. Pure, deterministic,
 * no IO; every number comes from the spend cube and the `sourcing_param` members (keys in `CONSOLIDATION_PARAMS`).
 *
 * Model
 * - A *source* is a named (non-aggregate), non-preferred vendor; a *sink* is a named, preferred vendor. Aggregate
 *   buckets ('Various') are neither: they keep their spend, count in the pool and third-party totals (shares stay
 *   over the whole third-party spend, as in the spend cube) and are left out of the vendor counts and the HHI.
 * - A move (source, sink, pool) is allowed only in an eligible pool (`eligiblePools`: the tenant's
 *   `consolidation_scope` members, the services pools where a preferred provider can genuinely absorb tail work;
 *   licences, cloud, hardware and telecom are not) and only where the sink already serves the pool (it has spend
 *   there in the cube). It moves as much as it can: all of the source's spend in that pool, or less when the sink reaches the
 *   cap. A move that would empty the source in the pool, and so drop a vendor count below the minimum, is refused;
 *   a cap-limited partial move leaves the source in the pool and is allowed.
 * - Constraints, both readings enforced (the brief speaks of third-party share and the vendor count; the seed's
 *   labels speak of a pool): after every move no sink's share of its pool, nor of the third-party total, exceeds
 *   `concentration_cap_pct`; neither a pool's named-vendor count nor the overall one falls below `min_vendor_count`
 *   (a count already below it may not fall further); at most `max_moves` moves.
 * - Benefit of a move of x $M: annual saving x * rate_discount_pct; one-time cost x * transition_cost_pct, paid at
 *   the start; net benefit = NPV over `horizon_years` at `discount_rate` (savings at each year end:
 *   saving * annuity factor - one-time), or the undiscounted saving * horizon - one-time when the tenant holds no
 *   discount rate. Payback months = one-time / (annual saving / 12).
 *
 * Algorithm: greedy by net benefit (ties: larger move, then source, sink, pool in input order); a repair step
 * (ban each chosen move in turn and re-run the greedy, keep any improvement, until none); then a depth-first
 * branch and bound over move sequences seeded with that incumbent, under a count-based node budget. When the
 * search finishes inside the budget the answer is optimal over move sequences (`exact: true`).
 */

/** The `sourcing_param` keys the optimizer reads (tier3-data/seed/aa/sourcing.json). */
export const CONSOLIDATION_PARAMS = {
  rateDiscount: 'rate_discount_pct',
  transitionCost: 'transition_cost_pct',
  concentrationCap: 'concentration_cap_pct',
  minVendorCount: 'min_vendor_count',
  maxMoves: 'max_moves',
  horizonYears: 'horizon_years',
  /** Optional: absent = undiscounted horizon sum. */
  discountRate: 'discount_rate',
} as const;

/** Parameters that are counts: an override must be a whole number. */
const COUNT_PARAMS: ReadonlySet<string> = new Set([CONSOLIDATION_PARAMS.minVendorCount, CONSOLIDATION_PARAMS.maxMoves]);
const REQUIRED_PARAMS = [
  CONSOLIDATION_PARAMS.rateDiscount,
  CONSOLIDATION_PARAMS.transitionCost,
  CONSOLIDATION_PARAMS.concentrationCap,
  CONSOLIDATION_PARAMS.minVendorCount,
  CONSOLIDATION_PARAMS.maxMoves,
  CONSOLIDATION_PARAMS.horizonYears,
] as const;
/** Order the binding constraints are reported in. */
const BINDING_ORDER = [
  CONSOLIDATION_PARAMS.maxMoves,
  CONSOLIDATION_PARAMS.concentrationCap,
  CONSOLIDATION_PARAMS.minVendorCount,
  CONSOLIDATION_PARAMS.transitionCost,
] as const;

/** Unit conversion: months in a year (payback is reported in months). */
const MONTHS_PER_YEAR = 12;
/** HHI is on the 0..10 000 scale: shares in percent, squared. */
const PERCENT = 100;
/** $M below which an amount counts as zero (float residue of the arithmetic, far below any real spend). */
export const SPEND_EPS = 1e-9;
/** Memo key of the exact search: FNV-1a and murmur multipliers, decimals kept, radix of the printed hash. */
const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
const MURMUR_M = 0x5bd1e995;
const CELL_SEPARATOR = 0x2c;
const KEY_DECIMALS = 9;
const KEY_RADIX = 36;
/** Default node budget of the exact search (count-based, so the answer is deterministic). */
export const DEFAULT_NODE_LIMIT = 20_000;

/** One `sourcing_param` member as the optimizer reads it (structurally the domain's `SourcingParamRow`). */
export interface ConsolidationParamRow {
  readonly key: string;
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
}

/** One spend cube row with its spend split by pool, $M. */
export interface ConsolidationVendor {
  readonly vendor: string;
  readonly vendorKey: string | null;
  readonly preferred: boolean;
  readonly aggregate: boolean;
  readonly spendByPool: Readonly<Record<string, number>>;
}

export interface ConsolidationInput {
  readonly vendors: readonly ConsolidationVendor[];
  /** Pools whose spend may move (the `pool` of each `consolidation_scope` member); none = no moves. */
  readonly eligiblePools: readonly string[];
  /** The parameters of the run (members merged with overrides, see `resolveConsolidationParams`). */
  readonly params: readonly ConsolidationParamRow[];
  /** Node budget of the exact search; 0 = greedy and repair only. */
  readonly nodeLimit?: number;
}

export interface ConsolidationMoveResult {
  readonly from: string;
  readonly fromKey: string | null;
  readonly to: string;
  readonly toKey: string | null;
  /** Pool the spend moves in (the contract's move has no pool field yet; extra keys are stripped by its parse). */
  readonly pool: string;
  readonly spendMoved: number;
  readonly annualSaving: number;
  readonly oneTimeCost: number;
  readonly paybackMonths: number | null;
  /** Net benefit over the horizon (NPV, see the module comment). */
  readonly netBenefit: number;
}

export interface ConsolidationBindingResult {
  readonly param: string;
  readonly label: string;
  readonly value: number;
}

export interface ConsolidationOutcome {
  /** Ranked by net benefit, descending. */
  readonly moves: readonly ConsolidationMoveResult[];
  readonly totals: {
    readonly spendMoved: number;
    readonly annualSaving: number;
    readonly oneTimeCost: number;
    readonly paybackMonths: number | null;
    readonly vendorsBefore: number;
    readonly vendorsAfter: number;
  };
  readonly hhiBefore: number;
  readonly hhiAfter: number;
  readonly topVendorShareAfter: number;
  readonly binding: readonly ConsolidationBindingResult[];
  /** The values the run used, by parameter key. */
  readonly params: Readonly<Record<string, number>>;
  /** Net benefit of the whole plan over the horizon. */
  readonly netBenefit: number;
  /** True when the exact search finished inside its node budget (the plan is optimal). */
  readonly exact: boolean;
  readonly nodes: number;
}

/** A parameter is missing, unknown or out of range: the run cannot start. `violations` names each one. */
export class ConsolidationParamError extends Error {
  constructor(readonly violations: readonly string[]) {
    super(violations.join('; '));
    this.name = 'ConsolidationParamError';
  }
}

// ---------------------------------------------------------------------------------------------- parameters

/**
 * The members merged with a run's overrides (keyed by `sourcing_param` key). An override of a key the tenant
 * does not hold, a non-finite value, one outside the member's [min, max], or a fractional count is refused with
 * a `ConsolidationParamError` naming every offender. Nothing is written: the overrides hold for this run only.
 */
export function resolveConsolidationParams(
  rows: readonly ConsolidationParamRow[],
  overrides: Readonly<Record<string, number>> = {},
): ConsolidationParamRow[] {
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const violations: string[] = [];
  for (const [key, value] of Object.entries(overrides)) {
    const row = byKey.get(key);
    if (!row) violations.push(`${key} is not a sourcing parameter of this tenant`);
    else if (!Number.isFinite(value) || value < row.min || value > row.max)
      violations.push(`${key} = ${value} is outside [${row.min}, ${row.max}]`);
    else if (COUNT_PARAMS.has(key) && !Number.isInteger(value)) violations.push(`${key} = ${value} must be a whole number`);
  }
  if (violations.length > 0) throw new ConsolidationParamError(violations);
  return rows.map((r) => (Object.prototype.hasOwnProperty.call(overrides, r.key) ? { ...r, value: overrides[r.key] as number } : r));
}

interface Params {
  rate: number;
  transition: number;
  cap: number;
  minCount: number;
  maxMoves: number;
  horizon: number;
  discount: number | undefined;
  /** Net benefit of one $M moved over the horizon. */
  perDollar: number;
  rows: Map<string, ConsolidationParamRow>;
}

function readParams(rows: readonly ConsolidationParamRow[]): Params {
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const missing = REQUIRED_PARAMS.filter((k) => !byKey.has(k));
  if (missing.length > 0) throw new ConsolidationParamError(missing.map((k) => `sourcing_param ${k} is missing: add it to the tenant's parameters`));
  const v = (k: string): number => byKey.get(k)!.value;
  const bad = [...REQUIRED_PARAMS].filter((k) => !Number.isFinite(v(k)) || (COUNT_PARAMS.has(k) && !Number.isInteger(v(k))));
  if (bad.length > 0) throw new ConsolidationParamError(bad.map((k) => `sourcing_param ${k} = ${v(k)} is not usable`));
  const rate = v(CONSOLIDATION_PARAMS.rateDiscount);
  const transition = v(CONSOLIDATION_PARAMS.transitionCost);
  const horizon = v(CONSOLIDATION_PARAMS.horizonYears);
  const discount = byKey.get(CONSOLIDATION_PARAMS.discountRate)?.value;
  return {
    rate,
    transition,
    cap: v(CONSOLIDATION_PARAMS.concentrationCap),
    minCount: v(CONSOLIDATION_PARAMS.minVendorCount),
    maxMoves: Math.max(0, v(CONSOLIDATION_PARAMS.maxMoves)),
    horizon,
    discount,
    perDollar: rate * annuityFactor(horizon, discount) - transition,
    rows: byKey,
  };
}

/** Present value of 1 a year for `years` years at `rate` (year-end payments); `years` when undiscounted. */
export function annuityFactor(years: number, rate: number | undefined): number {
  if (rate === undefined || rate === 0) return years;
  return (1 - (1 + rate) ** -years) / rate;
}

/** Months for an annual saving to repay a one-time cost: 0 when there is no cost, null when never. */
export function paybackMonths(oneTime: number, annualSaving: number): number | null {
  if (oneTime <= SPEND_EPS) return 0;
  if (annualSaving <= SPEND_EPS) return null;
  return (oneTime / annualSaving) * MONTHS_PER_YEAR;
}

// ---------------------------------------------------------------------------------------------- the problem

/** A candidate move: source index, sink index, pool index. */
interface Candidate {
  readonly s: number;
  readonly k: number;
  readonly p: number;
}

/** Why a candidate moves nothing in a state. */
type Block = 'cap' | 'count' | 'exhausted' | null;

interface Problem {
  readonly vendors: readonly ConsolidationVendor[];
  readonly pools: readonly string[];
  readonly poolTotal: readonly number[];
  readonly total: number;
  readonly named: readonly boolean[];
  readonly candidates: readonly Candidate[];
  readonly params: Params;
}

/** Mutable state: spend[v][p], vendor totals, named-vendor counts per pool and overall. */
interface State {
  spend: number[][];
  vendorTotal: number[];
  poolCount: number[];
  count: number;
  moves: number;
}

function buildProblem(input: ConsolidationInput): { problem: Problem; state: State } {
  const params = readParams(input.params);
  const vendors = input.vendors;
  const poolIndex = new Map<string, number>();
  for (const v of vendors) for (const p of Object.keys(v.spendByPool)) if (!poolIndex.has(p)) poolIndex.set(p, poolIndex.size);
  const pools = [...poolIndex.keys()];
  const spend = vendors.map((v) => pools.map((p) => Math.max(0, v.spendByPool[p] ?? 0)));
  const poolTotal = pools.map((_, p) => spend.reduce((s, row) => s + row[p]!, 0));
  const total = poolTotal.reduce((a, b) => a + b, 0);
  const named = vendors.map((v) => !v.aggregate);
  const vendorTotal = spend.map((row) => row.reduce((a, b) => a + b, 0));
  const poolCount = pools.map((_, p) => spend.filter((row, i) => named[i] && row[p]! > SPEND_EPS).length);
  const count = vendorTotal.filter((t, i) => named[i] && t > SPEND_EPS).length;

  const sources = vendors.flatMap((v, i) => (named[i] && !v.preferred ? [i] : []));
  const sinks = vendors.flatMap((v, i) => (named[i] && v.preferred ? [i] : []));
  const eligible = new Set(input.eligiblePools);
  const candidates: Candidate[] = [];
  for (const s of sources)
    for (const k of sinks)
      for (let p = 0; p < pools.length; p++)
        if (eligible.has(pools[p]!) && spend[s]![p]! > SPEND_EPS && spend[k]![p]! > SPEND_EPS) candidates.push({ s, k, p });

  return {
    problem: { vendors, pools, poolTotal, total, named, candidates, params },
    state: { spend, vendorTotal, poolCount, count, moves: 0 },
  };
}

/** The cap-limited amount of a candidate, ignoring the vendor counts (non-increasing as moves are applied). */
function optimistic(pr: Problem, st: State, c: Candidate): number {
  const rem = st.spend[c.s]![c.p]!;
  const poolRoom = pr.params.cap * pr.poolTotal[c.p]! - st.spend[c.k]![c.p]!;
  const globalRoom = pr.params.cap * pr.total - st.vendorTotal[c.k]!;
  return Math.max(0, Math.min(rem, poolRoom, globalRoom));
}

/** What a candidate moves in this state (0 when blocked) and why it is blocked. */
function evaluate(pr: Problem, st: State, c: Candidate): { x: number; exit: boolean; block: Block } {
  const rem = st.spend[c.s]![c.p]!;
  if (rem <= SPEND_EPS) return { x: 0, exit: false, block: 'exhausted' };
  const x = optimistic(pr, st, c);
  if (x <= SPEND_EPS) return { x: 0, exit: false, block: 'cap' };
  if (x < rem - SPEND_EPS) return { x, exit: false, block: null };
  // Full exit from the pool: the pool loses a vendor, and the market does when it was the source's last pool.
  const leavesMarket = st.vendorTotal[c.s]! - rem <= SPEND_EPS;
  const min = pr.params.minCount;
  if (st.poolCount[c.p]! - 1 < min || (leavesMarket && st.count - 1 < min)) return { x: 0, exit: true, block: 'count' };
  return { x: rem, exit: true, block: null };
}

interface Applied {
  readonly c: Candidate;
  readonly x: number;
  readonly exit: boolean;
  readonly leftMarket: boolean;
  /** True when the cap, not the source's spend, sized the move. */
  readonly capped: boolean;
}

function apply(st: State, c: Candidate, x: number, exit: boolean): Applied {
  const rowS = st.spend[c.s]!;
  const rowK = st.spend[c.k]!;
  rowS[c.p] = exit ? 0 : rowS[c.p]! - x;
  rowK[c.p] = rowK[c.p]! + x;
  st.vendorTotal[c.s] = st.vendorTotal[c.s]! - x;
  st.vendorTotal[c.k] = st.vendorTotal[c.k]! + x;
  let leftMarket = false;
  if (exit) {
    st.poolCount[c.p] = st.poolCount[c.p]! - 1;
    if (st.vendorTotal[c.s]! <= SPEND_EPS) {
      st.vendorTotal[c.s] = 0;
      st.count -= 1;
      leftMarket = true;
    }
  }
  st.moves += 1;
  return { c, x, exit, leftMarket, capped: !exit };
}

function undo(st: State, a: Applied): void {
  const { c, x } = a;
  const rowS = st.spend[c.s]!;
  const rowK = st.spend[c.k]!;
  rowS[c.p] = rowS[c.p]! + x;
  rowK[c.p] = rowK[c.p]! - x;
  st.vendorTotal[c.s] = st.vendorTotal[c.s]! + x;
  st.vendorTotal[c.k] = st.vendorTotal[c.k]! - x;
  if (a.exit) st.poolCount[c.p] = st.poolCount[c.p]! + 1;
  if (a.leftMarket) st.count += 1;
  st.moves -= 1;
}

/** Feasible moves of a state, best first (larger move, then candidate order). */
function feasible(pr: Problem, st: State, banned: ReadonlySet<number> = new Set()): { i: number; x: number; exit: boolean }[] {
  const out: { i: number; x: number; exit: boolean }[] = [];
  pr.candidates.forEach((c, i) => {
    if (banned.has(i)) return;
    const e = evaluate(pr, st, c);
    if (e.block === null) out.push({ i, x: e.x, exit: e.exit });
  });
  return out.sort((a, b) => b.x - a.x || a.i - b.i);
}

/** A plan: the candidate indices in the order they are applied. */
type Plan = readonly number[];

function cloneState(st: State): State {
  return { spend: st.spend.map((r) => [...r]), vendorTotal: [...st.vendorTotal], poolCount: [...st.poolCount], count: st.count, moves: st.moves };
}

/** Replays a plan on a copy of the start state; returns the moved amounts. */
function replay(pr: Problem, start: State, plan: Plan): { st: State; applied: Applied[] } {
  const st = cloneState(start);
  const applied: Applied[] = [];
  for (const i of plan) {
    const c = pr.candidates[i]!;
    const e = evaluate(pr, st, c);
    if (e.block !== null) break;
    applied.push(apply(st, c, e.x, e.exit));
  }
  return { st, applied };
}

const moved = (applied: readonly Applied[]): number => applied.reduce((s, a) => s + a.x, 0);

function greedy(pr: Problem, start: State, banned: ReadonlySet<number>): Plan {
  const st = cloneState(start);
  const plan: number[] = [];
  while (st.moves < pr.params.maxMoves) {
    const best = feasible(pr, st, banned)[0];
    if (!best) break;
    apply(st, pr.candidates[best.i]!, best.x, best.exit);
    plan.push(best.i);
  }
  return plan;
}

/** Repair: ban each move of the plan in turn and re-run the greedy; keep the best, until nothing improves. */
function repair(pr: Problem, start: State, plan: Plan): Plan {
  let best = plan;
  let bestValue = moved(replay(pr, start, best).applied);
  const banned = new Set<number>();
  for (let improved = true; improved; ) {
    improved = false;
    for (const i of best) {
      if (banned.has(i)) continue;
      const trial = greedy(pr, start, new Set([...banned, i]));
      const value = moved(replay(pr, start, trial).applied);
      if (value > bestValue + SPEND_EPS) {
        banned.add(i);
        best = trial;
        bestValue = value;
        improved = true;
        break;
      }
    }
  }
  return best;
}

/** Upper bound on the spend the remaining moves can still shift (counts ignored; amounts never grow). */
function bound(pr: Problem, st: State): number {
  const left = pr.params.maxMoves - st.moves;
  if (left <= 0) return 0;
  const amounts = pr.candidates.map((c) => optimistic(pr, st, c)).filter((x) => x > SPEND_EPS).sort((a, b) => b - a);
  const topMoves = amounts.slice(0, left).reduce((a, b) => a + b, 0);
  // per pool: what sources with a sink there still hold, and the sinks' room
  const srcIn = pr.pools.map(() => new Set<number>());
  const sinkIn = pr.pools.map(() => new Set<number>());
  for (const c of pr.candidates) {
    srcIn[c.p]!.add(c.s);
    sinkIn[c.p]!.add(c.k);
  }
  let pools = 0;
  for (let p = 0; p < pr.pools.length; p++) {
    const held = [...srcIn[p]!].reduce((s, i) => s + st.spend[i]![p]!, 0);
    const room = [...sinkIn[p]!].reduce((s, k) => s + Math.max(0, pr.params.cap * pr.poolTotal[p]! - st.spend[k]![p]!), 0);
    pools += Math.min(held, room);
  }
  return Math.min(topMoves, pools);
}

/** Depth-first branch and bound over move sequences, seeded with `incumbent`, under `limit` nodes. */
function search(pr: Problem, start: State, incumbent: Plan, limit: number): { plan: Plan; exact: boolean; nodes: number } {
  let best = incumbent;
  let bestValue = moved(replay(pr, start, best).applied);
  let nodes = 0;
  let exact = true;
  const st = cloneState(start);
  const path: number[] = [];
  const seen = new Set<string>();
  // The cells moves can change, keyed compactly (two 32-bit FNV-1a hashes) so the memo stays small.
  const cells = [...new Set(pr.candidates.flatMap((c) => [c.s * pr.pools.length + c.p, c.k * pr.pools.length + c.p]))].sort((a, b) => a - b);
  const key = (): string => {
    let h1 = FNV_OFFSET;
    let h2 = FNV_PRIME ^ st.moves;
    for (const cell of cells) {
      const text = st.spend[Math.floor(cell / pr.pools.length)]![cell % pr.pools.length]!.toFixed(KEY_DECIMALS);
      for (let j = 0; j < text.length; j++) {
        const ch = text.charCodeAt(j);
        h1 = Math.imul(h1 ^ ch, FNV_PRIME);
        h2 = Math.imul(h2 ^ ch, MURMUR_M);
      }
      h1 = Math.imul(h1 ^ CELL_SEPARATOR, FNV_PRIME);
    }
    return `${st.moves}:${(h1 >>> 0).toString(KEY_RADIX)}:${(h2 >>> 0).toString(KEY_RADIX)}`;
  };
  const dfs = (value: number): void => {
    if (value > bestValue + SPEND_EPS) {
      best = [...path];
      bestValue = value;
    }
    if (st.moves >= pr.params.maxMoves) return;
    if (value + bound(pr, st) <= bestValue + SPEND_EPS) return;
    const k = key();
    if (seen.has(k)) return;
    seen.add(k);
    for (const f of feasible(pr, st)) {
      if (nodes >= limit) {
        exact = false;
        return;
      }
      nodes += 1;
      const a = apply(st, pr.candidates[f.i]!, f.x, f.exit);
      path.push(f.i);
      dfs(value + f.x);
      path.pop();
      undo(st, a);
    }
  };
  if (limit > 0) dfs(0);
  else exact = false;
  return { plan: best, exact, nodes };
}

// ---------------------------------------------------------------------------------------------- results

/** HHI of the named vendors (0..10 000), shares over the whole third-party total, as in the spend cube. */
function hhi(pr: Problem, vendorTotal: readonly number[]): number {
  if (pr.total <= 0) return 0;
  const sum = vendorTotal.reduce((s, t, i) => (pr.named[i] ? s + ((t / pr.total) * PERCENT) * ((t / pr.total) * PERCENT) : s), 0);
  return Math.min(PERCENT * PERCENT, Math.max(0, sum));
}

const clampShare = (x: number): number => Math.min(1, Math.max(0, x));

/** The constraints that stop the plan going further in its final state. */
function bindings(pr: Problem, st: State, applied: readonly Applied[]): ConsolidationBindingResult[] {
  const hit = new Set<string>();
  const anyLeft = pr.candidates.some((c) => st.spend[c.s]![c.p]! > SPEND_EPS);
  if (pr.params.perDollar <= 0) {
    if (pr.candidates.length > 0) hit.add(CONSOLIDATION_PARAMS.transitionCost);
  } else {
    if (applied.some((a) => a.capped)) hit.add(CONSOLIDATION_PARAMS.concentrationCap);
    for (const c of pr.candidates) {
      const e = evaluate(pr, st, c);
      if (e.block === 'cap') hit.add(CONSOLIDATION_PARAMS.concentrationCap);
      else if (e.block === 'count') hit.add(CONSOLIDATION_PARAMS.minVendorCount);
      else if (e.block === null && st.moves >= pr.params.maxMoves) hit.add(CONSOLIDATION_PARAMS.maxMoves);
    }
    if (!anyLeft) hit.clear();
  }
  return BINDING_ORDER.filter((k) => hit.has(k)).map((k) => {
    const row = pr.params.rows.get(k)!;
    return { param: k, label: row.label, value: row.value };
  });
}

/**
 * Runs the optimizer on a spend cube (`vendors`, spend split by pool) with the run's parameters. See the module
 * comment for the model, the objective and the algorithm. Throws `ConsolidationParamError` when a parameter it
 * needs is missing or unusable.
 */
export function consolidate(input: ConsolidationInput): ConsolidationOutcome {
  const { problem: pr, state: start } = buildProblem(input);
  const p = pr.params;

  let plan: Plan = [];
  let exact = true;
  let nodes = 0;
  if (p.perDollar > 0 && p.maxMoves > 0 && pr.candidates.length > 0) {
    const repaired = repair(pr, start, greedy(pr, start, new Set()));
    const found = search(pr, start, repaired, input.nodeLimit ?? DEFAULT_NODE_LIMIT);
    plan = found.plan;
    exact = found.exact;
    nodes = found.nodes;
  }
  const { st, applied } = replay(pr, start, plan);

  const ranked = [...applied].sort(
    (a, b) => b.x - a.x || a.c.s - b.c.s || a.c.k - b.c.k || a.c.p - b.c.p, // net benefit is x * perDollar
  );
  const moves: ConsolidationMoveResult[] = ranked.map((a) => {
    const from = pr.vendors[a.c.s]!;
    const to = pr.vendors[a.c.k]!;
    const annualSaving = a.x * p.rate;
    const oneTimeCost = a.x * p.transition;
    return {
      from: from.vendor,
      fromKey: from.vendorKey,
      to: to.vendor,
      toKey: to.vendorKey,
      pool: pr.pools[a.c.p]!,
      spendMoved: a.x,
      annualSaving,
      oneTimeCost,
      paybackMonths: paybackMonths(oneTimeCost, annualSaving),
      netBenefit: a.x * p.perDollar,
    };
  });

  const spendMoved = moves.reduce((s, m) => s + m.spendMoved, 0);
  const annualSaving = moves.reduce((s, m) => s + m.annualSaving, 0);
  const oneTimeCost = moves.reduce((s, m) => s + m.oneTimeCost, 0);
  const topAfter = pr.total > 0 ? Math.max(0, ...st.vendorTotal.filter((_, i) => pr.named[i])) / pr.total : 0;
  const used = [...REQUIRED_PARAMS, CONSOLIDATION_PARAMS.discountRate].filter((k) => p.rows.has(k));

  return {
    moves,
    totals: {
      spendMoved,
      annualSaving,
      oneTimeCost,
      paybackMonths: paybackMonths(oneTimeCost, annualSaving),
      vendorsBefore: start.count,
      vendorsAfter: st.count,
    },
    hhiBefore: hhi(pr, start.vendorTotal),
    hhiAfter: hhi(pr, st.vendorTotal),
    topVendorShareAfter: clampShare(topAfter),
    binding: bindings(pr, st, applied),
    params: Object.fromEntries(used.map((k) => [k, p.rows.get(k)!.value])),
    netBenefit: spendMoved * p.perDollar,
    exact,
    nodes,
  };
}
