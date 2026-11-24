import { useMemo, type ReactNode } from 'react';
import { useBindContext } from '../../bind';
import { useApiClient } from '../../data';
import { JobsProvider, solverRunCanceller } from '../../jobs';
import { COPY } from './copy';
import { OptimizerProvider } from './optimizer';
import { StepLevers } from './StepLevers';
import { StepPolicy } from './StepPolicy';
import { StepResult } from './StepResult';
import { StepTune } from './StepTune';
import { Stepper } from './Stepper';
import { useWizard, type WizardStep } from './store';
import { wizardCss } from './styles';
import { Tape } from './Tape';

function WizardStyles() {
  return (
    <style href="glidepath-wizard" precedence="glidepath">
      {wizardCss}
    </style>
  );
}

/** Job plumbing of the tape and the optimizer: `job` messages from the session, cancel by id. */
function WizardJobs({ children }: { children: ReactNode }) {
  const { tenant, session } = useBindContext();
  const api = useApiClient();
  const cancel = useMemo(() => solverRunCanceller(api, tenant), [api, tenant]);
  return (
    <JobsProvider session={session} cancel={cancel}>
      {children}
    </JobsProvider>
  );
}

const STEP_VIEW: Record<WizardStep, () => ReactNode> = {
  1: () => <StepLevers />,
  2: () => <StepTune />,
  3: () => <StepPolicy />,
  4: () => <StepResult />,
};

/** Keyed by step so each step eases in; the step lives in the module store, not the URL. */
function Stage() {
  const step = useWizard((s) => s.step);
  return (
    <div className="gp-wz-stage" key={step}>
      {STEP_VIEW[step]()}
    </div>
  );
}

/**
 * Build · "Build a plan" (WIZ-05). Stepper and the running-total tape stay on every step; the
 * step on screen is the module store's, so it survives a fork (the URL's scenario changes on the
 * first edit). Every number is a bound node or variable; nothing is computed here.
 */
export default function Wizard() {
  return (
    <main className="gp-module gp-wizard" data-module="wizard" aria-label={COPY.title}>
      <WizardStyles />
      <WizardJobs>
        <OptimizerProvider>
          <Stepper />
          <Tape />
          <Stage />
        </OptimizerProvider>
      </WizardJobs>
    </main>
  );
}
