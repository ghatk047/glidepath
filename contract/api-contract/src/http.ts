import { z } from 'zod';
import { PROBLEM_CONTENT_TYPE, Problem } from './problem';
import {
  apiRoutes,
  type ApiRoute,
  type ApiRouteId,
  type HttpMethod,
  type RouteDef,
} from './routes';

/**
 * Structural HTTP types, so the same code runs on the browser's `fetch` / `Response`,
 * Node's undici, msw and Hono's `app.request()` without depending on any of them.
 */
export interface HeadersLike {
  get(name: string): string | null;
}
export interface ResponseLike {
  readonly status: number;
  readonly statusText?: string;
  readonly headers: HeadersLike;
  text(): Promise<string>;
}
export interface RequestInitLike {
  method: HttpMethod;
  headers: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}
export type FetchLike = (url: string, init: RequestInitLike) => Promise<ResponseLike>;

/** Which part of an exchange broke the contract. */
export type ContractPart = 'params' | 'query' | 'body' | 'status' | 'contentType' | 'response';

/**
 * Something on the wire does not match the contract: a request tier 1 built, or a response
 * tier 2 sent. Always a bug in code, never a user error.
 */
export class ContractError extends Error {
  override readonly name = 'ContractError';
  constructor(
    readonly route: string,
    readonly part: ContractPart,
    readonly detail: string,
  ) {
    super(`${route}: ${part} breaks the contract: ${detail}`);
  }
}

/** Parsed success body of a route. */
export type RouteResult<Id extends ApiRouteId> = z.output<ApiRoute<Id>['response']>;

type ErrorSchemas<Id extends ApiRouteId> = ApiRoute<Id> extends { errors: infer E } ? E : object;

/** Parsed error body of a route for status `S`: the route's own error schema, else `Problem`. */
export type RouteProblem<Id extends ApiRouteId, S extends number> = S extends keyof ErrorSchemas<Id>
  ? ErrorSchemas<Id>[S] extends z.ZodType
    ? z.output<ErrorSchemas<Id>[S]>
    : Problem
  : Problem;

export const routeDef = (id: ApiRouteId): RouteDef => {
  const def = (apiRoutes as Record<string, RouteDef>)[id];
  if (!def) throw new Error(`'${String(id)}' is not a route of apiRoutes`);
  return def;
};

/** Schema of the error body a route answers with `status`. */
export const errorSchema = (def: RouteDef, status: number): z.ZodType =>
  def.errors?.[status] ?? Problem;

export const isProblemContentType = (headers: HeadersLike): boolean =>
  (headers.get('content-type') ?? '').toLowerCase().includes(PROBLEM_CONTENT_TYPE);

export const isJsonContentType = (headers: HeadersLike): boolean =>
  /^application\/json\b/i.test((headers.get('content-type') ?? '').trim());

/** Reads a body as JSON; `undefined` for an empty body. */
export async function readJson(
  response: ResponseLike,
): Promise<{ ok: true; data: unknown; text: string } | { ok: false; text: string }> {
  const text = await response.text();
  if (text.trim() === '') return { ok: true, data: undefined, text };
  try {
    return { ok: true, data: JSON.parse(text) as unknown, text };
  } catch {
    return { ok: false, text };
  }
}

/** Parses `data` or throws a `ContractError` naming the route, part and first issues. */
export function parseOrThrow<S extends z.ZodType>(
  route: string,
  part: ContractPart,
  schema: S,
  data: unknown,
): z.output<S> {
  const r = schema.safeParse(data);
  if (r.success) return r.data;
  throw new ContractError(route, part, z.prettifyError(r.error).replace(/\s*\n\s*/g, '; '));
}

/** A short excerpt of a body for error messages. */
export const excerpt = (text: string, max = 200): string => {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length > max ? `${one.slice(0, max)}…` : one;
};
