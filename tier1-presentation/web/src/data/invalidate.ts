import { useEffect } from 'react';
import type { ServerMessage, TenantSlug } from '@glidepath/api-contract';
import { dataKeys } from './keys';
import { useServerState } from './provider';
import type { ServerState } from './server-state';

type ChangesetMessage = Extract<ServerMessage, { type: 'changeset' }>;

/**
 * A commit landed on a scenario (this user's or another's): what tier 2 holds for it changed.
 * Invalidates the scenario list (version, `forkedFrom`), the scenario's history, its calc and
 * its resolved inputs. Mounted hooks refetch now, the rest on next use. The bundle, members,
 * me and tenants do not depend on a commit and stay cached. Resolves when the refetches settle.
 */
export async function invalidateForChangeset(
  serverState: ServerState,
  tenant: TenantSlug,
  message: Pick<ChangesetMessage, 'scenarioId' | 'forkedFrom'>,
): Promise<void> {
  const ids = [message.scenarioId, message.forkedFrom].filter(
    (id, i, all): id is NonNullable<typeof id> => id != null && all.indexOf(id) === i,
  );
  await Promise.all([
    serverState.invalidate(dataKeys.scenarios(tenant), { exact: true }),
    ...ids.flatMap((id) => [
      serverState.invalidate(dataKeys.history(tenant, id)),
      serverState.invalidate(dataKeys.calc(tenant, id)),
      serverState.invalidate(dataKeys.inputs(tenant, id)),
    ]),
  ]);
}

/** Feeds any server message; only `changeset` does anything. */
export function onServerMessage(
  serverState: ServerState,
  tenant: TenantSlug,
  message: ServerMessage,
): void {
  if (message.type === 'changeset') void invalidateForChangeset(serverState, tenant, message);
}

/**
 * Where parsed server messages come from: the session client (WEB-03) or a test. Subscribing
 * returns the unsubscribe function.
 */
export type ServerMessageSource = (listener: (message: ServerMessage) => void) => () => void;

/** Binds `changeset` messages from `source` to cache invalidation for `tenant`; returns unbind. */
export function bindChangesetInvalidation(
  serverState: ServerState,
  tenant: TenantSlug,
  source: ServerMessageSource,
): () => void {
  return source((message) => onServerMessage(serverState, tenant, message));
}

/** Hook form of `bindChangesetInvalidation`; `source` should be stable (memoized). */
export function useChangesetInvalidation(tenant: TenantSlug, source: ServerMessageSource): void {
  const serverState = useServerState();
  useEffect(
    () => bindChangesetInvalidation(serverState, tenant, source),
    [serverState, tenant, source],
  );
}
