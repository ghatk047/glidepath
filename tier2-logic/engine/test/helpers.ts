/**
 * Test support (not shipped): the AA spec and seed from docs/spec, Python fixtures, and a builder for
 * small synthetic bundles. Tests may do IO; the engine source may not.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Member, ModelBundle, TenantMembers, TenantSeed } from '@glidepath/spec';
import { loadModelBundleFromDir, readTenantSeed } from '@glidepath/spec/node';

const here = dirname(fileURLToPath(import.meta.url));
export const repo = resolve(here, '../../..');
export const fixturesDir = resolve(here, 'fixtures');

let aa: Promise<{ bundle: ModelBundle; seed: TenantSeed }> | undefined;

/** The real spec (307 nodes) and the seed tenant (`docs/spec/seed/aa`), loaded once per test file. */
export function loadSeedModel(): Promise<{ bundle: ModelBundle; seed: TenantSeed }> {
  aa ??= Promise.all([
    loadModelBundleFromDir(resolve(repo, 'docs/spec')),
    readTenantSeed(resolve(repo, 'docs/spec/seed/aa')),
  ]).then(([bundle, seed]) => ({ bundle, seed }));
  return aa;
}

export function readFixture<T>(name: string): T {
  return JSON.parse(readFileSync(resolve(fixturesDir, name), 'utf8')) as T;
}

/** `deps.json` written by `test/fixtures/dump_deps.py` from the unchanged engine.py. */
export interface DepsFixture {
  sources: Record<string, string>;
  cell_count: number;
  edge_count: number;
  order: string[];
  exprs: string[];
  /** In expansion order. */
  cells: Record<string, { expr: number; deps: string[] }>;
}

type NodeSpec = {
  id: string;
  dims?: string[];
  expr?: string;
  cases?: { when: Record<string, string[]> | null; expr: string }[];
  members?: Record<string, string[]>;
};
type VarSpec = { id: string; dims?: string[] };

/** A synthetic bundle with only the fields the engine reads (the spec loader is not involved). */
export function bundleOf(spec: { variables?: VarSpec[]; nodes: NodeSpec[] }): ModelBundle {
  return {
    variables: (spec.variables ?? []).map((v) => ({
      id: v.id,
      kind: 'decision',
      label: v.id,
      unit: '',
      type: 'number',
      dims: v.dims ?? [],
      min: null,
      max: null,
      step: null,
      layer: 'test',
      role: 'driver',
      ui: { control: 'slider', hero: false },
      scenario_varies: false,
    })),
    nodes: spec.nodes.map((n) => ({
      id: n.id,
      dims: n.dims ?? [],
      unit: '',
      label: n.id,
      layer: 'test',
      output: false,
      ...(n.expr !== undefined ? { expr: n.expr } : {}),
      ...(n.cases ? { cases: n.cases } : {}),
      ...(n.members ? { members: n.members } : {}),
    })),
    dimensions: [],
    specVersion: 'test',
    modelId: 'test',
    units: '',
    expressionLanguage: 'test',
    layers: ['test'],
  };
}

/** Members from `{dim: [id | {id, ...attrs}]}`. */
export function membersOf(spec: Record<string, (string | Member)[]>): TenantMembers {
  return Object.fromEntries(
    Object.entries(spec).map(([d, ms]) => [
      d,
      ms.map((m) => (typeof m === 'string' ? { id: m } : m)),
    ]),
  );
}
