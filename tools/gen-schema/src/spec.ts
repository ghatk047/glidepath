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
export const migrationsDir = resolve(repoRoot, 'tier3-data/migrations');

export function loadSchema(path: string = schemaJsonPath): SpecSchema {
  const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
  const s = raw as Partial<SpecSchema>;
  if (!s || typeof s.spec_version !== 'string' || !s.tables || typeof s.tables !== 'object') {
    throw new Error(`${path}: not a schema.json (missing spec_version or tables)`);
  }
  return s as SpecSchema;
}
