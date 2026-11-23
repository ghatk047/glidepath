/**
 * Generates the spec-derived contract fixtures in `src/fixtures/spec/` (CON-04).
 *
 * Every value comes from `docs/spec` (registry, formula graph, AA seed) and
 * `docs/spec/reference/golden_results.json`; nothing here is a business number. The script
 * only renames fields to the wire format and checks each file against the contract schemas.
 * `src/fixtures/spec-fixtures.spec.ts` regenerates in memory and diffs against the files on
 * disk, so a spec change without a regeneration fails the tests.
 *
 *   pnpm --filter @glidepath/api-contract gen:fixtures
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { z } from 'zod';
import { BundleResponse, Member, MembersResponse, ScenariosResponse } from '../src/core';
import { Snapshot, WS_PROTOCOL_VERSION } from '../src/ws';

const here = fileURLToPath(new URL('.', import.meta.url));

/** `docs/spec` of this repository. */
export const defaultSpecDir = resolve(here, '..', '..', '..', 'docs', 'spec');
/** Where the generated files live (relative names below are inside it). */
export const fixturesOutDir = resolve(here, '..', 'src', 'fixtures', 'spec');

/** Ids that tier 3 assigns at seed time; fixtures derive them from spec ids, deterministically. */
const scenarioIdOf = (key: string) => `sc-${key}`;
const modelVersionIdOf = (semver: string) => `mv-${semver}`;
/**
 * Fixture clock for `createdAt` (the spec carries no timestamps; tier 3 stamps rows at seed).
 * A display value only, never used in a calculation.
 */
const FIXTURE_CREATED_AT = '2026-11-23T00:00:00.000Z';

/**
 * Golden groups → formula node prefix: `levers.<L>.<x>` is `lev.<x>[<L>]`,
 * `vp.<vp>.<x>` is `vp.<x>[<vp>]` (the same reading as tools/testkit `golden()`).
 */
const goldenGroups = { levers: { node: 'lev', dim: 'lever' }, vp: { node: 'vp', dim: 'vp' } };

// ---------------------------------------------------------------------------
// Spec file shapes (only the fields read here)
// ---------------------------------------------------------------------------

interface SpecVariable {
  id: string;
  label: string;
  unit: string;
  type: string;
  kind: string;
  dims: string[];
  min: number | null;
  max: number | null;
  step: number | null;
  group: string;
  layer: string;
  role: string;
  ui: { control: string; hero: boolean };
  source: string;
  confidence: string;
  note: string;
  scenario_varies: boolean;
}
interface SpecNode {
  id: string;
  label: string;
  unit: string;
  dims: string[];
  layer: string;
  output: boolean;
  overridable?: boolean;
  expr?: string;
  cases?: { expr: string }[];
}
interface SpecDimension {
  id: string;
  label: string;
  scope: string;
  attributes: string[];
}
type SeedValue = number | Record<string, number>;
interface SeedScenarios {
  tenant: string;
  default_scenario: string;
  scenarios: { id: string; label: string; values: Record<string, SeedValue> }[];
}
interface Golden {
  scenarios: Record<string, Record<string, number | Record<string, Record<string, number>>>>;
}

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;

function fail(msg: string): never {
  throw new Error(`generate-fixtures: ${msg}`);
}

function check<S extends z.ZodType>(schema: S, value: z.input<S>, what: string): z.input<S> {
  const r = schema.safeParse(value);
  if (!r.success) fail(`${what} does not match the contract: ${r.error.message}`);
  return value;
}

const cell = (id: string, member = '') => `${id}[${member}]`;

/**
 * Percent scale (WEB-10). The same rule as tier 2's bundle builder (`@glidepath/spec`
 * `percent-scale.ts`, which this package may not import): percent family = unit starts with `%`;
 * layer `corporate` is percentage points; a node whose every expression ends in `* 100` is
 * points; everything else is a fraction. `percent-scale-parity.test.ts` in tier 2's server
 * checks the generated bundle against the real builder rule for every variable and node.
 */
const isPercentUnit = (unit: string) => unit.startsWith('%');
function endsInTimes100(expr: string): boolean {
  const text = expr.trim();
  if (!/\*\s*100$/.test(text)) return false;
  let depth = 0;
  for (const ch of text) {
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    else if (depth === 0 && (ch === '+' || ch === '-')) return false;
  }
  return depth === 0;
}
const variableScale = (v: SpecVariable): 'fraction' | 'points' | null =>
  !isPercentUnit(v.unit) ? null : v.layer === 'corporate' ? 'points' : 'fraction';
