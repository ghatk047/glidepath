import { describe, expect, it } from 'vitest';
import {
  CONSOLIDATION_PARAMS as K,
  ConsolidationParamError,
  annuityFactor,
  consolidate,
  paybackMonths,
  resolveConsolidationParams,
} from './consolidation';
import type { ConsolidationInput, ConsolidationOutcome, ConsolidationParamRow, ConsolidationVendor } from './consolidation';

// ------------------------------------------------------------------------------------------------ fixtures

const poolsOf = (vendors: readonly ConsolidationVendor[]): string[] => [...new Set(vendors.flatMap((x) => Object.keys(x.spendByPool)))];
/** The optimizer with every pool of the cube eligible, unless the case names its own scope. */
const solve = (i: Omit<ConsolidationInput, 'eligiblePools'> & { eligiblePools?: readonly string[] }): ConsolidationOutcome =>
  consolidate({ ...i, eligiblePools: i.eligiblePools ?? poolsOf(i.vendors) });

/** Test parameters (the shape of the seed's sourcing_param members; values are test inputs). */
function params(over: Partial<Record<string, number>> = {}, withDiscount = true): ConsolidationParamRow[] {
  const rows: ConsolidationParamRow[] = [
    { key: K.rateDiscount, label: 'Rate discount', value: 0.06, min: 0, max: 0.2 },
    { key: K.transitionCost, label: 'Transition cost', value: 0.08, min: 0, max: 0.3 },
    { key: K.concentrationCap, label: 'Concentration cap', value: 0.35, min: 0.15, max: 0.6 },
    { key: K.minVendorCount, label: 'Minimum vendors', value: 4, min: 2, max: 6 },
    { key: K.maxMoves, label: 'Maximum moves', value: 10, min: 1, max: 20 },
    { key: K.horizonYears, label: 'Horizon', value: 5, min: 3, max: 7 },
    ...(withDiscount ? [{ key: K.discountRate, label: 'Discount rate', value: 0.09, min: 0.04, max: 0.15 }] : []),
  ];
  return rows.map((r) => (over[r.key] === undefined ? r : { ...r, value: over[r.key]! }));
}

const v = (vendor: string, spendByPool: Record<string, number>, o: Partial<ConsolidationVendor> = {}): ConsolidationVendor => ({
  vendor,
  vendorKey: o.preferred ? vendor.toLowerCase() : null,
  preferred: false,
  aggregate: false,
  spendByPool,
  ...o,
});
const pref = (vendor: string, spendByPool: Record<string, number>) => v(vendor, spendByPool, { preferred: true });

/** mulberry32: a seeded PRNG so the random cases are the same on every run. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Case {
  vendors: ConsolidationVendor[];
  params: ConsolidationParamRow[];
}

function randomCase(seed: number, size: { pools: number; sources: number; sinks: number; maxMoves: number }): Case {
  const r = rng(seed);
  const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
  const pools = Array.from({ length: int(1, size.pools) }, (_, i) => `p${i}`);
  const spend = (density: number) => {
    const out: Record<string, number> = {};
    for (const p of pools) if (r() < density) out[p] = Math.round((0.5 + r() * 20) * 100) / 100;
    if (Object.keys(out).length === 0) out[pools[int(0, pools.length - 1)]!] = Math.round((0.5 + r() * 20) * 100) / 100;
    return out;
  };
  const vendors: ConsolidationVendor[] = [];
  for (let i = 0; i < int(1, size.sinks); i++) vendors.push(pref(`S${i}`, spend(0.6)));
  for (let i = 0; i < int(1, size.sources); i++) vendors.push(v(`T${i}`, spend(0.5)));
  // An aggregate bucket in most cases, sized against each pool, so sinks often have room under the cap.
  if (r() < 0.8) {
    const filler: Record<string, number> = {};
    for (const p of pools) filler[p] = Math.round(sum(vendors.map((x) => x.spendByPool[p] ?? 0)) * (0.5 + 2 * r()) * 100) / 100 + 1;
    vendors.push(v('Various', filler, { aggregate: true }));
  }
  return {
    vendors,
    params: params({
      [K.concentrationCap]: 0.15 + 0.05 * int(0, 9),
      [K.minVendorCount]: int(1, 5),
      [K.maxMoves]: int(1, size.maxMoves),
    }),
  };
}

// ------------------------------------------------------------------------------- independent checks

/** Spend by vendor and pool after applying the reported moves to the input (not the solver's own state). */
function applyMoves(c: Case, out: ConsolidationOutcome): Map<string, Record<string, number>> {
  const m = new Map(c.vendors.map((x) => [x.vendor, { ...x.spendByPool }]));
  for (const mv of out.moves) {
    const from = m.get(mv.from)!;
    const to = m.get(mv.to)!;
    expect(from[mv.pool] ?? 0).toBeGreaterThanOrEqual(mv.spendMoved - 1e-9);
    from[mv.pool] = (from[mv.pool] ?? 0) - mv.spendMoved;
    to[mv.pool] = (to[mv.pool] ?? 0) + mv.spendMoved;
  }
  return m;
}

