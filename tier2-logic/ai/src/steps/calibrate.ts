import { nodeMemberKeys, RULE_TOLERANCE } from '@glidepath/domain';
import type { CompiledModel } from '@glidepath/engine';
import type { InputValue, Member, ModelBundle } from '@glidepath/spec';
import { CALIBRATION, type CalibrationConfig, normaliseLabel } from '../calibration/catalog';
import { type RepairPromptVariable, renderCalibrationRepairPrompt, type CalibrationRepairPromptInput } from '../prompts/render';
import { systemBlocks } from '../prompts/system';
import type { ReviewFlag } from '../review';
import {
  CalibrationRepair,
  type CalibrationReport,
  type CalibrationRound,
  type CalibrationTarget,
  type InvariantResult,
  type MetricResult,
  type RepairChangeRecord,
  type ValidationReport,
} from '../schemas/calibration';
import type { Fact, FactBase } from '../schemas/facts';
import type { ValueProvenance } from '../schemas/seed';
import { defineStep, type ModelClient, type Step } from '../step';
import { type CompileDraft, defaultCompile, draftStates, errorMessage, evaluateState } from './draft-model';
import { type StepCall, stepCall, type StepResult } from './result';
import { type SeedDraft, validateDraft } from './validate';

/** The checklist step calibration flags belong to (spec 07 §2 item 6). */
const CALIBRATION_STEP = 'corporate_drivers' as const;

/** Thrown when the draft has no single last reported year to rebuild (a year dimension without one root). */
export class CalibrationSetupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CalibrationSetupError';
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The last reported year and the targets

/**
 * The year member the engine rebuilds as the last reported fiscal year: the root of the year chain, the one member
 * whose `prev` attribute is empty (its node cells take the reported-year case, e.g. `corp.asm25`).
 */
export function lastReportedYear(members: Readonly<Record<string, readonly Member[]>>, config: CalibrationConfig = CALIBRATION): Member {
  const years = members[config.year.dim] ?? [];
  const roots = years.filter((m) => {
    const prev = m[config.year.prevAttribute];
    return prev === undefined || prev === null || prev === '';
  });
  if (roots.length !== 1)
    throw new CalibrationSetupError(
      `Dimension '${config.year.dim}' needs exactly one member without '${config.year.prevAttribute}' (the last reported year); found ${roots.length}.`,
    );
  return roots[0]!;
}

const CONFIDENCE_RANK = { H: 0, M: 1, L: 2 } as const;

/** The factor that converts a fact's unit to the engine's $M, or undefined for a unit not in the data. */
function unitFactor(unit: string, config: CalibrationConfig): number | undefined {
  const u = normaliseLabel(unit);
  return config.units.find((x) => x.names.some((n) => normaliseLabel(n) === u))?.factor;
}

/**
 * The reported figures of the last reported fiscal year among the step 2 facts: per metric, a numeric fact of that
 * year (its `period` names the year) whose label is one of the metric's aliases (compared normalised, the first alias
 * that matches wins, then the higher confidence), converted to $M. A metric without such a fact gets no target; the
 * calibration report shows it as missing.
 */
export function targetsFromFacts(facts: FactBase, reportedYear: number, config: CalibrationConfig = CALIBRATION): CalibrationTarget[] {
  const year = String(reportedYear);
  const usable = facts.facts.filter(
    (f): f is Fact & { value: number } =>
      typeof f.value === 'number' && f.period !== null && f.period.includes(year) && unitFactor(f.unit, config) !== undefined,
  );
  const targets: CalibrationTarget[] = [];
  for (const metric of config.metrics) {
    for (const alias of metric.aliases.map(normaliseLabel)) {
      const hits = usable
        .filter((f) => normaliseLabel(f.label) === alias)
        .sort((a, b) => CONFIDENCE_RANK[a.confidence] - CONFIDENCE_RANK[b.confidence]);
      const f = hits[0];
      if (!f) continue;
      targets.push({ metric: metric.id, value: f.value * unitFactor(f.unit, config)!, source: f.sourceUrl ?? f.sourceTitle, factIds: [f.id] });
      break;
    }
  }
  return targets;
}

// ---------------------------------------------------------------------------------------------------------------
// Rebuild and invariants

