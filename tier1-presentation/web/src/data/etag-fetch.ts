import type { FetchLike, ResponseLike } from '@glidepath/api-contract';

/** The bundle is the one route the contract says is "cached by ETag" (04 §3). */
const isBundleUrl = (url: string): boolean => /\/api\/t\/[^/?]+\/bundle(?:\?|$)/.test(url);

interface Entry {
  etag: string;
  contentType: string | null;
  text: string;
}

/**
 * Wraps a `FetchLike` with ETag revalidation for the URLs `shouldCache` accepts (default: the
 * bundle). The first 200 with an `ETag` is remembered; the next request for the same URL sends
 * `if-none-match`, and a `304` is answered to the typed client as the remembered 200, so
 * `createClient` (which only knows the route's 200) parses the same body again.
 * A caller's own `if-none-match` is left alone.
 */
export function withEtagCache(
  fetch: FetchLike,
  shouldCache: (url: string) => boolean = isBundleUrl,
): FetchLike {
  const entries = new Map<string, Entry>();

  const replay = (entry: Entry, status: number, statusText: string | undefined): ResponseLike => ({
    status,
    ...(statusText !== undefined ? { statusText } : {}),
    headers: {
      get: (name) => {
        const n = name.toLowerCase();
        return n === 'content-type' ? entry.contentType : n === 'etag' ? entry.etag : null;
      },
    },
    text: () => Promise.resolve(entry.text),
  });

  return async (url, init) => {
    if (init.method !== 'GET' || !shouldCache(url)) return fetch(url, init);

    const known = entries.get(url);
    const sendsOwn = Object.keys(init.headers).some((h) => h.toLowerCase() === 'if-none-match');
    const headers =
      known && !sendsOwn ? { ...init.headers, 'if-none-match': known.etag } : init.headers;
    const res = await fetch(url, { ...init, headers });

    if (res.status === 304 && known) return replay(known, 200, 'OK');
    if (res.status === 200) {
      const etag = res.headers.get('etag');
      if (etag) {
        const entry: Entry = {
          etag,
          contentType: res.headers.get('content-type'),
          text: await res.text(),
        };
        entries.set(url, entry);
        return replay(entry, res.status, res.statusText);
      }
      entries.delete(url);
    }
    return res;
  };
}