const sum = (xs: Iterable<number>) => [...xs].reduce((a, b) => a + b, 0);
const live = (x: number) => x > 1e-9;

function counts(c: Case, spend: Map<string, Record<string, number>>) {
  const named = c.vendors.filter((x) => !x.aggregate);
  const pools = [...new Set(c.vendors.flatMap((x) => Object.keys(x.spendByPool)))];
  return {
    overall: named.filter((x) => live(sum(Object.values(spend.get(x.vendor)!)))).length,
    byPool: Object.fromEntries(pools.map((p) => [p, named.filter((x) => live(spend.get(x.vendor)![p] ?? 0)).length])),
  };
}

/** Brute force over every sequence of moves, written apart from the solver: the most spend that can move. */
function bruteForce(c: Case, eligible: readonly string[] = poolsOf(c.vendors)): number {
  const p = Object.fromEntries(c.params.map((x) => [x.key, x.value])) as Record<string, number>;
  const cap = p[K.concentrationCap]!;
  const min = p[K.minVendorCount]!;
  const maxMoves = p[K.maxMoves]!;
  const pools = [...new Set(c.vendors.flatMap((x) => Object.keys(x.spendByPool)))];
  const poolTotal = Object.fromEntries(pools.map((q) => [q, sum(c.vendors.map((x) => x.spendByPool[q] ?? 0))]));
  const total = sum(Object.values(poolTotal));
  const spend = c.vendors.map((x) => pools.map((q) => x.spendByPool[q] ?? 0));
  const triples: [number, number, number][] = [];
  c.vendors.forEach((s, si) => {
    if (s.aggregate || s.preferred) return;
    c.vendors.forEach((k, ki) => {
      if (k.aggregate || !k.preferred) return;
      pools.forEach((_, q) => {
        if (eligible.includes(pools[q]!) && spend[si]![q]! > 0 && spend[ki]![q]! > 0) triples.push([si, ki, q]);
      });
    });
  });
  const namedLive = (pred: (row: number[]) => boolean) => spend.filter((row, i) => !c.vendors[i]!.aggregate && pred(row)).length;

  let best = 0;
  const go = (depth: number, value: number) => {
    best = Math.max(best, value);
    if (depth === maxMoves) return;
    for (const [s, k, q] of triples) {
      const rem = spend[s]![q]!;
      if (rem <= 1e-9) continue;
      const room = Math.min(cap * poolTotal[pools[q]!]! - spend[k]![q]!, cap * total - sum(spend[k]!));
      const x = Math.min(rem, room);
      if (x <= 1e-9) continue;
      const exits = x >= rem - 1e-9;
      if (exits) {
        const poolCount = namedLive((row) => row[q]! > 1e-9);
        const overall = namedLive((row) => sum(row) > 1e-9);
        const leaves = sum(spend[s]!) - rem <= 1e-9;
        if (poolCount - 1 < min || (leaves && overall - 1 < min)) continue;
      }
      const moved = exits ? rem : x;
      spend[s]![q] = exits ? 0 : rem - x;
      spend[k]![q] = spend[k]![q]! + moved;
      go(depth + 1, value + moved);
      spend[s]![q] = rem;
      spend[k]![q] = spend[k]![q]! - moved;
    }
  };
  go(0, 0);
  return best;
}

