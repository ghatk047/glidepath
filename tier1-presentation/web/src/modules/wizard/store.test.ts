import { beforeEach, describe, expect, it } from 'vitest';
import { WIZARD_STEPS, wizardStore } from './store';

beforeEach(() => wizardStore.getState().reset());

describe('wizard store', () => {
  it('starts on step 1 with no focused lever', () => {
    expect(wizardStore.getState().step).toBe(1);
    expect(wizardStore.getState().focusLever).toBeNull();
    expect([...WIZARD_STEPS]).toEqual([1, 2, 3, 4]);
  });

  it('next and back stay within 1..4', () => {
    const s = wizardStore.getState();
    s.back();
    expect(wizardStore.getState().step).toBe(1);
    for (let i = 0; i < 6; i++) wizardStore.getState().next();
    expect(wizardStore.getState().step).toBe(4);
    wizardStore.getState().back();
    expect(wizardStore.getState().step).toBe(3);
  });

  it('setStep jumps to any step', () => {
    wizardStore.getState().setStep(3);
    expect(wizardStore.getState().step).toBe(3);
  });

  it('keeps focusLever until reset', () => {
    wizardStore.getState().setFocusLever('L03');
    expect(wizardStore.getState().focusLever).toBe('L03');
    wizardStore.getState().setStep(2);
    wizardStore.getState().reset();
    expect(wizardStore.getState().step).toBe(1);
    expect(wizardStore.getState().focusLever).toBeNull();
  });
});
