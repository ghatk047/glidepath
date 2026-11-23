// Test support only (never exported by the package): reads docs/spec/schema.json, validated by the
// generated zod schema, for the tests that check domain types against the spec.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DbSchemaSchema, type DbSchema } from '@glidepath/spec/generated';

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

export const schemaJson: DbSchema = DbSchemaSchema.parse(
  JSON.parse(readFileSync(resolve(repoRoot, 'docs/spec/schema.json'), 'utf8')),
);

type TableName = keyof DbSchema['tables'];

/** Column names of a schema.json table, in spec order. */
export function columnsOf(table: TableName): string[] {
  return schemaJson.tables[table].columns.map((c) => c.name);
}

/** Labels of an `enum(a,b,c)` column, in spec order. */
export function enumOf(table: TableName, column: string): string[] {
  const col = schemaJson.tables[table].columns.find((c) => c.name === column);
  const m = col && /^enum\((.+)\)$/.exec(col.type);
  if (!m) throw new Error(`${table}.${column} is not an enum column`);
  return m[1]!.split(',').map((s) => s.trim());
}

/** Whether schema.json marks the column nullable. */
export function isNullable(table: TableName, column: string): boolean {
  const col = schemaJson.tables[table].columns.find((c) => c.name === column);
  if (!col) throw new Error(`${table}.${column} does not exist`);
  return /(^|,\s*)nullable\b/.test(col.constraints);
}