/** Least number of random cases that must show a behaviour (several moves, a binding constraint). */
const STATS_FLOOR = 25;

/** Largest-first greedy without repair or search, for comparison: max_moves 1 at a time on the solver. */
function plainGreedy(c: Case): number {
  // one move at a time with max_moves = 1 is exactly a greedy step; replay by feeding the result back
  let vendors = c.vendors.map((x) => ({ ...x, spendByPool: { ...x.spendByPool } }));
  const P = Object.fromEntries(c.params.map((x) => [x.key, x.value])) as Record<string, number>;
  let moved = 0;
  for (let i = 0; i < P[K.maxMoves]!; i++) {
    const step = solve({ vendors, params: c.params.map((x) => (x.key === K.maxMoves ? { ...x, value: 1 } : x)), nodeLimit: 0 });
    const m = step.moves[0];
    if (!m) break;
    moved += m.spendMoved;
    vendors = vendors.map((x) => {
      if (x.vendor === m.from) return { ...x, spendByPool: { ...x.spendByPool, [m.pool]: (x.spendByPool[m.pool] ?? 0) - m.spendMoved } };
      if (x.vendor === m.to) return { ...x, spendByPool: { ...x.spendByPool, [m.pool]: (x.spendByPool[m.pool] ?? 0) + m.spendMoved } };
      return x;
    });
  }
  return moved;
}

// ------------------------------------------------------------------------------------------------ tests

