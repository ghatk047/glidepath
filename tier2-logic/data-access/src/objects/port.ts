import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';

/** Buckets are key prefixes of one store (ADR-025). */
export const BUCKETS = ['exports', 'export-snapshots', 'imports', 'ai'] as const;
export type Bucket = (typeof BUCKETS)[number];

/** Per-object cap (ADR-025). */
export const MAX_OBJECT_BYTES = 50 * 1024 * 1024;
/** Lifecycle of the `exports` bucket (04 §5). */
export const EXPORT_TTL_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface ObjectMeta {
  bucket: Bucket;
  key: string;
  contentType: string;
  size: number;
  sha256: string;
  createdAt: Date;
  /** null: never expires. */
  expiresAt: Date | null;
}

export interface PutOptions {
  contentType?: string;
  /** Overrides the bucket default (`exports`: now + 30 days; others: none). null: never. */
  expiresAt?: Date | null;
}

export interface ObjectStream {
  meta: ObjectMeta;
  /** Bytes through tier 2 only; there is no URL to hand out. */
  stream: Readable;
}

/**
 * ObjectStore port: put / get / stream / list / delete (ADR-025). An instance is bound to one tenant.
 * Expired objects are invisible (get/stream/list return null/empty). Nothing returns a storage URL.
 */
export interface ObjectStore {
  put(bucket: Bucket, key: string, body: Uint8Array, options?: PutOptions): Promise<ObjectMeta>;
  /** Bytes verified against the stored sha256; null when absent or expired. */
  get(bucket: Bucket, key: string): Promise<{ meta: ObjectMeta; bytes: Uint8Array } | null>;
  /** Verified like `get`; rejects with ObjectIntegrityError before any byte is emitted. */
  stream(bucket: Bucket, key: string): Promise<ObjectStream | null>;
  /** Live objects of the bucket whose key starts with `prefix`, ordered by key. */
  list(bucket: Bucket, prefix?: string): Promise<ObjectMeta[]>;
  /** True when something was deleted. */
  delete(bucket: Bucket, key: string): Promise<boolean>;
  /** Removes expired objects of the tenant; returns how many. */
  purgeExpired(): Promise<number>;
}

export class ObjectTooLargeError extends Error {
  constructor(readonly size: number) {
    super(`object of ${size} bytes exceeds the ${MAX_OBJECT_BYTES} byte limit`);
    this.name = 'ObjectTooLargeError';
  }
}

export class ObjectIntegrityError extends Error {
  constructor(bucket: string, key: string) {
    super(`sha256 mismatch for ${bucket}/${key}`);
    this.name = 'ObjectIntegrityError';
  }
}

export const sha256Hex = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');

export function assertBucket(bucket: string): asserts bucket is Bucket {
  if (!(BUCKETS as readonly string[]).includes(bucket)) throw new Error(`unknown bucket: ${bucket}`);
}

export function assertKey(key: string): void {
  if (key.length === 0 || key.length > 1024) throw new Error('object key must be 1..1024 characters');
}

/** Expiry for a put: explicit option wins, else exports get the 30-day lifecycle. */
export function resolveExpiry(bucket: Bucket, options: PutOptions | undefined, now: Date): Date | null {
  if (options?.expiresAt !== undefined) return options.expiresAt;
  return bucket === 'exports' ? new Date(now.getTime() + EXPORT_TTL_DAYS * DAY_MS) : null;
}

export const DEFAULT_CONTENT_TYPE = 'application/octet-stream';
