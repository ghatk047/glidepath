import type { JsonValue } from '@glidepath/domain';
import { registerHandler } from '../../runtime';
import type { JobContext } from '../../runtime';
import { runApply } from './apply';
import { defaultAiDeps } from './deps';
import type { AiJobDeps } from './deps';
import { runReconfig } from './reconfig';
import { AiJobError, QUEUE_APPLY, QUEUE_RECONFIG } from './types';
import type { ApplyPayload, ReconfigPayload } from './types';

let deps: AiJobDeps | undefined;
/** Production dependencies, created on the first job (the key and the spec files are not read at import time). */
const depsOf = (): AiJobDeps => (deps ??= defaultAiDeps());

const json = (v: unknown): JsonValue => JSON.parse(JSON.stringify(v)) as JsonValue;

function need(ok: boolean, message: string): void {
  if (!ok) throw new AiJobError('bad_payload', message);
}

registerHandler(QUEUE_RECONFIG, async (ctx: JobContext) => {
  const p = ctx.payload as ReconfigPayload;
  need(p.jobId === undefined || typeof p.jobId === 'string', 'ai.reconfig: jobId must be a string.');
  need(p.prompt === undefined || typeof p.prompt === 'string', 'ai.reconfig: prompt must be a string.');
  return json(await runReconfig(ctx, p, depsOf()));
});

registerHandler(QUEUE_APPLY, async (ctx: JobContext) => {
  const p = ctx.payload as ApplyPayload;
  need(typeof p.jobId === 'string', 'ai.apply needs jobId.');
  need(Array.isArray(p.accept) && p.accept.length > 0, 'ai.apply needs accept: ["seed"], ["lever_tuning"] or both.');
  return json(await runApply(ctx, p, depsOf()));
});