describe('SRC-10 consolidation: worked example', () => {
  // One pool of 100: sink A 20, tails T1 10, T2 6, T3 4, others keep the count up.
  const vendors = [
    pref('A', { si: 20 }),
    v('T1', { si: 10 }),
    v('T2', { si: 6 }),
    v('T3', { si: 4 }),
    v('Big1', { other: 30 }),
    v('Big2', { other: 30 }),
    v('Various', { si: 60 }, { aggregate: true }),
  ];

  it('moves the tail into the sink up to the cap, largest first, and reports every number of each move', () => {
    // si total 100, cap 0.35 -> A may hold 35: T1 (10) whole, then T2 limited to 5.
    const out = solve({ vendors, params: params({ [K.minVendorCount]: 2 }) });
    expect(out.moves.map((m) => [m.from, m.to, m.pool])).toEqual([
      ['T1', 'A', 'si'],
      ['T2', 'A', 'si'],
    ]);
    expect(out.moves[0]!.spendMoved).toBeCloseTo(10, 12);
    expect(out.moves[1]!.spendMoved).toBeCloseTo(5, 12);
    for (const m of out.moves) {
      expect(m.annualSaving).toBeCloseTo(m.spendMoved * 0.06, 12);
      expect(m.oneTimeCost).toBeCloseTo(m.spendMoved * 0.08, 12);
      expect(m.paybackMonths).toBeCloseTo((0.08 / 0.06) * 12, 9);
      expect(m.netBenefit).toBeCloseTo(m.spendMoved * (0.06 * annuityFactor(5, 0.09) - 0.08), 12);
      expect(m.fromKey).toBeNull();
      expect(m.toKey).toBe('a');
    }
    expect(out.totals).toMatchObject({ vendorsBefore: 6, vendorsAfter: 5 });
    expect(out.totals.spendMoved).toBeCloseTo(15, 12);
    expect(out.totals.paybackMonths).toBeCloseTo(16, 9);
    expect(out.binding.map((b) => b.param)).toEqual([K.concentrationCap]);
    expect(out.binding[0]).toEqual({ param: K.concentrationCap, label: 'Concentration cap', value: 0.35 });
    expect(out.topVendorShareAfter).toBeCloseTo(35 / 160, 12);
    expect(out.exact).toBe(true);
    // HHI over named vendors only, shares over the whole total (160)
    const h = (xs: number[]) => sum(xs.map((x) => ((x / 160) * 100) ** 2));
    expect(out.hhiBefore).toBeCloseTo(h([20, 10, 6, 4, 30, 30]), 9);
    expect(out.hhiAfter).toBeCloseTo(h([35, 0, 1, 4, 30, 30]), 9);
    expect(out.params).toMatchObject({ [K.rateDiscount]: 0.06, [K.maxMoves]: 10, [K.discountRate]: 0.09 });
  });

  it('max_moves binds when moves are left that could still be made', () => {
    const out = solve({ vendors, params: params({ [K.minVendorCount]: 2, [K.maxMoves]: 1 }) });
    expect(out.moves).toHaveLength(1);
    expect(out.binding.map((b) => b.param)).toEqual([K.maxMoves]);
  });

  it('min_vendor_count refuses a move that empties a vendor below the minimum', () => {
    // pool si has 4 named vendors: with a minimum of 4 no tail may leave it
    const out = solve({ vendors, params: params({ [K.minVendorCount]: 4, [K.concentrationCap]: 0.6 }) });
    expect(out.moves).toEqual([]);
    expect(out.binding.map((b) => b.param)).toEqual([K.minVendorCount]);
  });

  it('a cap-limited part may still move when the source stays in the pool', () => {
    const out = solve({ vendors, params: params({ [K.minVendorCount]: 4, [K.concentrationCap]: 0.25 }) });
    expect(out.moves.map((m) => [m.from, m.spendMoved])).toEqual([['T1', 5]]);
    expect(out.binding.map((b) => b.param)).toEqual([K.concentrationCap]);
    expect(out.totals.vendorsAfter).toBe(out.totals.vendorsBefore);
  });

  it('the cap also holds on the third-party total, not only on the pool', () => {
    // A serves two pools; in si it has pool room, but its share of the whole spend is the limit
    const vs = [pref('A', { si: 10, other: 40 }), v('T1', { si: 30 }), v('X', { other: 10 }), v('Y', { si: 10 }), v('Z', { other: 20 })];
    const out = solve({ vendors: vs, params: params({ [K.minVendorCount]: 2, [K.concentrationCap]: 0.45 }) });
    // total 120 -> A may hold 54 overall (has 50): 4 moves; si room would be 0.45*50-10 = 12.5
    expect(out.moves).toHaveLength(1);
    expect(out.moves[0]!.spendMoved).toBeCloseTo(4, 12);
  });

  it('only moves into a preferred vendor that already serves the pool; aggregates neither give nor take', () => {
    const vs = [pref('A', { cloud: 10 }), v('T1', { si: 5 }), v('T2', { cloud: 3 }), v('Various', { cloud: 30 }, { aggregate: true })];
    const out = solve({ vendors: vs, params: params({ [K.minVendorCount]: 1, [K.concentrationCap]: 0.6 }) });
    expect(out.moves.map((m) => [m.from, m.to, m.pool])).toEqual([['T2', 'A', 'cloud']]);
    expect(out.binding).toEqual([]);
  });

  it('the exact search confirms the greedy and repair plan; with no node budget it is not proven', () => {
    const vs = [pref('B1', { a: 25 }), pref('B2', { a: 29 }), v('T1', { a: 10 }), v('T2', { a: 6 }), v('O', { a: 30 })];
    const P = params({ [K.minVendorCount]: 1, [K.maxMoves]: 2 });
    const out = solve({ vendors: vs, params: P });
    expect(out.exact).toBe(true);
    expect(out.totals.spendMoved).toBeCloseTo(bruteForce({ vendors: vs, params: P }), 9);
    const quick = solve({ vendors: vs, params: P, nodeLimit: 0 });
    expect(quick.exact).toBe(false);
    expect(quick.totals.spendMoved).toBeCloseTo(out.totals.spendMoved, 9);
  });
});

