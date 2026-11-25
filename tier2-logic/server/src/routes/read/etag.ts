import { createHash } from 'node:crypto';

/** Strong ETag of a response body: the quoted SHA-256 of its bytes. */
export function etagOf(body: string): string {
  return `"${createHash('sha256').update(body, 'utf8').digest('hex')}"`;
}

/**
 * True when an `If-None-Match` header matches `etag` (RFC 9110 section 13.1.2: weak comparison, so `W/`
 * is ignored; `*` matches anything that exists).
 */
export function ifNoneMatch(header: string | undefined | null, etag: string): boolean {
  if (!header) return false;
  const strip = (t: string): string => t.trim().replace(/^W\//, '');
  return header.split(',').some((t) => {
    const tag = strip(t);
    return tag === '*' || tag === strip(etag);
  });
}