/** Rebuild the last reported year on the tenant defaults and compare each metric with its target. */
function rebuild(
  model: CompiledModel | null,
  draft: SeedDraft,
  bundle: ModelBundle,
  year: string,
  targets: readonly CalibrationTarget[],
  round: number,
  config: CalibrationConfig,
  compileError: string | null,
): CalibrationRound {
  const byMetric = new Map(targets.map((t) => [t.metric, t]));
  let evaluation: ReturnType<typeof evaluateState> | null = null;
  let error = compileError;
  if (model) {
    try {
      evaluation = evaluateState(model, draftStates(draft, bundle)[0]!);
    } catch (e) {
      error = `The draft does not evaluate: ${errorMessage(e)}`;
    }
  }
  const metrics: MetricResult[] = config.metrics.map((m) => {
    const cell = `${m.node}[${year}]`;
    const target = byMetric.get(m.id);
    const modelValue = evaluation?.has(cell) ? evaluation.get(cell) : null;
    const reported = target?.value ?? null;
    const residual = reported !== null && modelValue !== null ? modelValue - reported : null;
    const relative = residual !== null && reported !== 0 ? residual / Math.abs(reported!) : null;
    const tied =
      residual !== null && Number.isFinite(residual) && (relative !== null ? Math.abs(relative) <= config.tolerance : residual === 0);
    return {
      metric: m.id,
      cell,
      reported,
      model: modelValue !== null && Number.isFinite(modelValue) ? modelValue : null,
      residual: residual !== null && Number.isFinite(residual) ? residual : null,
      relative: relative !== null && Number.isFinite(relative) ? relative : null,
      status: reported === null ? 'missing' : tied ? 'tied' : 'miss',
      factIds: target ? [...target.factIds] : [],
    };
  });
  return { round, tied: error === null && metrics.every((m) => m.status === 'tied'), metrics, error };
}

const close = (a: number, b: number): boolean => Math.abs(a - b) <= RULE_TOLERANCE * Math.max(1, Math.abs(a), Math.abs(b));

/**
 * The invariants of 06 §4 on the tenant defaults and on every scenario of the draft (data: `calibration.json`
 * `invariants`): pool effects sum to run-rate (`lev.rr_check` = 0), VP nets sum to total (`vp.check` = 0), and the
 * base and IT columns of the same input year have identical revenue (`pl.rev[fy27b]` = `pl.rev[fy27it]`).
 * A pinned cell is not checked: a pin replaces the engine's arithmetic by design.
 */
