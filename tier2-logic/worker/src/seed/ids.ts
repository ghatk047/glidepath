import { createHash } from 'node:crypto';

/**
 * Deterministic ids for seeded rows (UUID version 5), so a second run finds what the first wrote
 * instead of inventing new ids. The namespace is an identifier, not a business number.
 */
const NAMESPACE = '6f1d2c4e-9a53-4b7e-8c1f-3d5a7b9e0c21';

const bytesOf = (uuid: string): Buffer => Buffer.from(uuid.replace(/-/g, ''), 'hex');

export function uuidV5(name: string): string {
  const h = createHash('sha1').update(bytesOf(NAMESPACE)).update(name, 'utf8').digest();
  h[6] = (h[6]! & 0x0f) | 0x50;
  h[8] = (h[8]! & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

/** Ids of seeded rows, all derived from the model version / tenant they belong to. */
export const seedIds = {
  modelVersion: (semver: string): string => uuidV5(`model_version:${semver}`),
  tenant: (slug: string): string => uuidV5(`tenant:${slug}`),
  scenario: (slug: string, key: string): string => uuidV5(`scenario:${slug}:${key}`),
  source: (slug: string, code: string): string => uuidV5(`source:${slug}:${code}`),
  user: (email: string): string => uuidV5(`app_user:${email.trim().toLowerCase()}`),
  /** The author of every seeded changeset and preset. */
  seedActor: (): string => uuidV5('app_user:seed-loader'),
};

/** Email and name of the seed-loader user (an `.invalid` address cannot receive mail). */
export const SEED_ACTOR_EMAIL = 'seed-loader@glidepath.invalid';
export const SEED_ACTOR_NAME = 'Seed loader';
