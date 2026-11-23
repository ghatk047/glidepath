import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildModel, INDEXES, loadSchema, schemaJsonPath } from '@glidepath/gen-schema';
import type { Model, ModelColumn, ModelTable } from '@glidepath/gen-schema';

/**
 * Generates the Drizzle table definitions (src/schema.ts) from
 * docs/spec/schema.json. The relational reading rules (keys, FKs, nullability,
 * enums, dependency order) are the ones that produce tier3-data/migrations
 * (tools/gen-schema `buildModel`), so schema.ts and the DDL cannot disagree on
 * structure; schema.test.ts additionally compares schema.ts with a migrated database.
 *
 *   tsx scripts/gen-drizzle.ts generate   rewrite src/schema.ts
 *   tsx scripts/gen-drizzle.ts check      regenerate in memory, fail on any diff (CI)
 */

const here = dirname(fileURLToPath(import.meta.url));
export const schemaTsPath = resolve(here, '..', 'src', 'schema.ts');

const q = (s: string): string => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const prop = (name: string): string => (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? `.${name}` : `[${q(name)}]`);

interface ColumnRender {
  /** Drizzle builder imports it needs. */
  imports: string[];
  expr: string;
}

function columnBuilder(c: ModelColumn): ColumnRender {
  const n = q(c.name);
  const t = c.sqlType;
  if (c.enumType) return { imports: [], expr: `${c.enumType.name}(${n})` };
  const array = t.endsWith('[]');
  const base = array ? t.slice(0, -2) : t;
  let expr: string;
  let imp: string[];
  switch (base) {
    case 'uuid':
      expr = `uuid(${n})`;
      imp = ['uuid'];
      break;
    case 'text':
      expr = `text(${n})`;
      imp = ['text'];
      break;
    case 'boolean':
      expr = `boolean(${n})`;
      imp = ['boolean'];
      break;
    case 'integer':
      expr = `integer(${n})`;
      imp = ['integer'];
      break;
    case 'bigserial':
      expr = `bigserial(${n}, { mode: 'number' })`;
      imp = ['bigserial'];
      break;
    case 'char(1)':
    case 'char(3)':
      expr = `char(${n}, { length: ${base.slice(5, -1)} })`;
      imp = ['char'];
      break;
    case 'citext':
      expr = `citext(${n})`;
      imp = [];
      break;
    case 'date':
      expr = `date(${n}, { mode: 'string' })`;
      imp = ['date'];
      break;
    case 'numeric':
      expr = `numeric(${n})`;
      imp = ['numeric'];
      break;
    case 'jsonb':
      expr = `jsonb(${n})`;
      imp = ['jsonb'];
      break;
    case 'timestamptz':
      expr = `timestamp(${n}, { withTimezone: true, mode: 'date' })`;
      imp = ['timestamp'];
      break;
    default:
      throw new Error(`gen-drizzle: no Drizzle mapping for column type "${t}" (${c.name})`);
  }
  if (array) expr += '.array()';
  return { imports: imp, expr };
}

function renderTable(t: ModelTable, imports: Set<string>): string {
  const lines: string[] = [];
  for (const c of t.columns) {
    const r = columnBuilder(c);
    r.imports.forEach((i) => imports.add(i));
    let expr = r.expr;
    if (c.notNull) expr += '.notNull()';
    if (c.defaultSql !== undefined) expr += `.default(${c.defaultSql})`;
    lines.push(`  ${/^[a-z_][a-z0-9_]*$/.test(c.name) ? c.name : q(c.name)}: ${expr},`);
  }
  const extras: string[] = [];
  const cols = (names: string[]): string => names.map((x) => `t${prop(x)}`).join(', ');
  imports.add('primaryKey');
  extras.push(`    primaryKey({ name: ${q(`${t.name}_pkey`)}, columns: [${cols(t.primaryKey)}] }),`);
  for (const u of t.uniques) {
    imports.add('unique');
    extras.push(`    unique(${q(u.name)}).on(${cols(u.columns)}),`);
  }
  for (const f of t.fks) {
    imports.add('foreignKey');
    const target = f.refTable === t.name ? 't' : f.refTable;
    const refCols = f.refColumns.map((x) => `${target}${prop(x)}`).join(', ');
    extras.push(
      `    foreignKey({ name: ${q(f.name)}, columns: [${cols(f.columns)}], foreignColumns: [${refCols}] }),`,
    );
  }
  for (const i of INDEXES.filter((x) => x.table === t.name)) {
    imports.add(i.unique ? 'uniqueIndex' : 'index');
    extras.push(`    ${i.unique ? 'uniqueIndex' : 'index'}(${q(i.name)}).on(${cols(i.columns)}),`);
  }
  imports.add('pgTable');
  return [
    `export const ${t.name} = pgTable(`,
    `  ${q(t.name)},`,
    `  {`,
    ...lines.map((l) => `  ${l}`),
    `  },`,
    `  (t) => [`,
    ...extras,
    `  ],`,
    `);`,
  ].join('\n');
}

