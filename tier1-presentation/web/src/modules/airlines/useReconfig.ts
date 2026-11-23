import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ApiError,
  type DraftKind,
  type ReconfigApplyResult,
  type ReconfigJob,
  type TenantSlug,
} from '@glidepath/api-contract';
import { dataKeys, useApiClient, useServerState } from '../../data';
import { jobIsLive } from './copy';

/** How often a queued or running job is re-read (`GET /api/ai/reconfig/:id`). */
export const POLL_MS = 1500;
const STORE_KEY = 'gp.airlines.job';

const line = (e: unknown): string =>
  e instanceof ApiError ? e.problem.detail : e instanceof Error ? e.message : 'Request failed';

const remembered = (): string | null => {
  try {
    return window.localStorage.getItem(STORE_KEY);
  } catch {
    return null;
  }
};
const remember = (id: string) => {
  try {
    window.localStorage.setItem(STORE_KEY, id);
  } catch {
    /* per-viewer convenience only */
  }
};

export interface Reconfig {
  /** Dry run answer: plan and cost estimate; nothing queued. */
  estimate: ReconfigJob | null;
  /** The job tier 2 is running or holds for review. */
  job: ReconfigJob | null;
  result: ReconfigApplyResult | null;
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

  // pick up the job this browser last worked on (the cached example, or a running job)
  useEffect(() => {
    const id = remembered();
    if (!id) return;
    api
      .aiReconfigGet({ params: { id } })
      .then((j) => live.current && setJob((cur) => cur ?? j))
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
      remember(j.id);
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
    busy,
    applying,
    error,
    draft,
    start,
    dismissEstimate: () => setEstimate(null),
    apply,
  };
}
