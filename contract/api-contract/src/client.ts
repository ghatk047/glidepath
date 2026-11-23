import type { z } from 'zod';
import type { ChangesetConflict } from './changeset';
import {
  BYTES_CONTENT_TYPE,
  ContractError,
  errorSchema,
  excerpt,
  isProblemContentType,
  parseOrThrow,
  readBytes,
  readJson,
  routeDef,
  type FetchLike,
  type RouteResult,
} from './http';
import { PROBLEM_CONTENT_TYPE, type Problem } from './problem';
import { apiRoutes, type ApiRoute, type ApiRouteId } from './routes';

/** Per-call options next to the route's own parts. */
export interface CallOptions {
  signal?: AbortSignal;
  /** Extra request headers, e.g. `if-none-match` for the bundle. */
  headers?: Record<string, string>;
}

type ParamsPart<R> = R extends { params: infer P extends z.ZodType }
  ? { params: z.input<P> }
  : { params?: never };
type QueryPart<R> = R extends { query: infer Q extends z.ZodType }
  ? object extends z.input<Q>
    ? { query?: z.input<Q> }
    : { query: z.input<Q> }
  : { query?: never };
type BodyPart<R> = R extends { body: infer B extends z.ZodType }
  ? { body: z.input<B> }
  : { body?: never };

/** Arguments of one route call: path params, query and body as the contract defines them. */
export type RouteArgs<R> = ParamsPart<R> & QueryPart<R> & BodyPart<R> & CallOptions;
type CallArgs<R> = object extends RouteArgs<R> ? [args?: RouteArgs<R>] : [args: RouteArgs<R>];

/** One method per route of `apiRoutes`, resolving to the zod-parsed success body. */
export type ApiClient = {
  [Id in ApiRouteId]: (...args: CallArgs<ApiRoute<Id>>) => Promise<RouteResult<Id>>;
};

/**
 * A non-2xx answer. `problem` is the server's RFC 9457 body, parsed with the route's error
 * schema (`ChangesetConflict` for 409 on the changeset routes) or `Problem`. When the body is
 * not problem JSON (e.g. a proxy's 502 page), `synthetic` is true and `problem` is built here
 * from the status line so the error chip still has one line to show.
 */
export class ApiError<P extends Problem = Problem> extends Error {
  override readonly name = 'ApiError';
  constructor(
    readonly route: ApiRouteId,
    readonly status: number,
    readonly problem: P,
    readonly synthetic: boolean,
  ) {
    super(`${route}: ${status} ${problem.title}: ${problem.detail}`);
  }
}

/** A 409 from `changesetApply` / `changesetRevert`: re-send pending edits on `serverVersion`. */
export const isChangesetConflict = (e: unknown): e is ApiError<ChangesetConflict> =>
  e instanceof ApiError && e.status === 409 && !e.synthetic && 'serverVersion' in e.problem;

const fillPath = (route: string, path: string, params: Record<string, unknown>): string =>
  path.replace(/:([A-Za-z_]+)/g, (_, name: string) => {
    const v = params[name];
    if (v === undefined || v === null) throw new ContractError(route, 'params', `missing :${name}`);
    return encodeURIComponent(String(v));
  });

const queryString = (query: Record<string, unknown> | undefined): string => {
  if (!query) return '';
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined) qs.set(k, String(v));
  const s = qs.toString();
  return s ? `?${s}` : '';
};

/**
 * Typed client for every REST route of the contract (04 §3). Requests are checked against
 * the route's params / query / body schemas before sending, responses are zod-parsed:
 * a success body that does not match throws `ContractError`, a non-2xx answer throws `ApiError`.
 * Byte routes (CON-03): `importCreate` sends its `body` bytes as `application/octet-stream`;
 * `fileDownload` resolves to a `FileDownload` (bytes, content type, filename, size).
 *
 * `baseUrl` is the origin tier 1 reaches tier 2 on (`''` for same-origin `/api`).
 */
export function createClient(baseUrl: string, fetch: FetchLike): ApiClient {
  const base = baseUrl.replace(/\/+$/, '');

  async function call(id: ApiRouteId, args: RouteArgs<unknown> = {}): Promise<unknown> {
    const def = routeDef(id);
    const params = def.params ? parseOrThrow(id, 'params', def.params, args.params) : {};
    const query = def.query ? parseOrThrow(id, 'query', def.query, args.query ?? {}) : undefined;
    const body = def.body ? parseOrThrow(id, 'body', def.body, args.body) : undefined;

    const url = `${base}${fillPath(id, def.path, params)}${queryString(query)}`;
    const bytesIn = def.requestType === 'bytes';
    const bytesOut = def.responseType === 'bytes';
    const headers: Record<string, string> = {
      accept: bytesOut
        ? `*/*, ${PROBLEM_CONTENT_TYPE}`
        : `application/json, ${PROBLEM_CONTENT_TYPE}`,
      ...(body !== undefined
        ? { 'content-type': bytesIn ? BYTES_CONTENT_TYPE : 'application/json' }
        : {}),
      ...args.headers,
    };
    const res = await fetch(url, {
      method: def.method,
      headers,
      ...(body !== undefined
        ? { body: bytesIn ? (body as Uint8Array) : JSON.stringify(body) }
        : {}),
      ...(args.signal ? { signal: args.signal } : {}),
    });

    if (bytesOut && res.status === def.status) {
      return parseOrThrow(id, 'response', def.response, await readBytes(id, res));
    }
    const read = await readJson(res);
    if (res.status === def.status) {
      if (!read.ok) throw new ContractError(id, 'response', `not JSON: ${excerpt(read.text)}`);
      return parseOrThrow(id, 'response', def.response, read.data);
    }
    if (res.status >= 400 && res.status <= 599) {
      if (read.ok && isProblemContentType(res.headers)) {
        const parsed = errorSchema(def, res.status).safeParse(read.data);
        if (parsed.success) throw new ApiError(id, res.status, parsed.data as Problem, false);
      }
      const title = res.statusText?.trim() || `HTTP ${res.status}`;
      throw new ApiError(
        id,
        res.status,
        {
          type: 'about:blank',
          title,
          status: res.status,
          detail: `The server answered ${res.status} ${title} without problem details.`,
        },
        true,
      );
    }
    throw new ContractError(id, 'status', `expected ${def.status}, got ${res.status}`);
  }

  const client = {} as Record<ApiRouteId, (args?: RouteArgs<unknown>) => Promise<unknown>>;
  for (const id of Object.keys(apiRoutes) as ApiRouteId[]) client[id] = (args) => call(id, args);
  return client as unknown as ApiClient;
}
