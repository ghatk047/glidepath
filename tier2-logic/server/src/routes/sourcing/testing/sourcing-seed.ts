import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb, schema, withTenant } from '@glidepath/data-access';

/**
 * Test support: the AA sourcing members (tier3-data/seed/aa/sourcing.json: contract, benchmark, sourcing_param, vendor_bucket)
 * written into a test database as the owner role, the way read/testing/aa-db.ts writes the other tenant members
 * (the compose seed loads them through applyChangeset, worker `seedTenant`).
 */
export interface SourcingSeedMember {
  id: string;
  label: string;
  [attr: string]: unknown;
}
export type SourcingSeedDims = Record<'contract' | 'benchmark' | 'sourcing_param' | 'vendor_bucket', SourcingSeedMember[]>;

const SEED_FILE = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../../../../tier3-data/seed/aa/sourcing.json');

export function readAaSourcing(): SourcingSeedDims {
  return (JSON.parse(readFileSync(SEED_FILE, 'utf8')) as { dimensions: SourcingSeedDims }).dimensions;
}

/** Inserts the AA sourcing members for `tenantId` (owner connection `ownerUrl`). */
export async function seedAaSourcing(ownerUrl: string, tenantId: string, userId: string): Promise<SourcingSeedDims> {
  const dims = readAaSourcing();
  const owner = createDb(ownerUrl, { poolMax: 1 });
  try {
    await withTenant(owner.db, tenantId, userId, async (tx) => {
      for (const [dim, members] of Object.entries(dims)) {
        await tx.insert(schema.dimension_member).values(
          members.map((m, i) => {
            const { id, label, ...attrs } = m;
            return { tenant_id: tenantId, dim_key: dim, member_key: id, label, attrs: attrs as never, sort: i + 1, active: true };
          }),
        );
      }
    });
  } finally {
    await owner.close();
  }
  return dims;
}
