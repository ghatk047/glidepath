/** Selection kept in the URL (IA §5): `?lever=L10`, `?group=pool&key=software`, `?node=br.eps27`. */
export const SEARCH_KEYS = ['lever', 'group', 'key', 'node'] as const;
export type SearchKey = (typeof SEARCH_KEYS)[number];
export type ViewSearch = { [K in SearchKey]?: string };

/**
 * Reads the four selection params. Values are spec ids and are kept verbatim as strings
 * (the router's JSON parsing may hand us numbers or booleans: they are turned back into text).
 * Absent, empty, structured and unknown params are dropped.
 */
export function parseViewSearch(raw: Record<string, unknown>): ViewSearch {
  const out: ViewSearch = {};
  for (const k of SEARCH_KEYS) {
    const v = raw[k];
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      const s = String(v);
      if (s !== '') out[k] = s;
    }
  }
  return out;
}
