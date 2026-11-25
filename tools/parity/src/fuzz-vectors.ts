/**
 * Fuzz vectors (G4, PORTING.md §6 Fuzz step 1): seeded random input vectors within the registry bounds
 * of `variables.json`. Vector `i` starts from the tenant's preset `i mod 5` (scenarios in file order);
 * the first half are local (1-8 bounded variables re-drawn), the second half global (every bounded
 * variable re-drawn). Every member cell of a dimensioned variable is drawn independently; `int`, `bool`
 * and `enum` values are snapped to `min + k * step`. Unbounded variables keep their resolved value.
 *
 * The `edge` set draws the same way but puts a share of the values on `min`, `max` or 0. Within the
 * registry bounds the reference does not raise (every variable used as a divisor has a positive
 * minimum; ENG-10 measured 0 raising uniform vectors on both tenants), so 0, even outside a variable's
 * bounds, is what makes it raise (`ZeroDivisionError`) and exercises "raises in TS ⇔ raises in Python".
 */
import { findScenario, resolveInputs } from '@glidepath/engine';
import type { InputValue, ModelBundle, TenantSeed, VariableDef } from '@glidepath/spec';

/** Default PRNG seed of `pnpm parity:fuzz` (recorded in the report; `--seed` replays another). */
export const DEFAULT_FUZZ_SEED = 0x5eed_0010;
/** G4: random vectors per tenant. */
export const UNIFORM_VECTORS = 200;
/** Extra vectors per tenant with values on the bounds (raise parity). */
export const EDGE_VECTORS = 100;
/** Local vectors re-draw 1 … this many bounded variables. */
export const LOCAL_MAX_VARIABLES = 8;
/** Edge vectors: share of drawn values put on `min` or `max` (half each). */
export const EDGE_SHARE = 0.2;
/** Presets cycled through by vector index (PORTING.md §6: `[rates, A, B, C, D][i mod 5]`). */
const PRESET_CYCLE = 5;
/** Types drawn on the `min + k * step` grid. */
const STEPPED: ReadonlySet<VariableDef['type']> = new Set(['int', 'bool', 'enum']);
/** Slack when counting grid points, so `(max - min) / step` that lands a hair under an integer counts it. */
const GRID_EPS = 1e-9;

export type VectorSet = 'uniform' | 'edge';
export type VectorKind = 'local' | 'global';

/** Values layered on a preset as `extra.values` (`Model.run(preset, {values})`). */
export type VectorValues = Readonly<Record<string, InputValue>>;

export interface FuzzVector {
  /** Index within its set. */
  readonly index: number;
  readonly set: VectorSet;
  readonly kind: VectorKind;
  readonly preset: string;
  readonly values: VectorValues;
}

/** A registry variable with both bounds. */
export type BoundedVariable = VariableDef & { readonly min: number; readonly max: number };

/** mulberry32: a small seeded PRNG, uniform in [0, 1). */
export function rngOf(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Variables with both `min` and `max` in the registry, in registry order. */
export function boundedVariables(bundle: Pick<ModelBundle, 'variables'>): BoundedVariable[] {
  return bundle.variables.filter((v): v is BoundedVariable => v.min !== null && v.max !== null);
}

/** Grid points `min + k * step`, k = 0 … n - 1, of a stepped variable. */
function gridSize(v: BoundedVariable): number {
  const step = v.step ?? 1;
  return Math.floor((v.max - v.min) / step + GRID_EPS) + 1;
}

/**
 * One value of `v`: uniform in `[min, max]` (on the step grid for `int`, `bool`, `enum`); with
 * probability `edgeShare`, one of `min`, `max` and 0 instead.
 */
export function drawValue(v: BoundedVariable, rng: () => number, edgeShare = 0): number {
  if (edgeShare > 0 && rng() < edgeShare) {
    const edges = [v.min, v.max, 0];
    return edges[Math.floor(rng() * edges.length)]!;
  }
  if (!STEPPED.has(v.type)) return v.min + rng() * (v.max - v.min);
  return v.min + Math.floor(rng() * gridSize(v)) * (v.step ?? 1);
}

/** `vid` → member keys (`'a,b'`) of its resolved cells, or `null` for a scalar that has a value. */
function cellsByVariable(
  bundle: Pick<ModelBundle, 'variables'>,
  values: ReadonlyMap<string, number>,
): Map<string, string[] | null> {
  const dims = new Map(bundle.variables.map((v) => [v.id, v.dims.length]));
  const out = new Map<string, string[] | null>();
  for (const key of values.keys()) {
    const open = key.indexOf('[');
    if (open < 0) {
      out.set(key, null);
      continue;
    }
    const vid = key.slice(0, open);
    if (!dims.get(vid)) continue;
    const list = out.get(vid) ?? [];
    list.push(key.slice(open + 1, -1));
    out.set(vid, list);
  }
  return out;
}

export interface DrawOptions {
  readonly seed: number;
  readonly count: number;
  readonly set: VectorSet;
}

/**
 * `count` vectors for one tenant. Deterministic for a given seed, bundle and seed tenant. Bounded
 * variables without a resolved cell in the tenant are skipped (nothing to re-draw).
 */
export function drawVectors(
  bundle: Pick<ModelBundle, 'variables'>,
  tenant: Pick<TenantSeed, 'variableValues' | 'scenarios'>,
  options: DrawOptions,
): FuzzVector[] {
  const rng = rngOf(options.seed);
  const edgeShare = options.set === 'edge' ? EDGE_SHARE : 0;
  const presets = tenant.scenarios.scenarios.slice(0, PRESET_CYCLE).map((s) => s.id);
  const cells = new Map(
    presets.map((id) => {
      const resolved = resolveInputs(
        bundle,
        tenant.variableValues,
        findScenario(tenant.scenarios, id),
      );
      return [id, cellsByVariable(bundle, resolved.values)] as const;
    }),
  );
  const bounded = boundedVariables(bundle);
  const half = Math.floor(options.count / 2);
  const out: FuzzVector[] = [];
  for (let index = 0; index < options.count; index++) {
    const preset = presets[index % presets.length]!;
    const own = cells.get(preset)!;
    const candidates = bounded.filter((v) => own.has(v.id));
    const kind: VectorKind = index < half ? 'local' : 'global';
    const chosen =
      kind === 'global'
        ? candidates
        : sample(rng, candidates, 1 + Math.floor(rng() * LOCAL_MAX_VARIABLES));
    const values: Record<string, InputValue> = {};
    for (const v of chosen) {
      const members = own.get(v.id)!;
      values[v.id] =
        members === null
          ? drawValue(v, rng, edgeShare)
          : Object.fromEntries(members.map((m) => [m, drawValue(v, rng, edgeShare)]));
    }
    out.push({ index, set: options.set, kind, preset, values });
  }
  return out;
}

/** `k` distinct elements of `xs` (partial Fisher-Yates on a copy), in draw order. */
function sample<T>(rng: () => number, xs: readonly T[], k: number): T[] {
  const pool = xs.slice();
  const n = Math.min(k, pool.length);
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(rng() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  return pool.slice(0, n);
}
