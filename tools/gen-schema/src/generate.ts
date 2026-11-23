import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderSchemaSql } from './ddl';
import { buildModel } from './model';
import { renderRlsSql } from './rls';
import { loadSchema, loadViewInputs, migrationsDir, type SpecSchema, type ViewInputs } from './spec';
import { renderViewsSql } from './views';

/**
 * Generated migration files; hand-written SQL lives in tier3-data/migrations/manual/ (ADR-023).
 */
export const SCHEMA_MIGRATION = '0001_schema.sql';
/** Row-level security, policies and grants (DATA-02). */
export const RLS_MIGRATION = '0002_rls.sql';
/** The read views v_inputs_resolved and v_dimension_members (DATA-03). */
export const VIEWS_MIGRATION = '0003_views.sql';

/** filename -> content, for the given schema. Pure. */
export function generateMigrations(
  schema: SpecSchema,
  viewInputs: ViewInputs = loadViewInputs(),
): Map<string, string> {
  const model = buildModel(schema);
  return new Map([
    [SCHEMA_MIGRATION, renderSchemaSql(model)],
    [RLS_MIGRATION, renderRlsSql(model)],
    [VIEWS_MIGRATION, renderViewsSql(model, schema, viewInputs)],
  ]);
}

export interface CheckResult {
  ok: boolean;
  problems: string[];
}

/** Regenerates and compares with what is on disk (the CI regenerate-and-diff check). */
export function checkMigrations(dir: string = migrationsDir, schema: SpecSchema = loadSchema()): CheckResult {
  const problems: string[] = [];
  for (const [name, content] of generateMigrations(schema)) {
    const p = resolve(dir, name);
    if (!existsSync(p)) problems.push(`${name}: missing (run generate)`);
    else if (readFileSync(p, 'utf8') !== content) problems.push(`${name}: out of date with schema.json (run generate)`);
  }
  return { ok: problems.length === 0, problems };
}

export function writeMigrations(dir: string = migrationsDir, schema: SpecSchema = loadSchema()): string[] {
  mkdirSync(dir, { recursive: true });
  const written: string[] = [];
  for (const [name, content] of generateMigrations(schema)) {
    writeFileSync(resolve(dir, name), content);
    written.push(name);
  }
  return written;
}
