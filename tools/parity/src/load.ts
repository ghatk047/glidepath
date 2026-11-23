/**
 * File loading for the parity harness (the engine itself does no IO): the spec bundle, the seed tenant
 * (members in file order), golden_results.json and parity_report.json.
 */
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ModelBundle, TenantSeed } from '@glidepath/spec';
import { loadModelBundleFromDir, readTenantSeed } from '@glidepath/spec/node';
import type { GoldenFile } from './golden';
import type { ParityReportFile } from './replay';

/** Repository root (this file is tools/parity/src/load.ts). */
export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

export const paths = {
  spec: join(repoRoot, 'docs', 'spec'),
  seed: join(repoRoot, 'docs', 'spec', 'seed', 'aa'),
  golden: join(repoRoot, 'docs', 'spec', 'reference', 'golden_results.json'),
  parityReport: join(repoRoot, 'docs', 'spec', 'reference', 'parity_report.json'),
  out: join(repoRoot, 'tools', 'parity', 'out'),
  /** The synthetic second tenant (QA-02). */
  zzSeed: join(repoRoot, 'tools', 'testkit', 'seed', 'zz'),
  /** The fuzz oracle (ENG-10): runs docs/spec/reference/engine.py on the drawn vectors. */
  fuzzOracle: join(repoRoot, 'tools', 'parity', 'fuzz_ref.py'),
} as const;

export async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

export interface ParityInputs {
  readonly bundle: ModelBundle;
  readonly seed: TenantSeed;
  readonly golden: GoldenFile;
  readonly report: ParityReportFile;
}

export async function loadParityInputs(
  files: { golden?: string; parityReport?: string } = {},
): Promise<ParityInputs> {
  const [bundle, seed, golden, report] = await Promise.all([
    loadModelBundleFromDir(paths.spec),
    readTenantSeed(paths.seed),
    readJson<GoldenFile>(files.golden ?? paths.golden),
    readJson<ParityReportFile>(files.parityReport ?? paths.parityReport),
  ]);
  return { bundle, seed, golden, report };
}
