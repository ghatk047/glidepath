import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { excelFixturesDir } from './paths';

export interface FixtureEntry {
  file: string;
  description: string;
  /** How it was produced (script, application). */
  produced_by: string;
}

export interface FixtureIndex {
  files: FixtureEntry[];
  /** Fixtures that are expected but not yet supplied, with the reason. */
  pending: { file: string; reason: string }[];
}

/** Absolute path of the Excel fixture folder. */
export const fixturesDir = excelFixturesDir;

/** `fixtures/excel/index.json`. */
export function fixtureIndex(): FixtureIndex {
  return JSON.parse(readFileSync(join(fixturesDir, 'index.json'), 'utf8')) as FixtureIndex;
}

/** File names listed by the index. */
export function listFixtures(): string[] {
  return fixtureIndex().files.map((f) => f.file);
}

/** Files physically in the folder, excluding the index, README and producing scripts. */
export function fixtureFilesOnDisk(): string[] {
  return readdirSync(fixturesDir)
    .filter((f) => f !== 'index.json' && f !== 'README.md' && !f.endsWith('.py') && !f.startsWith('.'))
    .sort();
}

/** Absolute path of a listed fixture; throws if it is not listed or missing. */
export function fixturePath(file: string): string {
  if (!listFixtures().includes(file)) throw new Error(`fixtures: '${file}' is not in the index`);
  const p = join(fixturesDir, file);
  if (!existsSync(p)) throw new Error(`fixtures: '${file}' is listed but missing on disk`);
  return p;
}

export function readFixture(file: string): Buffer {
  return readFileSync(fixturePath(file));
}