describe('SRC-10 consolidation: eligible pools', () => {
  it('only moves spend in pools of the consolidation scope; an empty scope moves nothing', () => {
    // IBM serves both an SI pool and a licence pool: only the SI tail may move to it
    const vs = [pref('IBM', { si: 15, software: 2 }), v('Staffing', { si: 14 }), v('Microsoft', { software: 27 }), v('Various', { si: 40, software: 60 }, { aggregate: true })];
    const P = params({ [K.minVendorCount]: 1 });
    const scoped = solve({ vendors: vs, params: P, eligiblePools: ['si'] });
    expect(scoped.moves.map((m) => [m.from, m.to, m.pool])).toEqual([['Staffing', 'IBM', 'si']]);
    const all = solve({ vendors: vs, params: P });
    expect(all.moves.map((m) => m.from)).toContain('Microsoft');
    const none = solve({ vendors: vs, params: P, eligiblePools: [] });
    expect(none.moves).toEqual([]);
    expect(none.binding).toEqual([]);
    expect(none.hhiAfter).toBe(none.hhiBefore);
  });

  it('the brute force agrees when only part of the cube is eligible', () => {
    for (let seed = 2001; seed <= 2100; seed++) {
      const c = randomCase(seed, { pools: 3, sources: 4, sinks: 2, maxMoves: 3 });
      const eligible = poolsOf(c.vendors).filter((_, i) => i % 2 === 0);
      const out = solve({ ...c, eligiblePools: eligible });
      expect(out.moves.every((m) => eligible.includes(m.pool))).toBe(true);
      expect(out.totals.spendMoved, `seed ${seed}`).toBeCloseTo(bruteForce(c, eligible), 9);
    }
  });
});

