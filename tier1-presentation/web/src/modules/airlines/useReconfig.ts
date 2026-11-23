import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ApiError,
  type DraftKind,
  type ReconfigApplyResult,
  type ReconfigJob,
  type TenantParity,
  type TenantSlug,
} from '@glidepath/api-contract';
import { dataKeys, useApiClient, useServerState } from '../../data';
import { jobIsLive } from './copy';

/** How often a queued or running job is re-read (`GET /api/ai/reconfig/:id`). */
export const POLL_MS = 1500;

const line = (e: unknown): string =>
  e instanceof ApiError ? e.problem.detail : e instanceof Error ? e.message : 'Request failed';

/**
 * The job the screen picks up from `GET /api/ai/reconfig` (newest first): one tier 2 is running, else the
 * newest it holds for review (the cached example included). Which job that is, tier 2's list says; no id is
 * kept in the browser.
 */
const pickUp = (jobs: readonly ReconfigJob[]): ReconfigJob | null =>
  jobs.find((j) => jobIsLive(j)) ?? jobs.find((j) => j.status === 'review') ?? null;

export interface Reconfig {
  /** Dry run answer: plan and cost estimate; nothing queued. */
  estimate: ReconfigJob | null;
  /** The job tier 2 is running or holds for review. */
  job: ReconfigJob | null;
  result: ReconfigApplyResult | null;
  /** Latest parity tier 2 recorded per tenant (the live tile's "parity n/m"). */
  parity: readonly TenantParity[];
  busy: boolean;
  applying: boolean;
  error: string | null;
  /** Step 0: ask for the plan and the cost. */
  draft(prompt: string, tenant: TenantSlug | null): Promise<void>;
  /** Start the job the estimate priced. */
  start(): Promise<void>;
  dismissEstimate(): void;
  apply(drafts: DraftKind[]): Promise<void>;
}

/** The AI reconfiguration flow over the contract client; every value is shown as tier 2 sent it. */
export function useReconfig(): Reconfig {
  const api = useApiClient();
  const serverState = useServerState();
  const [estimate, setEstimate] = useState<ReconfigJob | null>(null);
  const [asked, setAsked] = useState<{ prompt: string; tenant: TenantSlug | null } | null>(null);
  const [job, setJob] = useState<ReconfigJob | null>(null);
  const [result, setResult] = useState<ReconfigApplyResult | null>(null);
  const [parity, setParity] = useState<readonly TenantParity[]>([]);
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const jobId = job?.id ?? null;
  const polling = jobIsLive(job);

  // pick up the caller's job from tier 2's list (the cached example, or a running job), and the tenants' parity
  useEffect(() => {
    api
      .aiReconfigList({})
      .then((list) => {
        if (!live.current) return;
        setParity(list.parity);
        const found = pickUp(list.jobs);
        if (found) setJob((cur) => cur ?? found);
      })
      .catch(() => undefined);
  }, [api]);

  useEffect(() => {
    if (!polling || !jobId) return;
    const timer = setInterval(() => {
      api
        .aiReconfigGet({ params: { id: jobId } })
        .then((j) => live.current && setJob(j))
        .catch((e: unknown) => live.current && setError(line(e)));
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [api, polling, jobId]);

  const draft = useCallback(
    async (prompt: string, tenant: TenantSlug | null) => {
      setBusy(true);
      setError(null);
      setResult(null);
      try {
        const est = await api.aiReconfigStart({ body: { prompt, tenant, dryRun: true } });
        if (!live.current) return;
        setAsked({ prompt, tenant });
        setEstimate(est);
      } catch (e) {
        if (live.current) setError(line(e));
      } finally {
        if (live.current) setBusy(false);
      }
    },
    [api],
  );

  const start = useCallback(async () => {
    if (!asked) return;
    setBusy(true);
    setError(null);
    try {
      const j = await api.aiReconfigStart({ body: { prompt: asked.prompt, tenant: asked.tenant } });
      if (!live.current) return;
      setEstimate(null);
      setJob(j);
    } catch (e) {
      if (live.current) setError(line(e));
    } finally {
      if (live.current) setBusy(false);
    }
  }, [api, asked]);

  const apply = useCallback(
    async (drafts: DraftKind[]) => {
      if (!jobId) return;
      setApplying(true);
      setError(null);
      try {
        const r = await api.aiReconfigApply({ params: { id: jobId }, body: { drafts } });
        if (!live.current) return;
        setResult(r);
        const j = await api.aiReconfigGet({ params: { id: jobId } });
        if (live.current) setJob(j);
        serverState.invalidate(dataKeys.tenants());
      } catch (e) {
        if (live.current) setError(line(e));
      } finally {
        if (live.current) setApplying(false);
      }
    },
    [api, jobId, serverState],
  );

  return {
    estimate,
    job,
    result,
    parity,
    busy,
    applying,
    error,
    draft,
    start,
    dismissEstimate: () => setEstimate(null),
    apply,
  };
}
