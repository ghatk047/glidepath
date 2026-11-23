import { createClient, type ApiClient, type FetchLike } from '@glidepath/api-contract';
import { withCsrfHeader } from './csrf-fetch';
import { withEtagCache } from './etag-fetch';

/** The browser's `fetch`, seen as the contract's structural `FetchLike`. */
const browserFetch: FetchLike = (url, init) =>
  globalThis.fetch(url, { ...init, body: init.body as unknown as BodyInit | undefined });

export interface DataClientOptions {
  /** Origin tier 2 is reached on; `''` (default) is same-origin `/api`. */
  baseUrl?: string;
  /** Transport; default the browser's `fetch`. Tests pass a double or msw-backed fetch. */
  fetch?: FetchLike;
}

/** The typed client with ETag revalidation for the bundle. One per app (it holds the ETag cache). */
export function createDataClient(options: DataClientOptions = {}): ApiClient {
  return createClient(
    options.baseUrl ?? '',
    withCsrfHeader(withEtagCache(options.fetch ?? browserFetch)),
  );
}

const MINUTE = 60_000;

/**
 * How long each resource stays fresh. They are long because tier 2 tells tier 1 when something
 * changed: a `changeset` message invalidates scenarios, inputs, calc and history
 * (`invalidate.ts`); the bundle and members only change with a model or tenant edit.
 */
export const STALE_TIME_MS = {
  me: 30 * MINUTE,
  tenants: 30 * MINUTE,
  bundle: 60 * MINUTE,
  members: 60 * MINUTE,
  scenarios: 15 * MINUTE,
  inputs: 15 * MINUTE,
  calc: 15 * MINUTE,
  history: 15 * MINUTE,
} as const;
