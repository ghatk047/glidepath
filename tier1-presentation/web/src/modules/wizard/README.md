# modules/wizard

Build module ("Build a plan"): Levers, Tune, Policy, Result. Plan: `docs/ux/07_wizard_tour_plan.md` §3.

## WIZ-05 (frame and steps 1-2)

| File | Role |
|---|---|
| `index.tsx` | Screen: `JobsProvider`, `OptimizerProvider`, stepper, tape, keyed step stage. Mounts `wizardCss`. |
| `Stepper.tsx`, `StepNav.tsx` | `[data-wizard-stepper]`, step buttons (`aria-current="step"`), `[data-wizard-back]`, `[data-wizard-next]`. Any step is clickable. |
| `Tape.tsx` | `[data-wizard-tape]`: `res.tot_iy` − `res.tot_ot_it` = `res.net` vs `res.bar`, `res.gap` chip, meter, **Find a path** (`[data-wizard-optimize]`). Busy without a job id: inline `ComputeFlow`; with one: `JobHeader`. |
| `StepLevers.tsx` | Step 1: `levers.families` rows with `lev.on` toggles; families panel. A name click focuses the lever and opens step 2. |
| `StepTune.tsx` | Step 2: chosen levers (`lev.on` = 1), KPIs, decision sliders, Assumptions (`<details>`: estimates and `lev.conf` dial). `moved` ids get `data-moved` and an accent dot. |
| `copy.ts`, `styles.ts` | Copy and tokens-only CSS. |
| `store.ts` | Frozen (WIZ-02). Step state is module scope, so it survives forks. |

No arithmetic on received values: bars and the meter are CSS `--value / --max`.
`StepPolicy`, `StepResult`, `optimizer.tsx` belong to WIZ-06.