/** Pure: Model -> contents of src/schema.ts. */
export function renderDrizzleSchema(model: Model): string {
  const names = new Set<string>();
  const claim = (n: string): void => {
    if (names.has(n)) throw new Error(`gen-drizzle: export name "${n}" is used twice (enum/table clash)`);
    names.add(n);
  };
  model.enums.forEach((e) => claim(e.name));
  model.tables.forEach((t) => claim(t.name));

  const imports = new Set<string>();
  const enumBlock = model.enums
    .map((e) => {
      imports.add('pgEnum');
      return `export const ${e.name} = pgEnum(${q(e.name)}, [${e.labels.map(q).join(', ')}]);`;
    })
    .join('\n');
  const tableBlock = model.tables.map((t) => renderTable(t, imports)).join('\n\n');
  const usesCitext = model.tables.some((t) => t.columns.some((c) => c.sqlType === 'citext'));
  if (usesCitext) imports.add('customType');

  const out: string[] = [
    `// GENERATED by tier2-logic/data-access/scripts/gen-drizzle.ts from docs/spec/schema.json (spec_version ${model.specVersion}). Do not edit.`,
    `// Regenerate: pnpm --filter @glidepath/data-access gen:drizzle`,
    `// Structure mirrors tier3-data/migrations/0001_schema.sql (same model, tools/gen-schema).`,
    ``,
    `import { ${[...imports].sort().join(', ')} } from 'drizzle-orm/pg-core';`,
    ``,
  ];
  if (usesCitext) {
    out.push(
      `/** Postgres citext (case-insensitive text); returned as string. */`,
      `const citext = customType<{ data: string }>({`,
      `  dataType() {`,
      `    return 'citext';`,
      `  },`,
      `});`,
      ``,
    );
  }
  out.push(
    enumBlock,
    ``,
    tableBlock,
    ``,
    `/** Every generated table by name, in dependency order. */`,
    `export const tables = {`,
    ...model.tables.map((t) => `  ${t.name},`),
    `} as const;`,
    ``,
  );
  return out.join('\n');
}

export function generateDrizzleSchema(): string {
  return renderDrizzleSchema(buildModel(loadSchema(schemaJsonPath)));
}

export interface CheckResult {
  ok: boolean;
  problems: string[];
}

/** The CI regenerate-and-diff check. */
export function checkDrizzleSchema(path: string = schemaTsPath, expected: string = generateDrizzleSchema()): CheckResult {
  if (!existsSync(path)) return { ok: false, problems: [`${path}: missing (run gen:drizzle)`] };
  if (readFileSync(path, 'utf8') !== expected) {
    return { ok: false, problems: [`${path}: out of date with schema.json (run gen:drizzle)`] };
  }
  return { ok: true, problems: [] };
}

export function writeDrizzleSchema(path: string = schemaTsPath): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, generateDrizzleSchema());
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const mode = process.argv[2] ?? 'generate';
  if (mode === 'check') {
    const r = checkDrizzleSchema();
    if (!r.ok) {
      for (const p of r.problems) console.error(`gen-drizzle: ${p}`);
      process.exit(1);
    }
    console.log('gen-drizzle: src/schema.ts is up to date with schema.json');
  } else if (mode === 'generate') {
    writeDrizzleSchema();
    console.log('gen-drizzle: wrote src/schema.ts');
  } else {
    console.error('usage: gen-drizzle.ts [generate|check]');
    process.exit(2);
  }
}
