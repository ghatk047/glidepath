/**
 * Pure: a tenant seed (docs/spec/seed/<tenant>) as changeset changes of origin `seed`, restricted to
 * what the tenant does not have yet. Same row mapping as the DOM-03 seed test (domain test-support).
 */
import { LINE_ITEM_DIM, type JsonObject, type StructuralChange, type ValueChange } from '@glidepath/domain';
import type { InputValue, Member, ModelBundle, TenantSeed } from '@glidepath/spec';

const json = (v: unknown): JsonObject[string] => (v === undefined ? null : (v as JsonObject[string]));

/** A seed value (`number` or `{ memberKey: number }`) as stored cells. */
export interface Cell {
  readonly key: string;
  readonly member_key: string;
  readonly value: number;
}

export function cellsOf(values: Readonly<Record<string, InputValue>>): Cell[] {
  return Object.entries(values).flatMap(([key, v]) =>
    typeof v === 'number'
      ? [{ key, member_key: '', value: v }]
      : Object.entries(v).map(([member_key, value]) => ({ key, member_key, value })),
  );
}

/** `var[m1,m2]` -> `{ key: 'var', member_key: 'm1,m2' }`; a scalar `var` has member_key ''. */
export function splitCellKey(cell: string): { key: string; member_key: string } {
  const m = /^(.+?)\[(.*)\]$/.exec(cell);
  return m ? { key: m[1]!, member_key: m[2]! } : { key: cell, member_key: '' };
}

export const cellId = (key: string, member_key: string): string => `${key}\u0000${member_key}`;

/** Dimensions whose members are tenant rows (scope `tenant` or `global+tenant`). */
export function tenantDimensions(bundle: Pick<ModelBundle, 'dimensions'>): string[] {
  return bundle.dimensions.filter((d) => d.scope.split('+').includes('tenant')).map((d) => d.id);
}

/** The seed's members of a tenant dimension, in file order. */
export function tenantMembersOf(seed: TenantSeed, bundle: Pick<ModelBundle, 'dimensions'>): Map<string, readonly Member[]> {
  const dims = new Set(tenantDimensions(bundle));
  return new Map(Object.entries(seed.dimensionMembers).filter(([dim]) => dims.has(dim)));
}

/** Source codes named in a line's free-text `source` ("S02 headcount; S07 wages"), in order. */
export function sourceCodes(text: unknown): string[] {
  return typeof text === 'string' ? [...text.matchAll(/\bS\d{2}\b/g)].map((m) => m[0]) : [];
}

/** All source codes of the seed's lines, sorted. */
export function allSourceCodes(seed: TenantSeed): string[] {
  const codes = new Set((seed.dimensionMembers[LINE_ITEM_DIM] ?? []).flatMap((m) => sourceCodes(m.source)));
  return [...codes].sort();
}

/** A seed member of a tenant dim as a dimension_member row. */
export function dimensionMemberRow(m: Member, sort: number): JsonObject {
  const attrs: Record<string, unknown> = { ...m };
  delete attrs.id;
  delete attrs.label;
  return { label: json(m.label), attrs: attrs as JsonObject, sort, active: true };
}

/** A seed line as a line_item row; `sourceId` is the row of its first source code. */
export function lineItemRow(m: Member, sourceId: string | null): JsonObject {
  return {
    legacy_id: json(m.legacy_id),
    pool_id: json(m.pool),
    tenant_l1_label: json(m.l1_label),
    l2: json(m.l2),
    name: json(m.name),
    vendor_key: null,
    vendor_text: json(m.vendor),
    nature: json(m.nature),
    accounting: json(m.accounting),
    driver_text: json(m.driver_text),
    qty: json(m.qty),
    unit: json(m.unit),
    addr_tag: json(m.addr),
    domain_key: json(m.domain),
    scale_driver: json(m.drv),
    in_scope: m.in_scope === 1,
    memo: m.memo === 1,
    confidence: json(m.confidence),
    source_id: sourceId,
    lever_hook_text: json(m.lever_hook),
    notes: typeof m.notes === 'string' ? m.notes : '', // absent in most seed lines; the column is NOT NULL
    active: true,
  };
}

/** line_item_lever pairs of the seed's lines (`lever_ids`). */
export function leverMappings(seed: TenantSeed): { line_key: string; lever_code: string }[] {
  return (seed.dimensionMembers[LINE_ITEM_DIM] ?? []).flatMap((m) =>
    (Array.isArray(m.lever_ids) ? m.lever_ids : []).map((c) => ({ line_key: m.id, lever_code: String(c) })),
  );
}

/** Inserts for the tenant members and lines the tenant lacks. `existing`: dim -> member keys it has. */
export function missingMembers(
  seed: TenantSeed,
  bundle: Pick<ModelBundle, 'dimensions'>,
  existing: ReadonlyMap<string, ReadonlySet<string>>,
  sourceId: (code: string) => string,
): StructuralChange[] {
  const out: StructuralChange[] = [];
  for (const [dim, members] of tenantMembersOf(seed, bundle)) {
    members.forEach((m, i) => {
      if (existing.get(dim)?.has(m.id)) return;
      const first = sourceCodes(m.source)[0];
      out.push({
        target: 'structural',
        key: dim,
        member_key: m.id,
        op: 'insert',
        new_value:
          dim === LINE_ITEM_DIM
            ? lineItemRow(m, first === undefined ? null : sourceId(first))
            : dimensionMemberRow(m, i + 1),
      });
    });
  }
  return out;
}

/** Sets for the tenant defaults the tenant lacks (an existing default is the tenant's, never reset). */
export function missingDefaults(seed: TenantSeed, stored: ReadonlySet<string>): ValueChange[] {
  return cellsOf(seed.variableValues)
    .filter((c) => !stored.has(cellId(c.key, c.member_key)))
    .map((c) => ({ target: 'variable', key: c.key, member_key: c.member_key, op: 'set', new_value: c.value }));
}

/**
 * Sets for the cells of a locked preset that differ from the seed (presets belong to the seed, so a
 * rerun repairs them). `stored`: cell id -> stored value of the scenario's own rows.
 */
export function presetChanges(
  scenario: TenantSeed['scenarios']['scenarios'][number],
  storedValues: ReadonlyMap<string, number>,
  storedOverrides: ReadonlyMap<string, number>,
): ValueChange[] {
  const values: ValueChange[] = cellsOf(scenario.values)
    .filter((c) => storedValues.get(cellId(c.key, c.member_key)) !== c.value)
    .map((c) => ({ target: 'variable', key: c.key, member_key: c.member_key, op: 'set', new_value: c.value }));
  const overrides: ValueChange[] = Object.entries(scenario.overrides ?? {})
    .map(([cell, value]) => ({ ...splitCellKey(cell), value }))
    .filter((c) => storedOverrides.get(cellId(c.key, c.member_key)) !== c.value)
    .map((c) => ({ target: 'override', key: c.key, member_key: c.member_key, op: 'set', new_value: c.value }));
  return [...values, ...overrides];
}
