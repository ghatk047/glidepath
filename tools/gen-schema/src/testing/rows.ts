import { randomUUID } from 'node:crypto';
import { ident } from '../ddl';
import type { ModelColumn, ModelTable } from '../model';

/** A row as text values (NULL = null), cast to the column types on insert. */
export type Row = Record<string, string | null>;

/** A type-valid placeholder value (no business meaning; tests only). */
function placeholder(c: ModelColumn, label: string): string {
  if (c.enumType) return c.enumType.labels[0]!;
  switch (c.sqlType) {
    case 'uuid':
      return randomUUID();
    case 'text':
    case 'citext':
      return `${label}-${c.name}`;
    case 'boolean':
      return 'false';
    case 'integer':
    case 'numeric':
      return '0';
    case 'char(1)':
      return 'x';
    case 'char(3)':
      return 'xxx';
    case 'date':
      return '2000-01-01';
    case 'timestamptz':
      return '2000-01-01T00:00:00Z';
    case 'jsonb':
      return '{}';
    case 'text[]':
    case 'uuid[]':
      return '{}';
    default:
      throw new Error(`no placeholder for ${c.sqlType}`);
  }
}

/**
 * A valid row for `t`: FK columns take the referenced row from `parents`
 * (by table name), nullable columns are NULL, bigserial columns are left to
 * their default, everything else gets a placeholder. `overrides` win.
 */
export function rowFor(
  t: ModelTable,
  label: string,
  parents: Record<string, Row>,
  overrides: Row = {},
): Row {
  const row: Row = {};
  for (const c of t.columns) {
    if (c.sqlType === 'bigserial') continue;
    row[c.name] = c.notNull ? placeholder(c, label) : null;
  }
  for (const fk of t.fks) {
    const parent = parents[fk.refTable];
    fk.columns.forEach((col, i) => {
      if (!t.columns.find((c) => c.name === col)!.notNull) return;
      if (!parent) throw new Error(`${t.name}: no parent row for ${fk.refTable}`);
      row[col] = parent[fk.refColumns[i]!]!;
    });
  }
  return { ...row, ...overrides };
}

export function insertSql(t: ModelTable, row: Row): { text: string; values: (string | null)[] } {
  const cols = Object.keys(row);
  const casts = cols.map((name, i) => {
    const c = t.columns.find((x) => x.name === name);
    if (!c) throw new Error(`${t.name}: no column ${name}`);
    return `$${i + 1}::${c.sqlType}`;
  });
  return {
    text: `INSERT INTO ${ident(t.name)} (${cols.map(ident).join(', ')}) VALUES (${casts.join(', ')})`,
    values: cols.map((c) => row[c] ?? null),
  };
}
