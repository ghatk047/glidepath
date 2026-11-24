import { WIZARD_STEPS, useWizard, wizardStore, type WizardStep } from './store';
import { COPY } from './copy';
import { StepNav } from './StepNav';

/**
 * Four steps as buttons (`aria-current="step"` on the one on screen) and Back / Next. Any step can
 * be clicked: the order is a guide, not a gate.
 */
export function Stepper() {
  const step = useWizard((s) => s.step);
  const go = (n: WizardStep) => wizardStore.getState().setStep(n);
  return (
    <nav className="gp-wz-stepper" data-wizard-stepper aria-label={COPY.stepsLabel}>
      <ol className="gp-wz-steps">
        {WIZARD_STEPS.map((n) => (
          <li key={n}>
            <button
              type="button"
              className="gp-wz-step"
              data-step={n}
              aria-current={n === step ? 'step' : undefined}
              onClick={() => go(n)}
            >
              <span className="gp-wz-dot" aria-hidden="true">
                {n}
              </span>
              <span className="gp-wz-step-label">{COPY.steps[n]}</span>
            </button>
          </li>
        ))}
      </ol>
      <StepNav />
    </nav>
  );
}
