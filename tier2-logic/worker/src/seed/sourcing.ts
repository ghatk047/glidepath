/**
 * SRC-01/SRC-02: the tenant's sourcing seed, `tier3-data/seed/<tenant>/sourcing.json`: members of the
 * data-only tenant dimensions `contract`, `benchmark`, `sourcing_param` and `vendor_bucket` (@glidepath/domain
 * SOURCING_DIMENSIONS). Not part of the spec seed (docs/spec stays read-only) nor of the model
 * definitions' content hash: the engine never reads these members.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SOURCING_DIMENSIONS, type SourcingDimension, type StructuralChange } from '@glidepath/domain';
import type { Member } from '@glidepath/spec';
import { dimensionMemberRow } from './drafts';

/** The sourcing seed file of a tenant folder; optional (a tenant without one has no sourcing members). */
export const SOURCING_SEED_FILE = 'sourcing.json';
export const SOURCING_SEED_FORMAT = 'glidepath.sourcing/1';

export interface SourcingSeed {
  readonly format: typeof SOURCING_SEED_FORMAT;
  /** Members per sourcing dimension, in file order (the order is the members' `sort`). */
  readonly dimensions: Readonly<Record<SourcingDimension, readonly Member[]>>;
  /** Whatever else the file holds (note, coverage rule), as is. */
  readonly [key: string]: unknown;
}

/** Dimensions a sourcing.json may leave out (added after SRC-01): read as no members. */
const OPTIONAL_DIMENSIONS: ReadonlySet<string> = new Set(['vendor_bucket']);

const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Checks the shape of a parsed sourcing.json: format, the sourcing dimensions, members with id and label.
 * `vendor_bucket` may be absent (an older file) and then reads as an empty list.
 */
export function parseSourcingSeed(raw: unknown, where = SOURCING_SEED_FILE): SourcingSeed {
  const fail = (msg: string): never => {
    throw new Error(`seed: ${where}: ${msg}`);
  };
  if (!isObject(raw)) return fail('must be a JSON object');
  if (raw.format !== SOURCING_SEED_FORMAT) fail(`format must be "${SOURCING_SEED_FORMAT}"`);
  const dims = raw.dimensions;
  if (!isObject(dims)) return fail('dimensions must be an object');
  const unknown = Object.keys(dims).filter((d) => !(SOURCING_DIMENSIONS as readonly string[]).includes(d));
  if (unknown.length > 0) fail(`unknown dimension ${unknown.join(', ')}`);
  for (const dim of SOURCING_DIMENSIONS) {
    if (dims[dim] === undefined && OPTIONAL_DIMENSIONS.has(dim)) dims[dim] = [];
    const members = dims[dim];
    if (!Array.isArray(members)) return fail(`dimensions.${dim} must be an array`);
    const ids = new Set<string>();
    members.forEach((m, i) => {
      if (!isObject(m) || typeof m.id !== 'string' || m.id === '') fail(`${dim}[${i}] needs a string id`);
      const member = m as Record<string, unknown>;
      if (typeof member.label !== 'string' || member.label === '') fail(`${dim}.${String(member.id)} needs a label`);
      if (ids.has(member.id as string)) fail(`${dim}.${String(member.id)} is listed twice`);
      ids.add(member.id as string);
    });
  }
  return raw as unknown as SourcingSeed;
}

/** Reads `<tenantDir>/sourcing.json`; null when the tenant has none. */
export function readSourcingSeed(tenantDir: string): SourcingSeed | null {
  const path = join(tenantDir, SOURCING_SEED_FILE);
  if (!existsSync(path)) return null;
  return parseSourcingSeed(JSON.parse(readFileSync(path, 'utf8')) as unknown, path);
}

/**
 * Inserts for the sourcing members the tenant lacks (`existing`: dim -> member keys it has). A member
 * the tenant already has is never overwritten: users edit them.
 */
export function missingSourcingMembers(
  seed: SourcingSeed,
  existing: ReadonlyMap<string, ReadonlySet<string>>,
): StructuralChange[] {
  return SOURCING_DIMENSIONS.flatMap((dim) =>
    seed.dimensions[dim].flatMap((m, i): StructuralChange[] =>
      existing.get(dim)?.has(m.id)
        ? []
        : [{ target: 'structural', key: dim, member_key: m.id, op: 'insert', new_value: dimensionMemberRow(m, i + 1) }],
    ),
  );
}
