import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** Repository root (this file is tools/testkit/src/paths.ts). */
export const repoRoot = resolve(here, '..', '..', '..');
/** The model spec bundle directory. */
export const specDir = join(repoRoot, 'docs', 'spec');
/** The AA tenant seed directory (five JSON files). */
export const aaSeedDir = join(specDir, 'seed', 'aa');
/** `golden_results.json`. */
export const goldenResultsPath = join(specDir, 'reference', 'golden_results.json');
/** Excel fixture folder. */
export const excelFixturesDir = resolve(here, '..', 'fixtures', 'excel');
