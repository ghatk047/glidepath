import { ChangesetConflict, problemTypes } from '@glidepath/api-contract';
import type { Violation } from '@glidepath/api-contract';
import {
  CHANGE_ROW_TARGET_KIND,
  ChangesetConflictError,
  ChangesetDraftError,
  ChangesetNotFoundError,
  ChangesetRejectedError,
  ScenarioNotFoundError,
  ScenarioOperationError,
  ScenarioPermissionError,
  messagesOf,
} from '@glidepath/domain';
import type { ValidationEntry } from '@glidepath/domain';
import type { Context } from 'hono';
import { ApiError } from '../../app/problem';
import type { AppEnv } from '../../app/tenant';
import { checked } from '../read/mappers';

const oneLine = (s: string): string => s.replace(/\s+/g, ' ').trim();

export const toViolation = (e: ValidationEntry): Violation => ({
  rule: e.rule,
  cells: [...e.cells] as Violation['cells'],
  severity: e.severity,
  message: oneLine(e.message) as Violation['message'],
});

/**
 * The 409 of the contract: the server's version and every change committed since the client's
 * `baseVersion`, so the client can rebase. Nothing of the request was applied.
 */
export function conflictResponse(c: Context<AppEnv>, err: ChangesetConflictError): Response {
  const changesSince = err.changesSince.flatMap((cs) =>
    cs.changes.map((r) => {
      const note = messagesOf(r).note;
      return {
        changesetId: cs.id,
        seq: r.seq,
        target: CHANGE_ROW_TARGET_KIND[r.target],
        key: r.key,
        member: r.member_key,
        op: r.op,
        oldValue: r.old_value,
        newValue: r.new_value,
        ...(note === undefined ? {} : { note }),
      };
    }),
  );
  const body = checked('conflict', ChangesetConflict, {
    type: problemTypes.versionConflict,
    title: 'Conflict',
    status: 409,
    detail: oneLine(err.message),
    instance: c.req.path,
    serverVersion: err.serverVersion,
    changesSince,
  });
  return new Response(JSON.stringify(body), {
    status: 409,
    headers: { 'content-type': 'application/problem+json' },
  });
}

/** Domain errors as the problems the contract names (404, 403, 422); anything else is returned as is. */
export function translate(err: unknown): unknown {
  if (err instanceof ScenarioNotFoundError || err instanceof ChangesetNotFoundError) {
    const what = err instanceof ScenarioNotFoundError ? 'scenario' : 'changeset';
    return ApiError.notFound(`No such ${what} in this tenant. Check the id.`);
  }
  if (err instanceof ScenarioPermissionError) return ApiError.forbidden(oneLine(err.message));
  if (err instanceof ChangesetRejectedError) {
    return new ApiError({
      status: 422,
      title: 'Validation failed',
      detail: err.message,
      type: problemTypes.validation,
      violations: err.violations.map(toViolation),
    });
  }
  if (err instanceof ChangesetDraftError || err instanceof ScenarioOperationError) {
    return new ApiError({
      status: 422,
      title: 'Validation failed',
      detail: err.message,
      type: problemTypes.validation,
    });
  }
  return err;
}

/** Run a handler body: a version conflict answers the 409 body, other domain errors become problems. */
export async function guarded(c: Context<AppEnv>, fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ChangesetConflictError) return conflictResponse(c, err);
    throw translate(err);
  }
}
