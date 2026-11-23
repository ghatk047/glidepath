import { TenantId } from '@glidepath/api-contract';
import type { CellKey as WireCell, ScenarioId } from '@glidepath/api-contract';
import { membersHash } from '@glidepath/spec';
import type { ModelBundle } from '@glidepath/spec';
import { goldenClose, goldenTargets, pyRound } from '@glidepath/parity';
import { aaScenarioIds, aaTenantData, goldenFile, specBundle } from '@glidepath/testkit';
import { toWireCell } from '../cells';
import { ModelCache } from '../model-cache';
import type { ScenarioLoader } from '../loader';

/**
 * Test support without a database: scenarios of the spec seed tenant (`docs/spec/seed`, presets `rates`,
 * `A`…`D`) resolved as `Model.input_cells` does, compiled through a ModelCache like the DB loader.
 */

export const SEED_TENANT = TenantId.parse('00000000-0000-4000-8000-0000000000aa');

export interface SeedLoader extends ScenarioLoader {
  readonly models: ModelCache;
  readonly bundle: ModelBundle;
  /** How many loads ran. */
  readonly loads: number;
}

export async function seedLoader(models = new ModelCache()): Promise<SeedLoader> {
  const bundle = await specBundle();
  const ids = await aaScenarioIds();
  let loads = 0;
  return {
    models,
    bundle,
    get loads() {
      return loads;
    },
    async load(scope, scenarioId) {
      loads += 1;
      if (!ids.includes(scenarioId)) return null;
      const data = await aaTenantData(scenarioId);
      const key = { tenantId: scope.tenantId, modelVersionId: bundle.specVersion, membersHash: membersHash(data.members) };
      const model = await models.get(key, data.members, async () => bundle);
      return {
        scenarioId: scenarioId as ScenarioId,
        version: 0,
        model,
        committed: model.committed(scenarioId, data.values, data.overrides),
      };
    },
  };
}

/** Decimals of `golden_results.json`. */
const REFERENCE_DECIMALS = 6;

/**
 * Every golden value of a scenario by wire cell key (`res.net[]`, `pl.eps[fy27b]`, `lev.iy[L01]`,
 * `vp.net[vp_x]`), read the way the G3 gate reads them (`@glidepath/parity` `goldenTargets`).
 */
export function goldenCells(scenario: string): Map<WireCell, number> {
  const out = new Map<WireCell, number>();
  for (const t of goldenTargets(goldenFile())) if (t.scenario === scenario) out.set(toWireCell(t.cell), t.golden);
  return out;
}

/** The G3 comparison: Python `round(value, 6)` within 1e-6 relative / 1e-9 absolute of the golden value. */
export const matchesGolden = (value: number, golden: number): boolean =>
  goldenClose(pyRound(value, REFERENCE_DECIMALS), golden);
