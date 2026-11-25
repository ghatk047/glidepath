import { Readable } from 'node:stream';
import { sql } from 'drizzle-orm';
import type { Db } from '../db';
import { withTenant } from '../tenant';
import {
  DEFAULT_CONTENT_TYPE, MAX_OBJECT_BYTES, ObjectIntegrityError, ObjectTooLargeError, assertBucket, assertKey,
  resolveExpiry, sha256Hex,
} from './port';
import type { Bucket, ObjectMeta, ObjectStore, ObjectStream, PutOptions } from './port';

interface MetaRow extends Record<string, unknown> {
  bucket: Bucket; key: string; content_type: string; size: string | number; sha256: string;
  created_at: Date; expires_at: Date | null;
}
interface DataRow extends MetaRow { bytes: Buffer }

const toMeta = (r: MetaRow): ObjectMeta => ({
  bucket: r.bucket, key: r.key, contentType: r.content_type, size: Number(r.size), sha256: r.sha256,
  createdAt: new Date(r.created_at), expiresAt: r.expires_at ? new Date(r.expires_at) : null,
});

const META = sql.raw('bucket, key, content_type, size, sha256, created_at, expires_at');

/**
 * Postgres ObjectStore over `stored_object` (ADR-025). Bound to one tenant; every call runs in
 * `withTenant(db, tenantId, userId, ...)` so FORCE RLS applies. The only code that touches the table.
 */
export class PostgresObjectStore implements ObjectStore {
  constructor(
    private readonly db: Db,
    private readonly tenantId: string,
    private readonly userId: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private tx<T>(fn: Parameters<typeof withTenant<T>>[3]): Promise<T> {
    return withTenant(this.db, this.tenantId, this.userId, fn);
  }

  async put(bucket: Bucket, key: string, body: Uint8Array, options?: PutOptions): Promise<ObjectMeta> {
    assertBucket(bucket);
    assertKey(key);
    if (body.byteLength > MAX_OBJECT_BYTES) throw new ObjectTooLargeError(body.byteLength);
    const now = this.now();
    const expiresAt = resolveExpiry(bucket, options, now);
    const hash = sha256Hex(body);
    const contentType = options?.contentType ?? DEFAULT_CONTENT_TYPE;
    const res = await this.tx((tx) =>
      tx.execute<MetaRow>(sql`
        insert into stored_object (tenant_id, bucket, key, content_type, bytes, sha256, size, created_at, expires_at)
        values (${this.tenantId}::uuid, ${bucket}, ${key}, ${contentType}, ${Buffer.from(body)}, ${hash},
                ${body.byteLength}, ${now.toISOString()}::timestamptz, ${expiresAt ? expiresAt.toISOString() : null}::timestamptz)
        on conflict (tenant_id, bucket, key) do update set content_type = excluded.content_type,
          bytes = excluded.bytes, sha256 = excluded.sha256, size = excluded.size,
          created_at = excluded.created_at, expires_at = excluded.expires_at
        returning ${META}`),
    );
    return toMeta(res.rows[0] as MetaRow);
  }

  async get(bucket: Bucket, key: string): Promise<{ meta: ObjectMeta; bytes: Uint8Array } | null> {
    const now = this.now().toISOString();
    const res = await this.tx((tx) =>
      tx.execute<DataRow>(sql`
        select ${META}, bytes from stored_object
        where bucket = ${bucket} and key = ${key} and (expires_at is null or expires_at > ${now}::timestamptz)`),
    );
    const row = res.rows[0];
    if (!row) return null;
    const bytes = new Uint8Array(row.bytes);
    if (sha256Hex(bytes) !== row.sha256) throw new ObjectIntegrityError(bucket, key);
    return { meta: toMeta(row), bytes };
  }

  async stream(bucket: Bucket, key: string): Promise<ObjectStream | null> {
    const r = await this.get(bucket, key);
    return r && { meta: r.meta, stream: Readable.from([Buffer.from(r.bytes)]) };
  }

  async list(bucket: Bucket, prefix = ''): Promise<ObjectMeta[]> {
    const now = this.now().toISOString();
    const like = prefix.replace(/[\\%_]/g, '\\$&') + '%';
    const res = await this.tx((tx) =>
      tx.execute<MetaRow>(sql`
        select ${META} from stored_object
        where bucket = ${bucket} and key like ${like} escape '\\'
          and (expires_at is null or expires_at > ${now}::timestamptz)
        order by key collate "C"`),
    );
    return res.rows.map(toMeta);
  }

  async delete(bucket: Bucket, key: string): Promise<boolean> {
    const res = await this.tx((tx) =>
      tx.execute(sql`delete from stored_object where bucket = ${bucket} and key = ${key}`),
    );
    return (res.rowCount ?? 0) > 0;
  }

  async purgeExpired(): Promise<number> {
    const now = this.now().toISOString();
    const res = await this.tx((tx) =>
      tx.execute(sql`delete from stored_object where expires_at is not null and expires_at <= ${now}::timestamptz`),
    );
    return res.rowCount ?? 0;
  }
}
