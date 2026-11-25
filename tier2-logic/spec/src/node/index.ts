export { readTenantSeed } from './seed';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadModelBundle } from '../core/load';
import type { ModelBundle } from '../core/types';

/**
 * Thin node adapter: read `variables.json` and `formula_graph.json` from a spec directory
 * (e.g. `docs/spec`) and delegate to the pure `loadModelBundle`. Exported as `@glidepath/spec/node`.
 */
export async function loadModelBundleFromDir(specDir: string): Promise<ModelBundle> {
  const read = async (file: string): Promise<unknown> => JSON.parse(await readFile(join(specDir, file), 'utf8'));
  const [variables, formulaGraph] = await Promise.all([read('variables.json'), read('formula_graph.json')]);
  return loadModelBundle({ variables, formulaGraph });
}
