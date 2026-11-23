import { jsonPath, SpecValidationError, type SpecIssue } from './errors';
import { TenantSeedJsonSchema } from './seed-schemas';
import type { ModelBundle, TenantMembers, VarId } from './types';

/** Cell key as in `engine.py` (`Model.key`): `vid` for a scalar, `vid[m1,m2]` for a dimensioned variable. */
export type CellKey = string;

/** A tenant default or scenario value: scalar, or `{ memberKey: value }` where memberKey is the comma-joined member ids. */
export type InputValue = number | Readonly<Record<string, number>>;

export interface TenantInfo {
  readonly id: string;
  readonly name: string;
  readonly currency: string;
  readonly [field: string]: unknown;
}

export interface SeedScenario {
  readonly id: string;
  readonly label: string;
  readonly values: Readonly<Record<VarId, InputValue>>;
  /** Pinned node cells, keyed by cell key. */
  readonly overrides?: Readonly<Record<CellKey, number>>;
  readonly [field: string]: unknown;
}

export interface SeedScenarios {
  readonly tenant: string;
  readonly default_scenario: string;
  readonly scenarios: readonly SeedScenario[];
}

export interface LeverLibraryEntry {
  readonly id: string;
  readonly label: string;
  readonly [field: string]: unknown;
}

/** The five files of `seed/<tenant>/`, validated. Shapes and ids are the files', verbatim. */
export interface TenantSeed {
  /** `tenant.json` */
  readonly tenant: TenantInfo;
  /** `dimension_members.json`: members with all their attributes (`line.pool`, `line.domain`, ...). */
  readonly dimensionMembers: TenantMembers;
  /** `variable_values.json`: every input's tenant default. */
  readonly variableValues: Readonly<Record<VarId, InputValue>>;
  /** `scenarios.json` */
  readonly scenarios: SeedScenarios;
  /** `lever_library.json` */
  readonly leverLibrary: { readonly levers: readonly LeverLibraryEntry[] };
}

/** The raw, already `JSON.parse`d contents of the five seed files. */
export interface TenantSeedJson {
  readonly tenant: unknown;
  readonly dimensionMembers: unknown;
  readonly variableValues: unknown;
  readonly scenarios: unknown;
  readonly leverLibrary: unknown;
}

/** Resolved inputs of one scenario, ready for `compile()` / `evaluate()` (docs/architecture/03 §1). */
export interface TenantData {
  /** Members with attributes, for where-filters. */
  readonly members: TenantMembers;
  /** Resolved inputs: tenant defaults, then the scenario's values. */
  readonly values: Map<CellKey, number>;
  /** Node cells pinned by the scenario (`node_override`). */
  readonly overrides: Map<CellKey, number>;
}

/**
 * Validate the five parsed seed files. Pure: no IO (the node adapter `readTenantSeed` in `@glidepath/spec/node`
 * reads the files). Throws `SpecValidationError` listing every problem with its JSON path
 * (`$.scenarios.scenarios[2].values['g.head_start']`, `$.dimensionMembers.line[7].id`, ...).
 */
export function parseTenantSeed(json: TenantSeedJson): TenantSeed {
  const parsed = TenantSeedJsonSchema.safeParse(json);
  if (!parsed.success) {
    throw new SpecValidationError(parsed.error.issues.map((i) => ({ path: jsonPath(i.path), message: i.message })));
  }
  const seed = parsed.data;
  const issues: SpecIssue[] = [];

  for (const [dim, members] of Object.entries(seed.dimensionMembers)) {
    const seen = new Set<string>();
    members.forEach((m, i) => {
      if (seen.has(m.id)) {
        issues.push({ path: jsonPath(['dimensionMembers', dim, i, 'id']), message: `duplicate member id '${m.id}' in dimension '${dim}'` });
      }
      seen.add(m.id);
    });
  }
  const scenarioIds = new Set<string>();
  seed.scenarios.scenarios.forEach((s, i) => {
    if (scenarioIds.has(s.id)) {
      issues.push({ path: jsonPath(['scenarios', 'scenarios', i, 'id']), message: `duplicate scenario id '${s.id}'` });
    }
    scenarioIds.add(s.id);
  });
  if (!scenarioIds.has(seed.scenarios.default_scenario)) {
    issues.push({
      path: jsonPath(['scenarios', 'default_scenario']),
      message: `default_scenario '${seed.scenarios.default_scenario}' is not one of the scenarios`,
    });
  }
  if (issues.length > 0) throw new SpecValidationError(issues);
  return seed as unknown as TenantSeed;
}

/**
 * Resolve a seed into the inputs of one scenario, reproducing `Model.input_cells` of `reference/engine.py`:
 * tenant defaults, then the scenario's `values` (last wins), plus the scenario's node `overrides`.
 * Without `scenarioId` only the tenant defaults resolve (as in Python; `default_scenario` is not applied).
 *
 * A dimensioned variable's value is `{ memberKey: x }` and becomes the cell `vid[memberKey]`; a scalar variable's
 * becomes the cell `vid`. A scenario dict overlays only the member keys it lists.
 *
 * `bundle` supplies each variable's `dims`. With it, a scalar given for a dimensioned variable throws (Python:
 * `ValueError: <vid> needs per-member values`), and so do an unknown variable id, a per-member dict given for a
 * scalar variable, and a member key with the wrong number of members. Without it the shape of each value decides.
 *
 * Throws `SpecValidationError` (JSON path of the offending value) or, for an unknown `scenarioId`, a plain `Error`.
 */
export function seedToTenantData(
  seed: TenantSeed,
  scenarioId?: string,
  bundle?: Pick<ModelBundle, 'variables'>,
): TenantData {
  const dimsOf = new Map<string, number>();
  for (const v of bundle?.variables ?? []) dimsOf.set(v.id, v.dims.length);

  const values = new Map<CellKey, number>();
  const put = (vid: string, v: InputValue, path: string): void => {
    const nDims = bundle ? dimsOf.get(vid) : typeof v === 'number' ? 0 : 1;
    if (nDims === undefined) throw new SpecValidationError([{ path, message: `unknown variable '${vid}'` }]);
    if (typeof v === 'number') {
      if (nDims > 0) throw new SpecValidationError([{ path, message: `${vid} needs per-member values` }]);
      values.set(vid, v);
      return;
    }
    if (nDims === 0) throw new SpecValidationError([{ path, message: `${vid} is a scalar variable but has per-member values` }]);
    for (const [memberKey, x] of Object.entries(v)) {
      if (bundle && memberKey.split(',').length !== nDims) {
        throw new SpecValidationError([
          { path: `${path}[${JSON.stringify(memberKey)}]`, message: `member key '${memberKey}' needs ${nDims} member(s) for ${vid}` },
        ]);
      }
      values.set(`${vid}[${memberKey}]`, x);
    }
  };

  for (const [vid, v] of Object.entries(seed.variableValues)) put(vid, v, jsonPath(['variableValues', vid]));

  const overrides = new Map<CellKey, number>();
  if (scenarioId !== undefined && scenarioId !== '') {
    const index = seed.scenarios.scenarios.findIndex((s) => s.id === scenarioId);
    const scenario = seed.scenarios.scenarios[index];
    if (!scenario) throw new Error(`unknown scenario '${scenarioId}'`);
    for (const [vid, v] of Object.entries(scenario.values)) {
      put(vid, v, jsonPath(['scenarios', 'scenarios', index, 'values', vid]));
    }
    for (const [cell, x] of Object.entries(scenario.overrides ?? {})) overrides.set(cell, x);
  }

  return { members: seed.dimensionMembers, values, overrides };
}
