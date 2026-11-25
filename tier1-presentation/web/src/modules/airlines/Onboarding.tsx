import type { ReconfigJob } from '@glidepath/api-contract';
import { GlassPanel } from '@glidepath/ui/glass';
import { COPY, stepLabel, type StepState } from './copy';

const WORD: Record<StepState, string> = { done: COPY.done, review: COPY.inReview, todo: COPY.toDo };
const GLYPH: Record<StepState, string> = { done: '✓', review: '●', todo: '' };

/** Onboarding (07 section 2): the steps tier 2 sent on the job, each done / in review / to do, as sent. */
export function Onboarding({ job }: { job: ReconfigJob | null }) {
  const onboarding = job?.onboarding;
  const steps = onboarding?.steps ?? [];
  const name = job?.plan?.tenant.name;
  return (
    <GlassPanel
      span={5}
      className="gp-airlines-onboarding"
      header={{
        label: `${name ?? ''} ${COPY.onboarding}`.trim(),
        status:
          onboarding && onboarding.total > 0 ? (
            <span>
              {onboarding.done} of {onboarding.total}
            </span>
          ) : undefined,
      }}
    >
      {steps.length === 0 ? <p className="gp-airlines-sub">{COPY.onboardingEmpty}</p> : null}
      <ol className="gp-airlines-checklist" aria-label="Onboarding checklist">
        {steps.map((s) => (
          <li key={s.id} data-step={s.id} data-state={s.state}>
            <span className="gp-airlines-check" aria-hidden="true">
              {GLYPH[s.state]}
            </span>
            <span className="gp-airlines-check-label">{stepLabel(s.id)}</span>
            <span className="gp-airlines-check-state">{WORD[s.state]}</span>
          </li>
        ))}
      </ol>
    </GlassPanel>
  );
}