export function checkInvariants(
  draft: SeedDraft,
  bundle: ModelBundle,
  opts: { compile?: CompileDraft; config?: CalibrationConfig; model?: CompiledModel } = {},
): InvariantResult[] {
  const config = opts.config ?? CALIBRATION;
  const model = opts.model ?? (opts.compile ?? defaultCompile)(bundle, draft.dimensionMembers);
  const nodes = new Map(bundle.nodes.map((n) => [n.id, n]));
  const years = draft.dimensionMembers[config.year.dim] ?? [];
  const out: InvariantResult[] = [];
  for (const state of draftStates(draft, bundle)) {
    const ev = evaluateState(model, state);
    const value = (cell: string): number | null => (ev.has(cell) && !state.overrides.has(cell) ? ev.get(cell) : null);
    for (const inv of config.invariants) {
      const failing: { cell: string; value: number }[] = [];
      if (inv.kind === 'zero') {
        const node = nodes.get(inv.node);
        for (const key of node ? nodeMemberKeys(node, draft.dimensionMembers) : []) {
          const cell = key === '' ? inv.node : `${inv.node}[${key}]`;
          const v = value(cell);
          if (v !== null && !(Math.abs(v) <= RULE_TOLERANCE)) failing.push({ cell, value: v });
        }
      } else {
        const groups = new Map<string, string[]>();
        for (const y of years) {
          const input = y[config.year.inputYearAttribute];
          if (typeof input === 'string') groups.set(input, [...(groups.get(input) ?? []), y.id]);
        }
        for (const ids of groups.values()) {
          const cells = ids.map((id) => ({ cell: `${inv.node}[${id}]`, value: value(`${inv.node}[${id}]`) }));
          const known = cells.filter((c): c is { cell: string; value: number } => c.value !== null);
          if (known.some((c) => !close(c.value, known[0]!.value))) failing.push(...known);
        }
      }
      out.push({ id: inv.id, scope: state.scope, holds: failing.length === 0, failing });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// The repair round

/** Pipeline step 5 on a miss (06 §2): one call with the residuals, structured output `CalibrationRepair`, effort `high`. */
export const calibrationRepairStep: Step<CalibrationRepairPromptInput, CalibrationRepair> = defineStep({
  id: 'calibration-repair',
  effort: 'high',
  output: CalibrationRepair,
  system: systemBlocks('calibration_repair'),
  prompt: renderCalibrationRepairPrompt,
});

/** The registry variables a repair may change (layers of `repairLayers`) that the draft sets, with their values. */
function repairVariables(draft: SeedDraft, bundle: ModelBundle, config: CalibrationConfig): RepairPromptVariable[] {
  return bundle.variables
    .filter((v) => config.repairLayers.includes(v.layer) && v.id in draft.variableValues)
    .map((v) => {
      const value = draft.variableValues[v.id]!;
      return {
        id: v.id,
        label: v.label,
        unit: v.unit,
        dims: [...v.dims],
        min: v.min,
        max: v.max,
        value: typeof value === 'number' ? value : Object.entries(value).map(([key, x]) => ({ key, value: x })),
      };
    });
}

/** Apply the repair's changes to a copy of the draft; changes outside the repairable variables are dropped and flagged. */
function applyRepair(
  draft: SeedDraft,
  repair: CalibrationRepair,
  allowed: readonly RepairPromptVariable[],
): { draft: SeedDraft; applied: RepairChangeRecord[]; review: ReviewFlag[] } {
  const byId = new Map(allowed.map((v) => [v.id, v]));
  const values: Record<string, InputValue> = { ...draft.variableValues };
  const provenance = new Map<string, ValueProvenance>((draft.provenance ?? []).map((p) => [p.target, p]));
  const applied: RepairChangeRecord[] = [];
  const review: ReviewFlag[] = [];
  const drop = (target: string, why: string): void => {
    review.push({ kind: 'repair_dropped', step: CALIBRATION_STEP, target, message: `Calibration repair change to ${target} dropped: ${why}.` });
  };

  for (const change of repair.changes) {
    const v = byId.get(change.variable);
    if (!v) {
      drop(change.variable, 'not a variable the repair may change');
      continue;
    }
    const current = values[change.variable]!;
    if (change.scalar !== null) {
      if (typeof current !== 'number') {
        drop(change.variable, 'it is per member, the change gives a scalar');
        continue;
      }
      values[change.variable] = change.scalar;
      applied.push({ variable: change.variable, memberKey: '', from: current, to: change.scalar, reason: change.reason });
    } else {
      if (typeof current === 'number') {
        drop(change.variable, 'it is a scalar, the change gives per-member values');
        continue;
      }
      const next = { ...current };
      for (const e of change.perMember ?? []) {
        if (!(e.key in current)) {
          drop(`${change.variable}[${e.key}]`, 'no such member key in the draft');
          continue;
        }
        applied.push({ variable: change.variable, memberKey: e.key, from: current[e.key] ?? null, to: e.value, reason: change.reason });
        next[e.key] = e.value;
      }
      values[change.variable] = next;
    }
    provenance.set(change.variable, {
      target: change.variable,
      source: change.source ?? `calibration repair: ${change.reason}`,
      confidence: change.source === null ? 'L' : change.confidence,
      factIds: [...change.factIds],
    });
  }
  return { draft: { ...draft, variableValues: values, provenance: [...provenance.values()] }, applied, review };
}

// ---------------------------------------------------------------------------------------------------------------
// Step 5

export interface CalibrateInput {
  /** The seed draft of step 3 (validated in step 4). */
  draft: SeedDraft;
  bundle: ModelBundle;
  /** Reported figures of the last reported year (`targetsFromFacts`, or given by the caller). */
  targets: readonly CalibrationTarget[];
  /** The checked fact base, shown to the model in the repair round. */
  facts?: FactBase | null;
  /** The job's prompt-bar text, quoted as user input in the repair prompt. */
  promptBar?: string;
}

export interface CalibrateOptions {
  compile?: CompileDraft;
  config?: CalibrationConfig;
}

export interface CalibrationResult {
  /** The draft after the repair round (the input draft when there was none). */
  draft: SeedDraft;
  report: CalibrationReport;
  /** Step 4 on the repaired draft; null when nothing was repaired. */
  validation: ValidationReport | null;
  /** The repair's open questions. */
  openQuestions: string[];
}

/**
 * Step 5 (06 §2): the engine rebuilds the last reported fiscal year from the draft's tenant defaults; revenue, fuel,
 * SWB, opex, EBIT, interest, net income, OCF, FCF, cash and net debt (data: `calibration.json` `metrics`) must tie to
 * the reported figures within the tolerance (1%). On a miss, one repair round: the model gets the residuals and the
 * repairable inputs, its changes are applied to a copy of the draft, which is validated again and rebuilt. The
 * invariants of 06 §4 are checked on the final draft. The ModelClient is the only dependency; it is not called when
 * everything ties or no miss is repairable.
 */
export async function calibrate(
  client: ModelClient,
  input: CalibrateInput,
  opts: CalibrateOptions = {},
): Promise<StepResult<CalibrationResult>> {
  const config = opts.config ?? CALIBRATION;
  const compile = opts.compile ?? defaultCompile;
  const { bundle, targets } = input;
  const yearMember = lastReportedYear(input.draft.dimensionMembers, config);
  const year = yearMember.id;

  let model: CompiledModel | null = null;
  let compileError: string | null = null;
  try {
    model = compile(bundle, input.draft.dimensionMembers);
  } catch (e) {
    compileError = `The draft does not compile: ${errorMessage(e)}`;
  }

  let draft = input.draft;
  const rounds = [rebuild(model, draft, bundle, year, targets, 0, config, compileError)];
  const calls: StepCall[] = [];
  const review: ReviewFlag[] = [];
  let repair: RepairChangeRecord[] = [];
  let validation: ValidationReport | null = null;
  let openQuestions: string[] = [];

  for (let r = 1; r <= config.repairRounds && model !== null; r++) {
    const last = rounds.at(-1)!;
    if (last.tied || !last.metrics.some((m) => m.status === 'miss')) break;
    const variables = repairVariables(draft, bundle, config);
    const run = await client.run(calibrationRepairStep, {
      promptBar: input.promptBar ?? '',
      calibration: { year, label: typeof yearMember.label === 'string' ? yearMember.label : year, tolerance: config.tolerance },
      residuals: last.metrics,
      variables,
      facts: input.facts ?? null,
    });
    calls.push(stepCall(calibrationRepairStep.id, run));
    openQuestions = [...openQuestions, ...run.output.openQuestions];
    const repaired = applyRepair(draft, run.output, variables);
    review.push(...repaired.review);
    repair = [...repair, ...repaired.applied];
    draft = repaired.draft;
    validation = validateDraft(draft, bundle, { compile: () => model!, config });
    rounds.push(rebuild(model, draft, bundle, year, targets, r, config, null));
  }

  const invariants = model ? checkInvariants(draft, bundle, { model, config }) : [];
  const final = rounds.at(-1)!;
  for (const m of final.metrics.filter((x) => x.status !== 'tied')) {
    review.push({
      kind: 'calibration_miss',
      step: CALIBRATION_STEP,
      target: m.cell,
      message:
        m.status === 'missing'
          ? `No reported ${m.metric} for ${year}: calibration cannot check ${m.cell}.`
          : `${m.cell} is ${m.model ?? 'not computed'} against ${m.reported} reported (${m.relative === null ? 'n/a' : `${(m.relative * 100).toFixed(2)}%`}); tolerance ${config.tolerance * 100}%.`,
    });
  }
  for (const inv of invariants.filter((i) => !i.holds)) {
    review.push({
      kind: 'invariant_broken',
      step: null,
      target: inv.id,
      message: `Invariant ${inv.id} fails on ${inv.scope ?? 'the tenant defaults'}: ${inv.failing.map((f) => f.cell).join(', ')}.`,
    });
  }

  const report: CalibrationReport = {
    year,
    tolerance: config.tolerance,
    tied: final.tied && invariants.length > 0 && invariants.every((i) => i.holds),
    rounds,
    repair,
    invariants,
  };
  return { output: { draft, report, validation, openQuestions }, review, calls };
}
