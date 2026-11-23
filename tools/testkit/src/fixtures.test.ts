import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fixtureFilesOnDisk, fixtureIndex, fixturePath, fixturesDir, listFixtures, readFixture } from './index';

describe('Excel fixtures', () => {
  it('index lists every fixture file in the folder, and only those', () => {
    expect([...listFixtures()].sort()).toEqual(fixtureFilesOnDisk());
    expect(listFixtures().length).toBeGreaterThan(0);
  });

  it('every entry has a description and a producing method, and exists', () => {
    for (const e of fixtureIndex().files) {
      expect(e.description.length).toBeGreaterThan(0);
      expect(e.produced_by.length).toBeGreaterThan(0);
      expect(existsSync(fixturePath(e.file))).toBe(true);
    }
  });

  it('pending fixtures carry a reason and are not on disk', () => {
    for (const p of fixtureIndex().pending) {
      expect(p.reason.length).toBeGreaterThan(0);
      expect(existsSync(join(fixturesDir, p.file))).toBe(false);
    }
  });

  it('xlsx fixtures are zip containers; the README says how they were produced and names every file', () => {
    for (const f of listFixtures().filter((n) => n.endsWith('.xlsx'))) {
      expect(readFixture(f).subarray(0, 2).toString()).toBe('PK');
    }
    const readme = readFileSync(join(fixturesDir, 'README.md'), 'utf8');
    expect(readme).toMatch(/How they were produced/);
    for (const f of listFixtures()) expect(readme).toContain(f);
  });

  it('rejects names that are not in the index', () => {
    expect(() => fixturePath('../../package.json')).toThrow(/not in the index/);
  });
});
