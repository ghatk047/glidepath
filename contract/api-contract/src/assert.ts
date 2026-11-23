import {
  ContractError,
  errorSchema,
  excerpt,
  isJsonContentType,
  isProblemContentType,
  parseOrThrow,
  readBytes,
  readJson,
  routeDef,
  type ResponseLike,
  type RouteProblem,
  type RouteResult,
} from './http';
import { PROBLEM_CONTENT_TYPE } from './problem';
import type { ApiRoute, ApiRouteId } from './routes';

/**
 * Asserts that a tier 2 response honours the contract of `route`, for route tests
 * (`await assertContract('bundle', await app.request(...))`). Returns the parsed body.
 *
 * Without `status`, the response must be the route's success status with a JSON body that
 * parses with the route's `response` schema. With an error `status` (≥ 400), it must be that
 * status, `application/problem+json`, a body that parses with the route's error schema for it
 * (`ChangesetConflict` for 409 on the changeset routes) or `Problem`, and `body.status` equal
 * to the HTTP status. Throws `ContractError` naming the route and the broken part.
 *
 * A byte-stream route (`fileDownload`) succeeds with a non-JSON body that carries a content
 * type; it comes back as a `FileDownload`.
 */
export async function assertContract<Id extends ApiRouteId>(
  route: Id,
  response: ResponseLike,
): Promise<RouteResult<Id>>;
export async function assertContract<Id extends ApiRouteId, S extends number>(
  route: Id,
  response: ResponseLike,
  status: S,
): Promise<S extends ApiRoute<Id>['status'] ? RouteResult<Id> : RouteProblem<Id, S>>;
export async function assertContract(
  route: ApiRouteId,
  response: ResponseLike,
  status?: number,
): Promise<unknown> {
  const def = routeDef(route);
  const expected = status ?? def.status;
  if (def.responseType === 'bytes' && expected === def.status && response.status === expected) {
    return parseOrThrow(route, 'response', def.response, await readBytes(route, response));
  }
  const read = await readJson(response);

  if (response.status !== expected) {
    throw new ContractError(
      route,
      'status',
      `expected ${expected}, got ${response.status}: ${excerpt(read.text) || '(empty body)'}`,
    );
  }
  if (!read.ok) throw new ContractError(route, 'response', `not JSON: ${excerpt(read.text)}`);

  if (expected === def.status) {
    if (!isJsonContentType(response.headers)) {
      throw new ContractError(
        route,
        'contentType',
        `expected application/json, got ${response.headers.get('content-type') ?? 'none'}`,
      );
    }
    return parseOrThrow(route, 'response', def.response, read.data);
  }

  if (expected < 400 || expected > 599) {
    throw new ContractError(route, 'status', `${expected} is neither ${def.status} nor an error`);
  }
  if (!isProblemContentType(response.headers)) {
    throw new ContractError(
      route,
      'contentType',
      `expected ${PROBLEM_CONTENT_TYPE}, got ${response.headers.get('content-type') ?? 'none'}`,
    );
  }
  const problem = parseOrThrow(route, 'response', errorSchema(def, expected), read.data) as {
    status: number;
  };
  if (problem.status !== expected) {
    throw new ContractError(route, 'response', `problem.status ${problem.status} ≠ ${expected}`);
  }
  return problem;
}
