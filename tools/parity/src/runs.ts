/**
 * The run configurations of PORTING.md §6 (from run_tests.py): each is a seed preset plus an optional
 * `extra` (values and overrides layered on top, as `Model.run(scenario, extra)`).
 */
import {
  compileModel,
  findScenario,
  resolveInputs,
  type EngineModel,
  type Evaluation,
  type ExtraInputs,
} from '@glidepath/engine';
import type { ModelBundle, TenantSeed } from '@glidepath/spec';

/** The run flags of run_tests.py: `corp.it_swb_mode` off in PARITY, `g.chargeback_on` off in CB_OFF. */
const SWB_MODE_OFF = { 'corp.it_swb_mode': 0 } as const;
const CHARGEBACK_OFF = { 'g.chargeback_on': 0 } as const;
/** The preset CB_OFF runs on. */
const CB_OFF_PRESET = 'C';

export interface RunConfig {
  /** `PARITY(C)`, `CB_OFF`, `PLAIN(rates)`, … */
  readonly name: string;
  readonly preset: string;
  readonly extra?: ExtraInputs;
}

/** `PLAIN(sid)`: the preset only (run_tests.py `m.run(sid)`). */
export function plainRun(preset: string): RunConfig {
  return { name: `PLAIN(${preset})`, preset };
}

/** `PARITY(sid)`: the preset + parity_report.parity_overrides + `{corp.it_swb_mode: 0}`. */
export function parityRun(
  preset: string,
  parityOverrides: Readonly<Record<string, number>>,
): RunConfig {
  return {
    name: `PARITY(${preset})`,
    preset,
    extra: { overrides: parityOverrides, values: SWB_MODE_OFF },
  };
}

/** `CB_OFF`: preset C + `{g.chargeback_on: 0}`, no overrides. */
export function cbOffRun(): RunConfig {
  return { name: 'CB_OFF', preset: CB_OFF_PRESET, extra: { values: CHARGEBACK_OFF } };
}

/** One compiled seed model; evaluations cached per run name. */
export class Runner {
  readonly model: EngineModel;
  private readonly cache = new Map<string, Evaluation>();

  constructor(
    readonly bundle: ModelBundle,
    readonly seed: TenantSeed,
  ) {
    this.model = compileModel(bundle, seed.dimensionMembers);
  }

  run(config: RunConfig): Evaluation {
    let ev = this.cache.get(config.name);
    if (ev === undefined) {
      const scenario = findScenario(this.seed.scenarios, config.preset);
      const inputs = resolveInputs(this.bundle, this.seed.variableValues, scenario, config.extra);
      ev = this.model.evaluate(inputs.values, inputs.overrides);
      this.cache.set(config.name, ev);
    }
    return ev;
  }
}
