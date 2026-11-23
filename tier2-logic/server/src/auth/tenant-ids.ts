import { createHash } from 'node:crypto';

/**
 * The id of the tenant with this slug. Every tenant row is created with the seed's deterministic id (UUID v5 of
 * `tenant:<slug>`, worker `seedIds.tenant`, also used by the AI apply step), and RLS lets nobody look a tenant up by
 * slug before they belong to it, so the Access auto-membership (OPS-09) derives the id the same way and then
 * checks, inside `withTenant`, that the row is there and carries that slug. `tenant-ids.test.ts` keeps this equal
 * to the worker's. The namespace is an identifier, not a business number.
 */
const SEED_NAMESPACE = '6f1d2c4e-9a53-4b7e-8c1f-3d5a7b9e0c21';
const UUID_VERSION_5 = 0x50;
const UUID_VARIANT = 0x80;

export function tenantIdForSlug(slug: string): string {
  const h = createHash('sha1')
    .update(Buffer.from(SEED_NAMESPACE.replace(/-/g, ''), 'hex'))
    .update(`tenant:${slug}`, 'utf8')
    .digest();
  h[6] = (h[6]! & 0x0f) | UUID_VERSION_5;
  h[8] = (h[8]! & 0x3f) | UUID_VARIANT;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}