function nodeScale(n: SpecNode): 'fraction' | 'points' | null {
  if (!isPercentUnit(n.unit)) return null;
  if (n.layer === 'corporate') return 'points';
  const exprs = [...(n.cases ?? []).map((c) => c.expr), ...(n.expr !== undefined ? [n.expr] : [])];
  return exprs.length > 0 && exprs.every(endsInTimes100) ? 'points' : 'fraction';
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

/** Generated file name → file content. Pure apart from reading `specDir`. */
export function generateSpecFixtures(specDir: string = defaultSpecDir): Map<string, string> {
  const registry = readJson<{ spec_version: string; variables: SpecVariable[] }>(
    join(specDir, 'variables.json'),
  );
  const graph = readJson<{ spec_version: string; dimensions: SpecDimension[]; nodes: SpecNode[] }>(
    join(specDir, 'formula_graph.json'),
  );
  const seedDir = join(specDir, 'seed');
  const tenants = readdirSync(seedDir, { withFileTypes: true }).filter((e) => e.isDirectory());
  if (tenants.length !== 1) fail(`expected one seed tenant in ${seedDir}`);
  const tenantDir = join(seedDir, tenants[0]!.name);
  const seedMembers = readJson<Record<string, Record<string, unknown>[]>>(
    join(tenantDir, 'dimension_members.json'),
  );
  const seedValues = readJson<Record<string, SeedValue>>(join(tenantDir, 'variable_values.json'));
  const seedScenarios = readJson<SeedScenarios>(join(tenantDir, 'scenarios.json'));
  const golden = readJson<Golden>(join(specDir, 'reference', 'golden_results.json'));

  if (registry.spec_version !== graph.spec_version) fail('registry and graph versions differ');
  const modelVersion = {
    id: modelVersionIdOf(registry.spec_version),
    semver: registry.spec_version,
  };

  // --- bundle: definitions and labels only (no expressions, no tenant values) -------------
  const bundle = check(
    BundleResponse,
    {
      modelVersion,
      variables: registry.variables.map((v) => ({
        id: v.id,
        label: v.label,
        unit: v.unit,
        type: v.type,
        kind: v.kind,
        dims: v.dims,
        min: v.min,
        max: v.max,
        step: v.step,
        group: v.group,
        layer: v.layer,
        role: v.role,
        ui: { control: v.ui.control, hero: v.ui.hero },
        source: v.source,
        confidence: v.confidence,
        note: v.note,
        scenarioVaries: v.scenario_varies,
        percentScale: variableScale(v),
      })) as z.input<typeof BundleResponse>['variables'],
      nodes: graph.nodes.map((n) => ({
        id: n.id,
        label: n.label,
        unit: n.unit,
        dims: n.dims,
        layer: n.layer,
        output: n.output,
        // 03b: "Every node is overridable (pinnable) per scenario unless noted."
        overridable: n.overridable ?? true,
        percentScale: nodeScale(n),
      })),
      dimensions: graph.dimensions.map((d) => ({
        id: d.id,
        label: d.label,
        scope: d.scope,
        attributes: d.attributes,
      })) as z.input<typeof BundleResponse>['dimensions'],
    },
    'bundle',
  );

  // --- members: every dimension of the graph, members from the tenant seed -----------------
  const memberIds = new Map<string, Set<string>>();
  const dimensions: z.input<typeof MembersResponse>['dimensions'] = {};
  for (const dim of graph.dimensions) {
    const rows = seedMembers[dim.id] ?? [];
    memberIds.set(dim.id, new Set(rows.map((r) => String(r.id))));
    dimensions[dim.id] = rows.map((row) => {
      const { id, label, ...attrs } = row;
      if (typeof id !== 'string') fail(`member of '${dim.id}' without a string id`);
      const shown =
        typeof label === 'string' ? label : typeof attrs.name === 'string' ? attrs.name : id;
      return {
        key: id,
        label: shown,
        attrs: attrs as z.input<typeof Member>['attrs'],
        sort: Number.isInteger(attrs.order) ? (attrs.order as number) : null,
        active: true,
      };
    });
  }
  const membersHash = `sha256:${createHash('sha256').update(JSON.stringify(dimensions)).digest('hex')}`;
  const members = check(MembersResponse, { membersHash, dimensions }, 'members');

  // --- scenarios: the seeded presets (read-only; tier 2 forks on edit) ----------------------
  const scenarios = check(
    ScenariosResponse,
    {
      scenarios: seedScenarios.scenarios.map((s) => ({
        id: scenarioIdOf(s.id),
        key: s.id,
        label: s.label,
        kind: 'preset' as const,
        parentId: null,
        modelVersionId: modelVersion.id,
        version: 0,
        editsCount: 0,
        locked: true,
        archived: false,
        createdBy: null,
        createdAt: FIXTURE_CREATED_AT,
      })),
    },
    'scenarios',
  );

  // --- snapshots: golden outputs + resolved preset inputs, per preset -----------------------
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  const variables = new Map(registry.variables.map((v) => [v.id, v]));
  const outputCell = (key: string): string => {
    const m = /^([^[\]]+)(?:\[([^[\]]*)\])?$/.exec(key);
    if (!m || !nodes.has(m[1]!)) fail(`golden key '${key}' is not a formula node`);
    return cell(m[1]!, m[2] ?? '');
  };
  const inputCells = (values: Record<string, SeedValue>, scenario: string) => {
    const out: Record<string, number> = {};
    for (const [id, value] of Object.entries(values)) {
      if (!variables.has(id)) fail(`seed value '${id}' (${scenario}) is not in the registry`);
      if (typeof value === 'number') out[cell(id)] = value;
      else
        for (const [member, v] of Object.entries(value)) {
          if (typeof v !== 'number') fail(`seed value '${id}[${member}]' is not a number`);
          out[cell(id, member)] = v;
        }
    }
    return out;
  };
  const tenantInputs = inputCells(seedValues, 'tenant default');

  const snapshots: Record<string, z.input<typeof Snapshot>> = {};
  for (const preset of seedScenarios.scenarios) {
    const results = golden.scenarios[preset.id];
    if (!results) fail(`golden_results.json has no scenario '${preset.id}'`);
    const cells: Record<string, number> = {};
    for (const [key, value] of Object.entries(results)) {
      if (typeof value === 'number') {
        cells[outputCell(key)] = value;
        continue;
      }
      const group = goldenGroups[key as keyof typeof goldenGroups];
      if (!group) fail(`golden group '${key}' has no node mapping`);
      for (const [member, fields] of Object.entries(value)) {
        if (!memberIds.get(group.dim)?.has(member)) fail(`'${member}' is not a ${group.dim}`);
        for (const [field, v] of Object.entries(fields)) {
          const node = nodes.get(`${group.node}.${field}`);
          if (!node || node.dims.join() !== group.dim) fail(`no ${group.dim} node for '${field}'`);
          cells[cell(node.id, member)] = v;
        }
      }
    }
    // v_inputs_resolved for a preset (no parent): the scenario's value, else the tenant default.
    const inputs = { ...tenantInputs, ...inputCells(preset.values, preset.id) };
    for (const [k, v] of Object.entries(inputs)) {
      if (k in cells) fail(`cell '${k}' is both an output and an input`);
      cells[k] = v;
    }
    snapshots[preset.id] = check(
      Snapshot,
      {
        v: WS_PROTOCOL_VERSION,
        type: 'snapshot',
        scenarioId: scenarioIdOf(preset.id),
        version: 0,
        cells,
      },
      `snapshot ${preset.id}`,
    );
  }
  if (!(seedScenarios.default_scenario in snapshots)) fail('default scenario has no snapshot');

  const meta = {
    generatedBy: 'contract/api-contract/scripts/generate-fixtures.ts (do not edit by hand)',
    sources: [
      'docs/spec/variables.json',
      'docs/spec/formula_graph.json',
      `docs/spec/seed/${tenants[0]!.name}/*.json`,
      'docs/spec/reference/golden_results.json',
    ],
    tenant: seedScenarios.tenant,
    defaultScenario: seedScenarios.default_scenario,
    modelVersion,
  };

  const json = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`;
  return new Map([
    ['meta.json', json(meta)],
    ['bundle.json', json(bundle)],
    ['members.json', json(members)],
    ['scenarios.json', json(scenarios)],
    ['snapshots.json', json(snapshots)],
  ]);
}

/** Rewrites `src/fixtures/spec/` from the spec. */
export function writeSpecFixtures(outDir = fixturesOutDir, specDir = defaultSpecDir): string[] {
  const files = generateSpecFixtures(specDir);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  for (const [name, content] of files) writeFileSync(join(outDir, name), content);
  return [...files.keys()];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const written = writeSpecFixtures();
  console.log(`wrote ${written.length} files to ${fixturesOutDir}: ${written.join(', ')}`);
}
