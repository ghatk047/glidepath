import { createStore, useStore } from 'zustand';

/** The four steps of the wizard, in order. */
export const WIZARD_STEPS = [1, 2, 3, 4] as const;
export type WizardStep = (typeof WIZARD_STEPS)[number];

const FIRST = WIZARD_STEPS[0];
const LAST = WIZARD_STEPS[WIZARD_STEPS.length - 1]!;

export interface WizardState {
  /** The step on screen. Module scope (not the URL), so it survives forks and scenario switches. */
  step: WizardStep;
  /** Lever shown in step 2; `null` = the first lever in `levers.families` order. */
  focusLever: string | null;
  setStep(step: WizardStep): void;
  next(): void;
  back(): void;
  setFocusLever(lever: string | null): void;
  reset(): void;
}

const initial = { step: FIRST as WizardStep, focusLever: null };

export const wizardStore = createStore<WizardState>()((set) => ({
  ...initial,
  setStep: (step) => set({ step }),
  next: () => set((s) => ({ step: (s.step < LAST ? s.step + 1 : LAST) as WizardStep })),
  back: () => set((s) => ({ step: (s.step > FIRST ? s.step - 1 : FIRST) as WizardStep })),
  setFocusLever: (focusLever) => set({ focusLever }),
  reset: () => set(initial),
}));

export const useWizard = <T,>(select: (s: WizardState) => T): T => useStore(wizardStore, select);
