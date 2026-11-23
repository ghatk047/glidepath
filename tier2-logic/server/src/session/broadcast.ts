import { WS_PROTOCOL_VERSION } from '@glidepath/api-contract';
import type { Logger } from '../app/logger';
import type { ChangeNotice } from '../routes/write/hub';
import type { ScenarioLoader, ScenarioState } from './loader';
import type { ChangesetMessage, Session } from './session';

/**
 * Commit broadcast (API-07, CON-02 `SessionStep` 3 and `ChangesetApplied`): once a changeset or revert has
 * committed, every session open on the scenario adopts it.
 *
 * - Who: sessions of the notice's tenant on `result.scenarioId`; and, when the commit forked a locked
 *   preset (`forkedFrom`), the author's sessions on that preset, which follow the fork. Other sessions on
 *   the preset are not moved and get nothing (the preset did not change).
 * - What: the scenario is read once from tier 3 (sessions are a cache; the read runs after the commit, so it
 *   sees it), then each session queues `changeset{…}`, `delta{null}` and its rebase behind the frames it
 *   already received (`Session.applyCommit`).
 * - When: before the POST is answered (`afterCommitMiddleware` awaits the hub), so a client's
 *   `cancelPreview` after its POST settles always reaches the session after the commit.
 */
export async function broadcastChange(
  sessions: Iterable<Session>,
  notice: ChangeNotice,
  loader: ScenarioLoader,
  logger?: Logger,
): Promise<number> {
  const { result } = notice;
  const targets: { session: Session; on: string }[] = [];
  for (const s of sessions) {
    if (s.isClosed || s.tenant.tenantId !== notice.tenantId) continue;
    if (s.scenarioId === result.scenarioId) targets.push({ session: s, on: result.scenarioId });
    else if (result.forkedFrom !== undefined && s.scenarioId === result.forkedFrom && notice.author?.id === s.userId) {
      targets.push({ session: s, on: result.forkedFrom });
    }
  }
  if (targets.length === 0) return 0;

  let state: ScenarioState | null = null;
  try {
    state = await loader.load({ tenantId: notice.tenantId, userId: targets[0]!.session.userId }, result.scenarioId);
  } catch (err) {
    logger?.error('session commit reload failed', { err, scenario: result.scenarioId });
  }
  const message: ChangesetMessage = {
    v: WS_PROTOCOL_VERSION,
    type: 'changeset',
    scenarioId: result.scenarioId,
    version: result.version,
    editsCount: result.editsCount,
    ...(result.forkedFrom === undefined ? {} : { forkedFrom: result.forkedFrom }),
    changesetId: result.changesetId,
    origin: notice.origin,
    author: notice.author,
  };
  await Promise.all(targets.map((t) => t.session.applyCommit({ on: t.on, state, message })));
  logger?.debug('session commit broadcast', { scenario: result.scenarioId, sessions: targets.length, kind: notice.kind });
  return targets.length;
}
