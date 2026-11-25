// Test support only (never exported by the package): validation states built from the tenant seed in
// docs/spec/seed/aa and the model in docs/spec, resolved with the domain's own resolveInputs, plus
// fixture mutations (cells set or removed, member attributes patched, members added).
import { resolve } from 'node:path';
import type {
  AttrValue,
  InputValue,
  Member,
  ModelBundle,
  TenantMembers,
  TenantSeed,
} from '@glidepath/spec';
import { loadModelBundleFromDir, readTenantSeed } from '@glidepath/spec/node';
import { resolveInputs, type InputValueRow } from '../resolve';
import type { ValidationState } from '../validation';
import { repoRoot } from './schema-json';

export const SPEC_DIR = resolve(repoRoot, 'docs/spec');
export const SEED_DIR = resolve(repoRoot, 'docs/spec/seed/aa');

/** Seed values (`{ var: number | { memberKey: number } }`) as stored rows. */
export function rowsOf(values: Readonly<Record<string, InputValue>>): InputValueRow[] {
  return Object.entries(values).flatMap(([var_key, v]) =>
    typeof v === 'number'
      ? [{ var_key, member_key: '', value: v }]
      : Object.entries(v).map(([member_key, value]) => ({ var_key, member_key, value })),
  );
}

export interface SeedFixture {
  readonly bundle: ModelBundle;
  readonly seed: TenantSeed;
  /** The seed's preset ids, in file order. */
  readonly presets: readonly string[];
  /** The resolved state of a preset (a scenario over the tenant defaults), or of the defaults (null). */
  stateFor(preset: string | null): ValidationState;
}

export async function loadSeedFixture(): Promise<SeedFixture> {
  const [bundle, seed] = await Promise.all([
    loadModelBundleFromDir(SPEC_DIR),
    readTenantSeed(SEED_DIR),
  ]);
  const defaults = rowsOf(seed.variableValues);
  const variables = bundle.variables.map((v) => v.id);
  return {
    bundle,
    seed,
    presets: seed.scenarios.scenarios.map((s) => s.id),
    stateFor(preset) {
      const chain =
        preset === null
          ? []
          : [
              {
                scenario_id: preset,
                values: rowsOf(seed.scenarios.scenarios.find((s) => s.id === preset)!.values),
              },
            ];
      const { values } = resolveInputs(defaults, chain, [], { variables });
      return { bundle, members: seed.dimensionMembers, values };
    },
  };
}

/** A fixture: changes to a valid state that make one rule pass or fail. */
export interface Mutation {
  /** Cells to set: `[var_key, member_key, value]`. */
  readonly set?: readonly (readonly [string, string, number])[];
  /** Cells to remove, so no level sets them: `[var_key, member_key]`. */
  readonly unset?: readonly (readonly [string, string])[];
  /** Attributes to merge into existing members, by dim then member id; null removes an attribute. */
  readonly patch?: Readonly<
    Record<string, Readonly<Record<string, Readonly<Record<string, AttrValue | null>>>>>
  >;
  /** Members to append, by dim. */
  readonly add?: Readonly<Record<string, readonly Member[]>>;
}

export function mutate(state: ValidationState, m: Mutation): ValidationState {
  const cells = new Map(state.values.map((r) => [`${r.var_key}|${r.member_key}`, r]));
  for (const [var_key, member_key, value] of m.set ?? []) {
    cells.set(`${var_key}|${member_key}`, { var_key, member_key, value });
  }
  for (const [var_key, member_key] of m.unset ?? []) {
    if (!cells.delete(`${var_key}|${member_key}`)) {
      throw new Error(`mutate: no cell ${var_key}[${member_key}] to unset`);
    }
  }
  const members: Record<string, readonly Member[]> = { ...state.members };
  for (const [dim, byId] of Object.entries(m.patch ?? {})) {
    for (const id of Object.keys(byId)) {
      if (!members[dim]?.some((x) => x.id === id))
        throw new Error(`mutate: no member ${dim}/${id}`);
    }
    members[dim] = members[dim]!.map((x) => {
      const p = byId[x.id];
      if (!p) return x;
      const next: Record<string, AttrValue | undefined> = { ...x };
      for (const [k, v] of Object.entries(p)) {
        if (v === null) delete next[k];
        else next[k] = v;
      }
      return next as Member;
    });
  }
  for (const [dim, added] of Object.entries(m.add ?? {})) {
    members[dim] = [...(members[dim] ?? []), ...added];
  }
  const values = [...cells.values()].sort(
    (a, b) => cmp(a.var_key, b.var_key) || cmp(a.member_key, b.member_key),
  );
  return { bundle: state.bundle, members: members as TenantMembers, values };
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