describe('SRC-10 consolidation: parameters', () => {
  it('merges overrides; refuses unknown keys, out-of-range values and fractional counts, naming each', () => {
    const rows = params();
    const merged = resolveConsolidationParams(rows, { [K.rateDiscount]: 0.1 });
    expect(merged.find((r) => r.key === K.rateDiscount)!.value).toBe(0.1);
    expect(merged.find((r) => r.key === K.maxMoves)!.value).toBe(10);
    expect(rows.find((r) => r.key === K.rateDiscount)!.value).toBe(0.06);
    try {
      resolveConsolidationParams(rows, { nope: 1, [K.concentrationCap]: 0.9, [K.maxMoves]: 2.5, [K.minVendorCount]: Number.NaN });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ConsolidationParamError);
      const msg = (err as ConsolidationParamError).violations.join('\n');
      expect(msg).toMatch(/nope/);
      expect(msg).toMatch(/concentration_cap_pct = 0.9 is outside \[0.15, 0.6\]/);
      expect(msg).toMatch(/max_moves = 2.5 must be a whole number/);
      expect(msg).toMatch(/min_vendor_count/);
    }
    expect(() => resolveConsolidationParams(rows, { [K.concentrationCap]: 0.6, [K.rateDiscount]: 0 })).not.toThrow();
  });

  it('a missing parameter is an error that names it; the discount rate is optional', () => {
    const rows = params().filter((r) => r.key !== K.maxMoves);
    expect(() => solve({ vendors: [], params: rows })).toThrow(/max_moves is missing/);
    const out = solve({ vendors: [pref('A', { a: 10 }), v('T', { a: 1 }), v('U', { a: 30 })], params: params({ [K.minVendorCount]: 1 }, false) });
    expect(out.netBenefit).toBeCloseTo(out.totals.spendMoved * (0.06 * 5 - 0.08), 12);
    expect(out.totals.spendMoved).toBeGreaterThan(0);
    expect(out.params[K.discountRate]).toBeUndefined();
  });

  it('a move that never pays back is not made: rate 0 gives no moves and transition_cost binds', () => {
    const vs = [pref('A', { a: 10 }), v('T', { a: 1 }), v('U', { a: 30 })];
    const out = solve({ vendors: vs, params: params({ [K.rateDiscount]: 0, [K.minVendorCount]: 1 }) });
    expect(out.moves).toEqual([]);
    expect(out.totals).toEqual({ spendMoved: 0, annualSaving: 0, oneTimeCost: 0, paybackMonths: 0, vendorsBefore: 3, vendorsAfter: 3 });
    expect(out.hhiAfter).toBe(out.hhiBefore);
    expect(out.binding.map((b) => b.param)).toEqual([K.transitionCost]);
  });

  it('transition cost 0 pays back at once (0 months)', () => {
    const vs = [pref('A', { a: 10 }), v('T', { a: 1 }), v('U', { a: 30 })];
    const out = solve({ vendors: vs, params: params({ [K.transitionCost]: 0, [K.minVendorCount]: 1 }) });
    expect(out.moves.length).toBeGreaterThan(0);
    expect(out.moves.every((m) => m.paybackMonths === 0)).toBe(true);
    expect(out.totals.paybackMonths).toBe(0);
  });

  it('payback and annuity helpers', () => {
    expect(paybackMonths(0, 0)).toBe(0);
    expect(paybackMonths(1, 0)).toBeNull();
    expect(paybackMonths(1, 1)).toBe(12);
    expect(annuityFactor(5, undefined)).toBe(5);
    expect(annuityFactor(5, 0)).toBe(5);
    expect(annuityFactor(1, 0.1)).toBeCloseTo(1 / 1.1, 12);
  });

  it('an empty cube moves nothing', () => {
    const out = solve({ vendors: [], params: params() });
    expect(out).toMatchObject({ moves: [], hhiBefore: 0, hhiAfter: 0, topVendorShareAfter: 0, binding: [] });
  });
});

