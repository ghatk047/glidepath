import { PROBLEM_CONTENT_TYPE, Problem, problemTypes } from '@glidepath/api-contract';
import type { Violation } from '@glidepath/api-contract';
import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { ZodError } from 'zod';
import type { AppEnv } from './tenant';

/**
 * Errors are RFC 9457 problem JSON as defined by `@glidepath/api-contract` (`Problem`,
 * `application/problem+json`). `detail` is one line, suitable for the UI's error chip.
 */

export interface ProblemInit {
  status: number;
  title: string;
  detail: string;
  type?: string;
  violations?: Violation[];
}

/** Throw from any handler or middleware to answer with a problem. */
export class ApiError extends Error {
  readonly status: number;
  readonly title: string;
  readonly type: string;
  readonly violations: Violation[] | undefined;

  constructor(init: ProblemInit) {
    super(init.detail);
    this.name = 'ApiError';
    this.status = init.status;
    this.title = init.title;
    this.type = init.type ?? 'about:blank';
    this.violations = init.violations;
  }

  static notFound(detail = 'Nothing exists at this address. Check the URL.'): ApiError {
    return new ApiError({ status: 404, title: 'Not found', detail, type: problemTypes.notFound });
  }
  static unauthenticated(detail = 'You are not signed in. Sign in and try again.'): ApiError {
    return new ApiError({ status: 401, title: 'Unauthenticated', detail, type: problemTypes.unauthenticated });
  }
  static forbidden(detail = 'You do not have permission to do this. Ask a tenant owner for access.'): ApiError {
    return new ApiError({ status: 403, title: 'Forbidden', detail, type: problemTypes.forbidden });
  }
  static badRequest(detail: string): ApiError {
    return new ApiError({ status: 400, title: 'Bad request', detail, type: problemTypes.badRequest });
  }
}

const TITLES: Record<number, string> = {
  400: 'Bad request',
  401: 'Unauthenticated',
  403: 'Forbidden',
  404: 'Not found',
  405: 'Method not allowed',
  409: 'Conflict',
  413: 'Payload too large',
  415: 'Unsupported media type',
  422: 'Validation failed',
  429: 'Too many requests',
  500: 'Internal error',
  503: 'Service unavailable',
};

const TYPE_BY_STATUS: Record<number, string> = {
  400: problemTypes.badRequest,
  401: problemTypes.unauthenticated,
  403: problemTypes.forbidden,
  404: problemTypes.notFound,
  422: problemTypes.validation,
  500: problemTypes.internal,
};

const oneLine = (s: string): string => s.replace(/\s+/g, ' ').trim();

/** Builds a validated `Problem` (so the server can never emit one the contract rejects). */
export function toProblem(init: ProblemInit, instance?: string): Problem {
  const candidate = {
    type: init.type ?? TYPE_BY_STATUS[init.status] ?? 'about:blank',
    title: oneLine(init.title) || 'Error',
    status: init.status,
    detail: oneLine(init.detail) || 'Something went wrong. Try again.',
    ...(instance ? { instance } : {}),
    ...(init.violations ? { violations: init.violations } : {}),
  };
  const parsed = Problem.safeParse(candidate);
  if (parsed.success) return parsed.data;
  return {
    type: problemTypes.internal,
    title: TITLES[500] as string,
    status: 500,
    detail: 'The server produced an invalid error. Try again.',
    ...(instance ? { instance } : {}),
  };
}

/** A `Response` with the problem body, `application/problem+json`. */
export function problemResponse(init: ProblemInit, instance?: string, headers?: ConstructorParameters<typeof Headers>[0]): Response {
  const body = toProblem(init, instance);
  const h = new Headers(headers);
  h.set('content-type', PROBLEM_CONTENT_TYPE);
  return new Response(JSON.stringify(body), { status: body.status, headers: h });
}

function zodDetail(err: ZodError): string {
  const first = err.issues[0];
  if (!first) return 'The request is invalid. Check it and try again.';
  const where = first.path.length > 0 ? ` at ${first.path.join('.')}` : '';
  return `The request is invalid${where}: ${first.message}. Fix it and try again.`;
}

/** Maps any thrown value to problem init. Unknown errors become a generic 500 that leaks nothing. */
export function errorToProblem(err: unknown): ProblemInit {
  if (err instanceof ApiError) {
    return {
      status: err.status,
      title: err.title,
      detail: err.message,
      type: err.type,
      ...(err.violations ? { violations: err.violations } : {}),
    };
  }
  if (err instanceof ZodError) {
    return { status: 422, title: TITLES[422] as string, detail: zodDetail(err), type: problemTypes.validation };
  }
  if (err instanceof HTTPException) {
    const status = err.status >= 400 ? err.status : 500;
    return {
      status,
      title: TITLES[status] ?? 'Error',
      detail: status === 400 && err.message ? err.message : (TITLES[status] ?? 'Error') + '. Try again.',
    };
  }
  if (err instanceof SyntaxError) {
    return { status: 400, title: TITLES[400] as string, detail: 'The request body is not valid JSON. Fix it and try again.', type: problemTypes.badRequest };
  }
  return {
    status: 500,
    title: TITLES[500] as string,
    detail: 'Something went wrong on the server. Try again; if it persists, tell an administrator.',
    type: problemTypes.internal,
  };
}

/** `app.onError` handler: logs (scrubbed) and answers with problem JSON. */
export function errorHandler() {
  return (err: Error, c: Context<AppEnv>): Response => {
    const init = errorToProblem(err);
    if (init.status >= 500) c.get('log').error('request failed', { err, method: c.req.method, path: c.req.path });
    return problemResponse(init, c.req.path);
  };
}

/** `app.notFound` handler. */
export function notFoundHandler(c: Context): Response {
  return problemResponse(
    { status: 404, title: 'Not found', detail: `No route for ${c.req.method} ${c.req.path}.`, type: problemTypes.notFound },
    c.req.path,
  );
}
