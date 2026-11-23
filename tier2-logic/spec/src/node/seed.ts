import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseTenantSeed, type TenantSeed } from '../core/seed';

/**
 * Thin node adapter: read the five seed files of a tenant directory (e.g. `docs/spec/seed/aa`) and delegate to the
 * pure, zod-validating `parseTenantSeed`. Exported as `@glidepath/spec/node`.
 */
export async function readTenantSeed(seedDir: string): Promise<TenantSeed> {
  const read = async (file: string): Promise<unknown> => JSON.parse(await readFile(join(seedDir, file), 'utf8'));
  const [tenant, dimensionMembers, variableValues, scenarios, leverLibrary] = await Promise.all([
    read('tenant.json'),
    read('dimension_members.json'),
    read('variable_values.json'),
    read('scenarios.json'),
    read('lever_library.json'),
  ]);
  return parseTenantSeed({ tenant, dimensionMembers, variableValues, scenarios, leverLibrary });
}
