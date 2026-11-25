import { WIZARD_STEPS, useWizard, wizardStore } from './store';
import { COPY } from './copy';

const FIRST = WIZARD_STEPS[0];
const LAST = WIZARD_STEPS[WIZARD_STEPS.length - 1]!;

/** Back and Next. Back is disabled on step 1; Next is hidden on step 4. */
export function StepNav() {
  const step = useWizard((s) => s.step);
  return (
    <div className="gp-wz-navbtns">
      <button
        type="button"
        className="gp-wz-btn"
        data-wizard-back
        disabled={step === FIRST}
        onClick={() => wizardStore.getState().back()}
      >
        {COPY.back}
      </button>
      {step !== LAST && (
        <button
          type="button"
          className="gp-wz-btn"
          data-variant="primary"
          data-wizard-next
          onClick={() => wizardStore.getState().next()}
        >
          {COPY.next}
        </button>
      )}
    </div>
  );
}