describe('SRC-10 consolidation: properties', () => {
  it('never breaches the cap, the minimum vendor count or max_moves (500 seeded random cases)', () => {
    const stats = { multi: 0, [K.concentrationCap]: 0, [K.minVendorCount]: 0, [K.maxMoves]: 0 } as Record<string, number>;
    for (let seed = 1; seed <= 500; seed++) {
      const c = randomCase(seed, { pools: 4, sources: 12, sinks: 4, maxMoves: 10 });
      const out = solve({ ...c, nodeLimit: 500 });
      const P = Object.fromEntries(out.params ? Object.entries(out.params) : []);
      const cap = P[K.concentrationCap]!;
      const min = P[K.minVendorCount]!;
      expect(out.moves.length, `seed ${seed}`).toBeLessThanOrEqual(P[K.maxMoves]!);

      const after = applyMoves(c, out);
      const pools = [...new Set(c.vendors.flatMap((x) => Object.keys(x.spendByPool)))];
      const poolTotal = Object.fromEntries(pools.map((p) => [p, sum(c.vendors.map((x) => x.spendByPool[p] ?? 0))]));
      const total = sum(Object.values(poolTotal));
      for (const to of new Set(out.moves.map((m) => m.to))) {
        const row = after.get(to)!;
        expect(sum(Object.values(row)) / total, `seed ${seed}: ${to} overall`).toBeLessThanOrEqual(cap + 1e-9);
        for (const m of out.moves.filter((x) => x.to === to)) {
          expect(row[m.pool]! / poolTotal[m.pool]!, `seed ${seed}: ${to} in ${m.pool}`).toBeLessThanOrEqual(cap + 1e-9);
        }
      }
      for (const m of out.moves) {
        const from = c.vendors.find((x) => x.vendor === m.from)!;
        const to = c.vendors.find((x) => x.vendor === m.to)!;
        expect(from.preferred || from.aggregate).toBe(false);
        expect(to.preferred && !to.aggregate).toBe(true);
        expect(to.spendByPool[m.pool] ?? 0).toBeGreaterThan(0);
        expect(m.spendMoved).toBeGreaterThan(0);
        expect(m.annualSaving).toBeCloseTo(m.spendMoved * P[K.rateDiscount]!, 12);
        expect(m.oneTimeCost).toBeCloseTo(m.spendMoved * P[K.transitionCost]!, 12);
        expect(m.paybackMonths).toBeCloseTo((m.oneTimeCost / m.annualSaving) * 12, 9);
      }
      const before = counts(c, new Map(c.vendors.map((x) => [x.vendor, x.spendByPool])));
      const now = counts(c, after);
      if (now.overall < before.overall) expect(now.overall, `seed ${seed} overall count`).toBeGreaterThanOrEqual(min);
      for (const p of pools) if (now.byPool[p]! < before.byPool[p]!) expect(now.byPool[p], `seed ${seed} count in ${p}`).toBeGreaterThanOrEqual(min);
      expect(out.totals.vendorsBefore).toBe(before.overall);
      expect(out.totals.vendorsAfter).toBe(now.overall);
      expect(out.topVendorShareAfter).toBeLessThanOrEqual(1);
      expect(out.hhiAfter).toBeLessThanOrEqual(10_000);
      // ranked by net benefit
      for (let i = 1; i < out.moves.length; i++) expect(out.moves[i - 1]!.netBenefit).toBeGreaterThanOrEqual(out.moves[i]!.netBenefit);
      if (out.moves.length >= 2) stats['multi']! += 1;
      for (const b of out.binding) stats[b.param] = (stats[b.param] ?? 0) + 1;
    }
    // the cases are not vacuous: many plans have several moves, and each constraint binds in a fair share of them
    process.stdout.write(`SRC-10 property cases: ${JSON.stringify(stats)}\n`);
    expect(stats['multi']).toBeGreaterThanOrEqual(STATS_FLOOR);
    for (const k of [K.concentrationCap, K.minVendorCount, K.maxMoves]) expect(stats[k], k).toBeGreaterThanOrEqual(STATS_FLOOR);
  });

  it('matches brute force on small instances (200 seeded cases)', () => {
    let exactCount = 0;
    let greedyShort = 0;
    let searchNeeded = 0;
    let moving = 0;
    for (let seed = 1001; seed <= 1200; seed++) {
      const c = randomCase(seed, { pools: 2, sources: 4, sinks: 3, maxMoves: 4 });
      const out = solve(c);
      const best = bruteForce(c);
      if (out.exact) exactCount += 1;
      if (best > 1e-9) moving += 1;
      expect(out.totals.spendMoved, `seed ${seed}`).toBeCloseTo(best, 9);
      // greedy + repair alone (no search): never better than the optimum
      const quick = solve({ ...c, nodeLimit: 0 });
      expect(quick.totals.spendMoved).toBeLessThanOrEqual(best + 1e-9);
      if (quick.totals.spendMoved < best - 1e-9) searchNeeded += 1;
      if (plainGreedy(c) < best - 1e-9) greedyShort += 1;
    }
    process.stdout.write(`SRC-10 brute force: ${JSON.stringify({ moving, exactCount, greedyShort, searchNeeded })}\n`);
    expect(exactCount).toBe(200);
    expect(moving).toBeGreaterThanOrEqual(STATS_FLOOR);
    // on these seeds the repair step and the exact search each earn their place over plain largest-first
    expect(greedyShort).toBeGreaterThan(0);
    expect(searchNeeded).toBeGreaterThan(0);
  });

  it('is deterministic', () => {
    const c = randomCase(77, { pools: 3, sources: 10, sinks: 3, maxMoves: 8 });
    expect(solve(c)).toEqual(solve(c));
  });
});
