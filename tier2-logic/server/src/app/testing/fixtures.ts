import { TenantId, TenantSlug, UserId } from '@glidepath/api-contract';
import { createDb } from '@glidepath/data-access';
import type { DbHandle } from '@glidepath/data-access';
import { createLogger } from '../logger';
import type { Logger } from '../logger';

export const AUTH_SECRET = 'test-auth-secret-0123456789abcdef';
export const DB_PASSWORD = 'Sup3rS3cretDbPw';
/** Nothing listens on port 1: the pool is lazy, so only code that queries fails. */
export const UNREACHABLE_URL = `postgres://glidepath_app:${DB_PASSWORD}@127.0.0.1:1/glidepath`;

export const ana = UserId.parse('user-ana');
export const bob = UserId.parse('user-bob');
export const aaId = TenantId.parse('11111111-1111-4111-8111-111111111111');
export const aa = TenantSlug.parse('aa');

export function unreachableDb(): DbHandle {
  return createDb(UNREACHABLE_URL, { connectionTimeoutMs: 300 });
}

export function captureLogger(secrets: string[] = [AUTH_SECRET, UNREACHABLE_URL]): { logger: Logger; lines: string[] } {
  const lines: string[] = [];
  return { logger: createLogger({ level: 'debug', secrets, write: (l) => lines.push(l) }), lines };
}
