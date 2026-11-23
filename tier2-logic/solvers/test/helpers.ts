/**
 * Test support (not shipped): the seed tenant of docs/spec compiled once, as a `SolverModel` started from
 * a preset. Tests may do IO; the solvers source may not.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile, type CompiledModel } from '@glidepath/engine';
import { seedToTenantData, type ModelBundle, type TenantSeed } from '@glidepath/spec';
import { loadModelBundleFromDir, readTenantSeed } from '@glidepath/spec/node';
import type { SolverModel } from '../src/model';
import type { Clock } from '../src/progress';

const here = dirname(fileURLToPath(import.meta.url));
export const repo = resolve(here, '../../..');

interface Seeded {
  bundle: ModelBundle;
  seed: TenantSeed;
  compiled: CompiledModel;
}
let loaded: Promise<Seeded> | undefined;

export function loadSeed(): Promise<Seeded> {
  loaded ??= Promise.all([
    loadModelBundleFromDir(resolve(repo, 'docs/spec')),
    readTenantSeed(resolve(repo, 'docs/spec/seed/aa')),
  ]).then(([bundle, seed]) => {
    const data = seedToTenantData(seed, undefined, bundle);
    return { bundle, seed, compiled: compile(bundle, data.members) };
  });
  return loaded;
}

/** Resolved inputs of a seed preset. */
export async function presetValues(id: string): Promise<Map<string, number>> {
  const { bundle, seed } = await loadSeed();
  return seedToTenantData(seed, id, bundle).values;
}

/**
 * A solver model at preset `start`, with the stretch cap from `stretch` presets (the spec's default is
 * the higher of C and D, 04 §1).
 */
export async function seedModel(start = 'C', stretch: readonly string[] = ['C', 'D']): Promise<SolverModel> {
  const { bundle, seed, compiled } = await loadSeed();
  const data = seedToTenantData(seed, start, bundle);
  return {
    compiled,
    base: compiled.evaluate(data.values, data.overrides),
    bundle,
    members: data.members,
    stretch: await Promise.all(stretch.map(presetValues)),
  };
}

export function readRepoJson<T>(rel: string): T {
  return JSON.parse(readFileSync(resolve(repo, rel), 'utf8')) as T;
}

/** A clock the test moves by hand. */
export class FakeClock implements Clock {
  t = 0;
  now(): number {
    return this.t;
  }
  advance(ms: number): void {
    this.t += ms;
  }
}
