import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { ObjectIntegrityError, assertBucket, assertKey, resolveExpiry, sha256Hex } from '@glidepath/data-access';
import type { Bucket, ObjectMeta, ObjectStore, ObjectStream, PutOptions } from '@glidepath/data-access';

/**
 * Test double of the ObjectStore port on a directory (one tenant): bytes in `<root>/<bucket>/<key>`,
 * metadata beside them in `.meta.json`. Same behaviour as the Postgres and memory adapters for what the
 * Excel jobs use (put, get, list, delete); nothing here returns a URL.
 */
export class FsObjectStore implements ObjectStore {
  constructor(
    private readonly root: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private path(bucket: Bucket, key: string): string {
    assertBucket(bucket);
    assertKey(key);
    return join(this.root, bucket, ...key.split('/'));
  }

  async put(bucket: Bucket, key: string, body: Uint8Array, options?: PutOptions): Promise<ObjectMeta> {
    const file = this.path(bucket, key);
    mkdirSync(dirname(file), { recursive: true });
    const now = this.now();
    const meta: ObjectMeta = {
      bucket,
      key,
      contentType: options?.contentType ?? 'application/octet-stream',
      size: body.byteLength,
      sha256: sha256Hex(body),
      createdAt: now,
      expiresAt: resolveExpiry(bucket, options, now),
    };
    writeFileSync(file, body);
    writeFileSync(`${file}.meta.json`, JSON.stringify(meta));
    return meta;
  }

  private read(bucket: Bucket, key: string): { meta: ObjectMeta; bytes: Uint8Array } | null {
    const file = this.path(bucket, key);
    try {
      const raw = JSON.parse(readFileSync(`${file}.meta.json`, 'utf8')) as ObjectMeta;
      const meta: ObjectMeta = {
        ...raw,
        createdAt: new Date(raw.createdAt),
        expiresAt: raw.expiresAt === null ? null : new Date(raw.expiresAt),
      };
      if (meta.expiresAt !== null && meta.expiresAt <= this.now()) return null;
      const bytes = new Uint8Array(readFileSync(file));
      if (sha256Hex(bytes) !== meta.sha256) throw new ObjectIntegrityError(bucket, key);
      return { meta, bytes };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async get(bucket: Bucket, key: string): Promise<{ meta: ObjectMeta; bytes: Uint8Array } | null> {
    return this.read(bucket, key);
  }

  async stream(bucket: Bucket, key: string): Promise<ObjectStream | null> {
    const got = this.read(bucket, key);
    return got === null ? null : { meta: got.meta, stream: Readable.from([Buffer.from(got.bytes)]) };
  }

  async list(bucket: Bucket, prefix = ''): Promise<ObjectMeta[]> {
    const base = join(this.root, bucket);
    const keys: string[] = [];
    const walk = (dir: string, rel: string): void => {
      let names: string[];
      try {
        names = readdirSync(dir);
      } catch {
        return;
      }
      for (const n of names) {
        const full = join(dir, n);
        if (statSync(full).isDirectory()) walk(full, `${rel}${n}/`);
        else if (!n.endsWith('.meta.json')) keys.push(`${rel}${n}`);
      }
    };
    walk(base, '');
    return keys
      .filter((k) => k.startsWith(prefix))
      .sort()
      .flatMap((k) => {
        const got = this.read(bucket, k);
        return got === null ? [] : [got.meta];
      });
  }

  async delete(bucket: Bucket, key: string): Promise<boolean> {
    const file = this.path(bucket, key);
    try {
      statSync(file);
    } catch {
      return false;
    }
    rmSync(file);
    rmSync(`${file}.meta.json`, { force: true });
    return true;
  }

  async purgeExpired(): Promise<number> {
    return 0;
  }
}
