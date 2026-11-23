import { useState } from 'react';
import type { CostEstimate, ReconfigJob, TenantSlug } from '@glidepath/api-contract';
import { GlassPanel } from '@glidepath/ui/glass';
import { PromptBar } from '@glidepath/ui/inputs/controls';
import { fmt } from '@glidepath/ui/format';
import { COPY, PIPELINE, jobIsLive } from './copy';
import { pipelineStates } from './model';
import { Review } from './Review';
import type { Reconfig } from './useReconfig';

/** Cost line: tokens, dollars and the per-job budget exactly as tier 2 sent them. */
function Estimate({ cost, r }: { cost: CostEstimate; r: Reconfig }) {
  return (
    <div className="gp-airlines-estimate" role="group" aria-label={COPY.estimate}>
      <p>
        <strong>{COPY.estimate}</strong> · {cost.model} · {cost.inputTokens} in /{' '}
        {cost.outputTokens} out tokens · {fmt.money(cost.usd)} · budget {cost.maxTokens} tokens
      </p>
      {r.estimate?.plan ? (
        <p className="gp-airlines-plan-line">
          {r.estimate.plan.tenant.name} · {r.estimate.plan.baseYear} → {r.estimate.plan.targetYear}
        </p>
      ) : null}
      <div className="gp-airlines-row">
        <button
          type="button"
          className="gp-airlines-primary"
          disabled={r.busy}
          onClick={() => void r.start()}
        >
          {COPY.startJob}
        </button>
        <button type="button" className="gp-airlines-action" onClick={r.dismissEstimate}>
          {COPY.cancelEstimate}
        </button>
      </div>
    </div>
  );
}

function Progress({ job }: { job: ReconfigJob }) {
  if (!jobIsLive(job)) return null;
  return (
    <div className="gp-airlines-job" data-status={job.status}>
      <span className="gp-airlines-job-note">{job.progressNote ?? 'Working…'}</span>
      <progress
        aria-label="Job progress"
        max={1}
        value={job.progress}
        aria-valuetext={job.progressNote ?? undefined}
      />
    </div>
  );
}

export interface ReconfigPanelProps {
  r: Reconfig;
  /** Prompt prefilled by a tile; `key` changes when a tile is pressed again. */
  seed: { prompt: string; tenant: TenantSlug | null; n: number } | null;
}

/** Reconfigure with AI (03_screens): prompt, four steps, review, global / per airline / upgrades. */
export function ReconfigPanel({ r, seed }: ReconfigPanelProps) {
  const [tenant, setTenant] = useState<TenantSlug | null>(null);
  const [text, setText] = useState('');
  const [seen, setSeen] = useState<number | null>(null);
  if (seed && seed.n !== seen) {
    setSeen(seed.n);
    setText(seed.prompt);
    setTenant(seed.tenant);
  }
  const states = pipelineStates(
    r.job,
    PIPELINE.map((p) => p.id),
  );
  return (
    <GlassPanel
      span={7}
      className="gp-airlines-reconfig"
      header={{
        label: COPY.reconfigure,
        status: <span className="gp-chip">{COPY.nothingWritten}</span>,
      }}
    >
      <PromptBar
        value={text}
        label={COPY.promptLabel}
        placeholder={COPY.promptPlaceholder}
        submitLabel={COPY.draftButton}
        onChange={setText}
        onSubmit={(p) => void r.draft(p, tenant)}
      />
      {r.error ? (
        <p className="gp-airlines-error" role="alert">
          {r.error}
        </p>
      ) : null}
      {r.estimate ? <Estimate cost={r.estimate.costEstimate} r={r} /> : null}
      <ol className="gp-airlines-steps" aria-label="Reconfiguration steps">
        {PIPELINE.map((p, i) => (
          <li
            key={p.id}
            data-step={p.id}
            data-state={states[i]}
            aria-current={states[i] === 'active' ? 'step' : undefined}
          >
            {i + 1} · {p.label}
          </li>
        ))}
      </ol>
      {r.job ? <Progress job={r.job} /> : null}
      {r.job && !jobIsLive(r.job) ? <Review r={r} job={r.job} /> : null}
      <dl className="gp-airlines-scopes">
        {[COPY.global, COPY.perAirline, COPY.upgrades].map(([t, d]) => (
          <div key={t}>
            <dt>{t}</dt>
            <dd>{d}</dd>
          </div>
        ))}
      </dl>
    </GlassPanel>
  );
}
