import { describe, expect, it } from 'vitest';
import { checkDrizzleSchema, generateDrizzleSchema, schemaTsPath } from '../scripts/gen-drizzle';
import { tables } from './schema';

describe('gen-drizzle (Drizzle tables generated from schema.json)', () => {
  it('regenerate-and-diff: src/schema.ts is exactly what gen-drizzle produces from schema.json', () => {
    const r = checkDrizzleSchema();
    expect(r.problems).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('the check fails on drift', () => {
    const r = checkDrizzleSchema(schemaTsPath, generateDrizzleSchema() + '// drift\n');
    expect(r.ok).toBe(false);
  });

  it('generation is deterministic and covers all 27 spec tables', () => {
    expect(generateDrizzleSchema()).toBe(generateDrizzleSchema());
    expect(Object.keys(tables)).toHaveLength(27);
  });
});
