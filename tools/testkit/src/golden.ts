import { readFileSync } from 'node:fs';
import { goldenResultsPath } from './paths';

/** Shape of `docs/spec/reference/golden_results.json`. */
export interface GoldenFile {
  note: string;
  scenarios: Record<string, Record<string, unknown>>;
  unified_minus_v03: Record<string, Record<string, number>>;
}

let cache: GoldenFile | undefined;

export function goldenFile(): GoldenFile {
  cache ??= JSON.parse(readFileSync(goldenResultsPath, 'utf8')) as GoldenFile;
  return cache;
}

/** Scenario ids in the file (`rates`, `A`, `B`, `C`, `D`). */
export function goldenScenarios(): string[] {
  return Object.keys(goldenFile().scenarios);
}

function scenarioOf(scenario: string): Record<string, unknown> {
  const s = goldenFile().scenarios[scenario];
  if (!s) throw new Error(`golden: unknown scenario '${scenario}' (have ${goldenScenarios().join(', ')})`);
  return s;
}

/**
 * Golden value of `key` in `scenario`. Keys are the spec's, verbatim:
 * a flat key (`res.net`, `pl.eps[fy27b]`), a lever cell `levers.<L>.<rr|iy|ot|cx>`
 * or a VP cell `vp.<vp_id>.<outlay|net|...>`.
 */
export function golden(scenario: string, key: string): number {
  const s = scenarioOf(scenario);
  const flat = s[key];
  if (typeof flat === 'number') return flat;
  const [head, ...rest] = key.split('.');
  if ((head === 'levers' || head === 'vp') && rest.length === 2) {
    const group = s[head] as Record<string, Record<string, unknown>>;
    const v = group[rest[0] as string]?.[rest[1] as string];
    if (typeof v === 'number') return v;
  }
  throw new Error(`golden: no key '${key}' in scenario '${scenario}'`);
}

/** Every golden value of a scenario as `key -> value` (flat keys, then `levers.L.x`, `vp.v.x`). */
export function goldenEntries(scenario: string): Map<string, number> {
  const s = scenarioOf(scenario);
  const out = new Map<string, number>();
  for (const [k, v] of Object.entries(s)) {
    if (typeof v === 'number') {
      out.set(k, v);
    } else if (k === 'levers' || k === 'vp') {
      for (const [id, cells] of Object.entries(v as Record<string, Record<string, number>>)) {
        for (const [c, n] of Object.entries(cells)) out.set(`${k}.${id}.${c}`, n);
      }
    }
  }
  return out;
}

/** `unified_minus_v03` delta for a scenario/key (the documented difference to spec v0.3). */
export function goldenDeltaV03(scenario: string, key: string): number {
  const v = goldenFile().unified_minus_v03[scenario]?.[key];
  if (typeof v !== 'number') throw new Error(`golden: no v0.3 delta '${key}' in scenario '${scenario}'`);
  return v;
}

/** Comparison used by the parity gate: |a-b| <= max(rel * |b|, abs). */
export function closeToGolden(actual: number, expected: number, rel = 1e-6, abs = 1e-9): boolean {
  return Math.abs(actual - expected) <= Math.max(rel * Math.abs(expected), abs);
}
