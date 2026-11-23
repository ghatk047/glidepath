import { fileURLToPath } from 'node:url';
import type { ModelBundle } from '@glidepath/spec';
import { loadModelBundleFromDir } from '@glidepath/spec/node';

/**
 * Where the bundle route gets what `variable_def` / `dimension_def` do not hold: variable `kind`,
 * `scenario_varies`, `source`, `confidence`, `note` and the dimension `label` (known gap of the DB
 * tables; the spec bundle is the source until a migration adds the columns).
 *
 * `semver` is the pinned `model_version.semver`. Answer the bundle of that version, or `null` when
 * this server has none for it.
 */
export type SpecBundleSource = (semver: string) => Promise<ModelBundle | null>;

/** `docs/spec` of the repository this file sits in (source checkouts and tests). */
const REPO_SPEC_DIR = fileURLToPath(new URL('../../../../../docs/spec', import.meta.url));

/**
 * Spec bundle read from a directory holding `variables.json` and `formula_graph.json`: `dir`, else the
 * `SPEC_DIR` environment variable, else the repository's `docs/spec`. Loaded on first use and kept; a
 * failed load is not kept. The bundle answers for the one model version it declares (`spec_version`).
 */
export function specBundleFromDir(dir?: string): SpecBundleSource {
  let loaded: Promise<ModelBundle> | undefined;
  return async (semver) => {
    loaded ??= loadModelBundleFromDir(dir ?? process.env.SPEC_DIR ?? REPO_SPEC_DIR);
    try {
      const bundle = await loaded;
      return bundle.specVersion === semver ? bundle : null;
    } catch (err) {
      loaded = undefined;
      throw err;
    }
  };
}
