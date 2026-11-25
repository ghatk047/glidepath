import { Readable } from 'node:stream';
import {
  DEFAULT_CONTENT_TYPE, MAX_OBJECT_BYTES, ObjectIntegrityError, ObjectTooLargeError, assertBucket, assertKey,
  resolveExpiry, sha256Hex,
} from './port';
import type { Bucket, ObjectMeta, ObjectStore, ObjectStream, PutOptions } from './port';

interface Entry { meta: ObjectMeta; bytes: Uint8Array }

/** In-memory ObjectStore for tests and local use; same behaviour as the Postgres adapter. */
export class MemoryObjectStore implements ObjectStore {
  private readonly entries = new Map<string, Entry>();
  constructor(private readonly now: () => Date = () => new Date()) {}

  private id = (bucket: Bucket, key: string): string => `${bucket}\u0000${key}`;
  private live(e: Entry | undefined): Entry | null {
    return e && !(e.meta.expiresAt && e.meta.expiresAt <= this.now()) ? e : null;
  }

  async put(bucket: Bucket, key: string, body: Uint8Array, options?: PutOptions): Promise<ObjectMeta> {
    assertBucket(bucket);
    assertKey(key);
    if (body.byteLength > MAX_OBJECT_BYTES) throw new ObjectTooLargeError(body.byteLength);
    const now = this.now();
    const meta: ObjectMeta = {
      bucket, key, contentType: options?.contentType ?? DEFAULT_CONTENT_TYPE, size: body.byteLength,
      sha256: sha256Hex(body), createdAt: now, expiresAt: resolveExpiry(bucket, options, now),
    };
    this.entries.set(this.id(bucket, key), { meta, bytes: Uint8Array.from(body) });
    return { ...meta };
  }

  async get(bucket: Bucket, key: string): Promise<{ meta: ObjectMeta; bytes: Uint8Array } | null> {
    const e = this.live(this.entries.get(this.id(bucket, key)));
    if (!e) return null;
    if (sha256Hex(e.bytes) !== e.meta.sha256) throw new ObjectIntegrityError(bucket, key);
    return { meta: { ...e.meta }, bytes: Uint8Array.from(e.bytes) };
  }

  async stream(bucket: Bucket, key: string): Promise<ObjectStream | null> {
    const r = await this.get(bucket, key);
    return r && { meta: r.meta, stream: Readable.from([Buffer.from(r.bytes)]) };
  }

  async list(bucket: Bucket, prefix = ''): Promise<ObjectMeta[]> {
    return [...this.entries.values()]
      .filter((e) => e.meta.bucket === bucket && e.meta.key.startsWith(prefix) && this.live(e))
      .map((e) => ({ ...e.meta }))
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  }

  async delete(bucket: Bucket, key: string): Promise<boolean> {
    return this.entries.delete(this.id(bucket, key));
  }

  async purgeExpired(): Promise<number> {
    let n = 0;
    for (const [k, e] of this.entries) {
      if (!this.live(e)) {
        this.entries.delete(k);
        n++;
      }
    }
    return n;
  }

  /** Test hook: corrupt stored bytes without updating the checksum. */
  corruptForTest(bucket: Bucket, key: string): void {
    const e = this.entries.get(this.id(bucket, key));
    if (e) e.bytes = Uint8Array.from([...e.bytes, 1]);
  }
}
