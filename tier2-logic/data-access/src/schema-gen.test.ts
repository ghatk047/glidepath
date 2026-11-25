import { describe, expect, it } from 'vitest';
import { checkDrizzleSchema, generateDrizzleSchema, schemaTsPath } from '../scripts/gen-drizzle';
import { MANUAL_OVERLAY, loadSchema } from '@glidepath/gen-schema';
import { tables } from './schema';

describe('gen-drizzle (Drizzle tables generated from schema.json and the manual overlay)', () => {
  it('regenerate-and-diff: src/schema.ts is exactly what gen-drizzle produces from schema.json + the manual overlay', () => {
    const r = checkDrizzleSchema();
    expect(r.problems).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('the check fails on drift', () => {
    const r = checkDrizzleSchema(schemaTsPath, generateDrizzleSchema() + '// drift\n');
    expect(r.ok).toBe(false);
  });

  it('generation is deterministic and covers all 27 spec tables plus the tables of manual migrations', () => {
    expect(generateDrizzleSchema()).toBe(generateDrizzleSchema());
    const spec = Object.keys(loadSchema().tables);
    expect(spec).toHaveLength(27);
    const manual = MANUAL_OVERLAY.tables.map((t) => t.name);
    const all = Object.keys(tables);
    expect(all.slice(0, spec.length).sort()).toEqual([...spec].sort()); // dependency order, spec tables first
    expect(all.slice(spec.length)).toEqual(manual);
    expect(Object.keys(tables)).toEqual(expect.arrayContaining(['auth_token', 'auth_session', 'passkey', 'stored_object']));
  });

  it('typed columns added by manual migrations are present', () => {
    expect(Object.keys(tables.scenario)).toContain('archived');
    for (const c of ['progress', 'progress_note', 'cancel_requested', 'updated_at']) expect(Object.keys(tables.solver_run)).toContain(c);
  });
});
