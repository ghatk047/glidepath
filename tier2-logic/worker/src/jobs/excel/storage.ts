import { BUCKETS } from '@glidepath/data-access';
import type { Bucket, ObjectStore } from '@glidepath/data-access';
import { ExcelJobError } from './state';

/** `file_uri` of an export or import row: `<bucket>/<key>` in the tenant's object store (ADR-025; no URL leaves tier 2). */
export const toUri = (bucket: Bucket, key: string): string => `${bucket}/${key}`;

export function fromUri(uri: string): { bucket: Bucket; key: string } {
  const slash = uri.indexOf('/');
  const bucket = uri.slice(0, slash);
  if (slash <= 0 || !(BUCKETS as readonly string[]).includes(bucket)) {
    throw new ExcelJobError('bad_file_uri', `'${uri}' is not a stored file (expected <bucket>/<key>).`);
  }
  return { bucket: bucket as Bucket, key: uri.slice(slash + 1) };
}

export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Key of the workbook of an export: `<export id>/<file name>`, so a download keeps the readable name. */
export const exportKey = (exportId: string, fileName: string): string => `${exportId}/${fileName}`;
/** Key of the E snapshot of an export. */
export const snapshotKey = (exportId: string): string => `${exportId}.json`;

export async function readStored(store: ObjectStore, uri: string): Promise<Uint8Array> {
  const { bucket, key } = fromUri(uri);
  const got = await store.get(bucket, key);
  if (got === null) throw new ExcelJobError('file_not_found', `The stored file '${uri}' is gone (exports expire after 30 days).`);
  return got.bytes;
}
