import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** One column as written in docs/spec/schema.json. */
export interface SpecColumn {
  name: string;
  type: string;
  constraints: string;
  description: string;
}

export interface SpecTable {
  scope: string;
  description?: string;
  columns: SpecColumn[];
}

export interface SpecSchema {
  spec_version: string;
  tables: Record<string, SpecTable>;
  views?: Record<string, string>;
}

const here = dirname(fileURLToPath(import.meta.url));

/** Repository root (tools/gen-schema/src -> repo root). */
export const repoRoot = resolve(here, '..', '..', '..');
export const schemaJsonPath = resolve(repoRoot, 'docs/spec/schema.json');
export const formulaGraphJsonPath = resolve(repoRoot, 'docs/spec/formula_graph.json');
export const seedDimensionMembersPath = resolve(repoRoot, 'docs/spec/seed/aa/dimension_members.json');
export const migrationsDir = resolve(repoRoot, 'tier3-data/migrations');

export function loadSchema(path: string = schemaJsonPath): SpecSchema {
  const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
  const s = raw as Partial<SpecSchema>;
  if (!s || typeof s.spec_version !== 'string' || !s.tables || typeof s.tables !== 'object') {
    throw new Error(`${path}: not a schema.json (missing spec_version or tables)`);
  }
  return s as SpecSchema;
}

/** One dimension of docs/spec/formula_graph.json. */
export interface SpecDimension {
  id: string;
  scope: string;
  attributes: string[];
}

/** One member of a system dimension, as in docs/spec/seed/aa/dimension_members.json. */
export type SpecMember = { id: string; label: string } & Record<string, string | number | boolean>;

/**
 * What the views need beyond schema.json: the dimensions of the formula graph (their scope and
 * attribute names) and the members of the `system` dimensions. System members belong to the model,
 * not to a tenant, and no table holds them, so the spec bundle is their only source.
 */
export interface ViewInputs {
  dimensions: SpecDimension[];
  /** dim id -> members in spec order. */
  members: Record<string, SpecMember[]>;
}

export function loadViewInputs(
  graphPath: string = formulaGraphJsonPath,
  membersPath: string = seedDimensionMembersPath,
): ViewInputs {
  const graph = JSON.parse(readFileSync(graphPath, 'utf8')) as { dimensions?: SpecDimension[] };
  if (!Array.isArray(graph.dimensions)) throw new Error(`${graphPath}: no dimensions`);
  const members = JSON.parse(readFileSync(membersPath, 'utf8')) as Record<string, SpecMember[]>;
  return { dimensions: graph.dimensions, members };
}
