/**
 * ENG-07 acceptance on the seed tenant: `rerun(prev, changes)` is bitwise equal to a full `evaluate`
 * of the same inputs and pins, over seeded random edits, and recomputes exactly the cells it must.
 */
import type { VariableDef } from '@glidepath/spec';
import { describe, expect, it } from 'vitest';
import { loadSeedModel, readRepoJson } from '../../test/helpers';
import { compileModel } from '../compile';
import { EngineError } from '../errors';
import type { CellKey, Change } from '../types';
import type { SlotEvaluation } from './evaluate';
import { findScenario, resolveInputs } from './inputs';
import type { RerunEvaluation } from './rerun';

const SEED = 0x5eed_0007;
const SINGLE_CHANGES = 500;
const MULTI_CHANGES = 100;
const PIN_STEPS = 100;
/** Changes per multi-input step: 2 … 2 + MULTI_SPREAD - 1. */
const MULTI_SPREAD = 7;
/** Share of draws that write a value equal to the current one (a no-op the walk must notice). */
const NOOP_SHARE = 0.05;
/** Each step runs a full evaluate as the oracle: seconds per test, more on a busy CI runner. */
const PROPERTY_TIMEOUT_MS = 60_000;

/** mulberry32: a small seeded PRNG, uniform in [0, 1). */
function rngOf(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Outcome<T> = { ok: T; err?: undefined } | { ok?: undefined; err: EngineError };

function outcome<T>(f: () => T): Outcome<T> {
  try {
    return { ok: f() };
  } catch (e) {
    if (e instanceof EngineError) return { err: e };
    throw e;
  }
}

describe('rerun equals evaluate bitwise after random changes', async () => {
  const { bundle, seed } = await loadSeedModel();
  const model = compileModel(bundle, seed.dimensionMembers);
  const p = model.program;
  const g = model.graph;
  const variables = new Map<string, VariableDef>(bundle.variables.map((v) => [v.id, v]));
  const plain = resolveInputs(bundle, seed.variableValues, findScenario(seed.scenarios, 'C'));
  const report = readRepoJson<{ parity_overrides: Record<string, number> }>(
    'docs/spec/reference/parity_report.json',
  );
  const parity = resolveInputs(bundle, seed.variableValues, findScenario(seed.scenarios, 'C'), {
    overrides: report.parity_overrides,
    values: { 'corp.it_swb_mode': 0 },
  });

  /** Keys of the slots that differ bitwise (node cells and inputs, `[0, constBase)`). */
  function bitDiff(a: SlotEvaluation, b: SlotEvaluation): CellKey[] {
    const wa = new Int32Array(a.slots.buffer, a.slots.byteOffset, p.constBase * 2);
    const wb = new Int32Array(b.slots.buffer, b.slots.byteOffset, p.constBase * 2);
    const out: CellKey[] = [];
    for (let s = 0; s < p.constBase; s++) {
      if (wa[2 * s] !== wb[2 * s] || wa[2 * s + 1] !== wb[2 * s + 1]) out.push(g.keys[s]!);
    }
    return out;
  }

  /** Keys whose entries differ between two cell maps (`Object.is` on the values). */
  function mapDiff(a: ReadonlyMap<CellKey, number>, b: ReadonlyMap<CellKey, number>): CellKey[] {
    const out = [...a].filter(([k, v]) => !b.has(k) || !Object.is(b.get(k), v)).map(([k]) => k);
    return out.concat([...b.keys()].filter((k) => !a.has(k)));
  }

  /**
   * The cells a dirty walk with early stop must recompute: every user of a key whose value differs
   * (`differ`, bitwise) or whose input became present between `before` and `after`, plus every node
   * cell an override change names.
   */
  function mustRecompute(
    before: SlotEvaluation,
    after: SlotEvaluation,
    differ: readonly CellKey[],
    changes: readonly Change[],
  ): CellKey[] {
    const dirty = new Set<number>();
    const moved = differ.map((k) => g.index.get(k)!);
    for (let i = 0; i < p.nInputs; i++) {
      const key = p.inputKeys[i]!;
      if (!before.values.has(key) && after.values.has(key)) moved.push(p.inputBase + i);
    }
    for (const k of moved) {
      for (let o = g.userOff[k]!; o < g.userOff[k + 1]!; o++) dirty.add(g.userIds[o]!);
    }
    for (const c of changes) {
      const id = g.index.get(c.cell);
      if (c.target === 'override' && id !== undefined && id < p.nCells) dirty.add(id);
    }
    return [...dirty].sort((a, b) => a - b).map((id) => p.cellKeys[id]!);
  }

  /** A new value for input `key`: within the registry bounds of its variable, else ±50% around `current`. */
  function draw(rng: () => number, key: CellKey, current: number): number {
    if (rng() < NOOP_SHARE) return current;
    const bracket = key.indexOf('[');
    const v = variables.get(bracket < 0 ? key : key.slice(0, bracket))!;
    if (v.min !== null && v.max !== null) {
      if (v.type === 'number') return v.min + rng() * (v.max - v.min);
      const step = v.step ?? 1;
      return v.min + Math.floor(rng() * (Math.round((v.max - v.min) / step) + 1)) * step;
    }
    return current + (rng() - 0.5) * (current === 0 ? 1 : Math.abs(current));
  }

  const pick = <T>(rng: () => number, xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)]!;

  /**
   * Reruns `prev` with `changes` and evaluates the resulting inputs and pins in full; both must raise
   * the same error or agree bitwise on every cell, and the rerun must recompute exactly the cells it
   * must. Returns the rerun (null when both raised).
   */
  function check(
    prev: SlotEvaluation,
    changes: readonly Change[],
    values: ReadonlyMap<CellKey, number>,
    overrides: ReadonlyMap<CellKey, number>,
    label: string,
  ): RerunEvaluation | null {
    const full = outcome(() => model.evaluate(values, overrides));
    const inc = outcome(() => model.rerun(prev, changes));
    if (full.err) {
      expect(inc.err, `${label}: rerun must raise ${full.err.message}`).toBeDefined();
      expect([inc.err!.code, inc.err!.cell, inc.err!.message], label).toEqual([
        full.err.code,
        full.err.cell,
        full.err.message,
      ]);
      return null;
    }
    expect(inc.err, label).toBeUndefined();
    const r = inc.ok!;
    expect(bitDiff(r, full.ok), label).toEqual([]);
    expect(r.diagnostics.full, label).toBe(false);
    const differ = bitDiff(prev, full.ok);
    expect(r.diagnostics.recomputed, label).toEqual(mustRecompute(prev, full.ok, differ, changes));
    expect(r.diagnostics.changed, label).toEqual(differ.filter((k) => g.index.get(k)! < p.nCells));
    expect(mapDiff(r.values, full.ok.values), label).toEqual([]);
    expect(mapDiff(r.overrides, full.ok.overrides), label).toEqual([]);
    return r;
  }

  it(`${SINGLE_CHANGES} seeded single-input changes`, { timeout: PROPERTY_TIMEOUT_MS }, () => {
    const rng = rngOf(SEED);
    const base = model.evaluate(plain.values, plain.overrides);
    // Recomputed cells against the downstream closure (what a walk without early stop would run).
    let recomputed = 0;
    let closure = 0;
    let stopped = 0;
    let noops = 0;
    let failed = 0;
    for (let i = 0; i < SINGLE_CHANGES; i++) {
      const key = pick(rng, p.inputKeys);
      const current = base.values.get(key) ?? 0;
      const value = draw(rng, key, current);
      const values = new Map(base.values).set(key, value);
      const change: Change = { target: 'variable', cell: key, value };
      const r = check(base, [change], values, base.overrides, `#${i} ${key}=${value}`);
      if (r === null) {
        failed++;
        continue;
      }
      const ran = r.diagnostics.recomputed.length;
      if (Object.is(value, current)) {
        expect(ran, `#${i} no-op`).toBe(0);
        noops++;
        continue;
      }
      const down = model.downstream(key).length;
      recomputed += ran;
      closure += down;
      if (ran < down) stopped++;
    }
    // Most draws evaluate; some are no-ops; early stop prunes the downstream closure on the real graph
    // (measured at ENG-07: 500 evaluated, 44 no-ops, 91,776 of 153,029 cells run, early stop in 428).
    expect(failed).toBeLessThan(SINGLE_CHANGES / 10);
    expect(noops).toBeGreaterThan(0);
    expect(stopped).toBeGreaterThan(0);
    expect(recomputed).toBeLessThan(closure);
  });

  it(
    `${MULTI_CHANGES} seeded multi-input changes, each rerun from the previous result`,
    { timeout: PROPERTY_TIMEOUT_MS },
    () => {
      const rng = rngOf(SEED + 1);
      let prev: SlotEvaluation = model.evaluate(plain.values, plain.overrides);
      let ok = 0;
      for (let i = 0; i < MULTI_CHANGES; i++) {
        const n = 2 + Math.floor(rng() * MULTI_SPREAD);
        const changes: Change[] = [];
        const values = new Map(prev.values);
        for (let j = 0; j < n; j++) {
          const key = pick(rng, p.inputKeys);
          const value = draw(rng, key, values.get(key) ?? 0);
          changes.push({ target: 'variable', cell: key, value });
          values.set(key, value);
        }
        const r = check(prev, changes, values, prev.overrides, `#${i}`);
        if (r !== null) {
          prev = r;
          ok++;
        }
      }
      expect(ok).toBeGreaterThan(MULTI_CHANGES * 0.9);
    },
  );

  it(
    `${PIN_STEPS} seeded steps that pin, re-pin and unpin node cells among input changes`,
    { timeout: PROPERTY_TIMEOUT_MS },
    () => {
      const rng = rngOf(SEED + 2);
      let prev: SlotEvaluation = model.evaluate(parity.values, parity.overrides);
      expect(prev.overrides.size).toBe(Object.keys(report.parity_overrides).length);
      let ok = 0;
      for (let i = 0; i < PIN_STEPS; i++) {
        const n = 1 + Math.floor(rng() * 4);
        const changes: Change[] = [];
        const values = new Map(prev.values);
        const overrides = new Map(prev.overrides);
        for (let j = 0; j < n; j++) {
          const r = rng();
          if (r < 0.4) {
            const key = pick(rng, p.inputKeys);
            const value = draw(rng, key, values.get(key) ?? 0);
            changes.push({ target: 'variable', cell: key, value });
            values.set(key, value);
          } else if (r < 0.7 || overrides.size === 0) {
            // Pin a node cell: at its current value (a no-op pin) or moved by up to ±20%.
            const cell = pick(rng, p.cellKeys);
            const current = prev.get(cell);
            const value = rng() < 0.2 ? current : current * (0.8 + 0.4 * rng());
            changes.push({ target: 'override', cell, value });
            overrides.set(cell, value);
          } else {
            const cell = pick(rng, [...overrides.keys()]);
            changes.push({ target: 'override', cell, value: null });
            overrides.delete(cell);
          }
        }
        const r = check(prev, changes, values, overrides, `#${i}`);
        if (r !== null) {
          prev = r;
          ok++;
        }
      }
      expect(ok).toBeGreaterThan(PIN_STEPS * 0.8);
    },
  );
});
