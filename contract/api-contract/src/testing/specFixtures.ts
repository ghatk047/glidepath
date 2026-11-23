import type { z } from 'zod';
import type { BundleResponse, MembersResponse, ScenariosResponse } from '../core';
import type { ServerMessage } from '../ws';
import meta from '../fixtures/spec/meta.json';
import bundle from '../fixtures/spec/bundle.json';
import members from '../fixtures/spec/members.json';
import scenarios from '../fixtures/spec/scenarios.json';
import snapshots from '../fixtures/spec/snapshots.json';

/** A `snapshot` server message as sent on the wire. */
export type SnapshotMessageIn = Extract<z.input<typeof ServerMessage>, { type: 'snapshot' }>;

/**
 * Wire fixtures generated from `docs/spec` and `golden_results.json` by
 * `scripts/generate-fixtures.ts` (never edited by hand; `spec-fixtures.spec.ts` regenerates
 * and diffs them). Values are the seed tenant's and the golden results, so a tier-1 test that
 * shows `res.net` for preset C shows the number the engine must produce.
 *
 * - `bundle`, `members`, `scenarios`: bodies of `GET /bundle`, `/members`, `/scenarios`.
 * - `snapshots[key]`: for each preset key (`rates`, `A`…`D`), a `snapshot` of every golden
 *   output cell plus the preset's resolved input cells (scenario value, else tenant default).
 */
export const specFixtures = {
  tenant: meta.tenant,
  /** Preset key the tenant opens on (`C`). */
  defaultScenario: meta.defaultScenario,
  modelVersion: meta.modelVersion,
  bundle: bundle as unknown as z.input<typeof BundleResponse>,
  members: members as unknown as z.input<typeof MembersResponse>,
  scenarios: scenarios as unknown as z.input<typeof ScenariosResponse>,
  snapshots: snapshots as unknown as Readonly<Record<string, SnapshotMessageIn>>,
};

/** The generated snapshot of preset `key` (default: the tenant's default preset). */
export function presetSnapshot(key: string = specFixtures.defaultScenario): SnapshotMessageIn {
  const s = specFixtures.snapshots[key];
  if (!s) {
    const have = Object.keys(specFixtures.snapshots).join(', ');
    throw new Error(`no generated snapshot for preset '${key}' (have ${have})`);
  }
  return s;
}
