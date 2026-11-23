import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderSchemaSql } from './ddl';
import { buildModel } from './model';
import { loadSchema, migrationsDir, type SpecSchema } from './spec';

/**
 * Generated migration files. DATA-02 (0002_rls.sql) and DATA-03 (0003_views.sql)
 * extend this list; hand-written SQL lives in tier3-data/migrations/manual/ (ADR-023).
 */
export const SCHEMA_MIGRATION = '0001_schema.sql';

/** filename -> content, for the given schema. Pure. */
export function generateMigrations(schema: SpecSchema): Map<string, string> {
  const model = buildModel(schema);
  return new Map([[SCHEMA_MIGRATION, renderSchemaSql(model)]]);
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
