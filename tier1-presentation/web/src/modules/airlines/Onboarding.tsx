import type { ReconfigJob } from '@glidepath/api-contract';
import { GlassPanel } from '@glidepath/ui/glass';
import { CHECKLIST, COPY, type StepState } from './copy';
import { checklistStates } from './model';

const WORD: Record<StepState, string> = { done: COPY.done, review: COPY.inReview, todo: COPY.toDo };
const GLYPH: Record<StepState, string> = { done: '✓', review: '●', todo: '' };

/** Onboarding (07 §2): the nine checklist steps, each done / in review / to do. */
export function Onboarding({ job }: { job: ReconfigJob | null }) {
  const states = checklistStates(job);
  const done = CHECKLIST.filter((c) => states[c.id] === 'done').length;
  const name = job?.plan?.tenant.name;
  return (
    <GlassPanel
      span={5}
      className="gp-airlines-onboarding"
      header={{
        label: `${name ?? ''} ${COPY.onboarding}`.trim(),
        status: job ? (
          <span>
            {done} of {CHECKLIST.length}
          </span>
        ) : undefined,
      }}
    >
      {job ? null : <p className="gp-airlines-sub">{COPY.onboardingEmpty}</p>}
      <ol className="gp-airlines-checklist" aria-label="Onboarding checklist">
        {CHECKLIST.map((c) => (
          <li key={c.id} data-step={c.id} data-state={states[c.id]}>
            <span className="gp-airlines-check" aria-hidden="true">
              {GLYPH[states[c.id]]}
            </span>
            <span className="gp-airlines-check-label">{c.label}</span>
            <span className="gp-airlines-check-state">{WORD[states[c.id]]}</span>
          </li>
        ))}
      </ol>
    </GlassPanel>
  );
}
