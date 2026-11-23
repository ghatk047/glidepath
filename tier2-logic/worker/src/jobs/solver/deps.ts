import { readFile } from 'node:fs/promises';
import { loadModelBundleFromDir } from '@glidepath/spec/node';
import type { ModelBundle } from '@glidepath/spec';
import { CompiledModelCache, findSpecDir } from '../excel/deps';
import type { SolverJobDeps } from './types';

/** `solvers.json` decision_variable_sets.lever_intensity: "stretch cap default = max(C, D) preset value". */
export const DEFAULT_STRETCH_PRESETS: readonly string[] = ['C', 'D'];

export interface DefaultSolverDepsOptions {
  /** Directory with variables.json and formula_graph.json; default `SPEC_DIR` or the repo's `docs/spec`. */
  readonly specDir?: string;
  readonly stretchPresets?: readonly string[];
}

/** Production wiring: the spec bundle from `SPEC_DIR`, loaded on the first job. */
export function defaultSolverDeps(options: DefaultSolverDepsOptions = {}): SolverJobDeps {
  let bundle: Promise<ModelBundle> | undefined;
  return {
    bundle: async (semver) => {
      bundle ??= loadModelBundleFromDir(options.specDir ?? findSpecDir());
      try {
        const b = await bundle;
        return b.specVersion === semver ? b : null;
      } catch (err) {
        bundle = undefined;
        throw err;
      }
    },
    cache: new CompiledModelCache(),
    stretchPresets: options.stretchPresets ?? DEFAULT_STRETCH_PRESETS,
  };
}

void readFile;
