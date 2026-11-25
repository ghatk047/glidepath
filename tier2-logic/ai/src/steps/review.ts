import { LINE_ITEM_DIM, nodeMemberKeys } from '@glidepath/domain';
import type { CompiledModel } from '@glidepath/engine';
import type { InputValue, Member, ModelBundle, TenantSeed } from '@glidepath/spec';
import { checklistStepForDim, checklistStepForVariable, ONBOARDING_CHECKLIST } from '../onboarding/checklist';
import { REVIEW_CONFIG, type ReviewConfig } from '../pipeline/catalog';
import type { ReviewFlag } from '../review';
import type { CalibrationReport, DraftValidationEntry, ValidationReport } from '../schemas/calibration';
import type { FactBase } from '../schemas/facts';
import type { LeverTuningDraft } from '../schemas/lever-tuning';
import type { ReconfigPlan } from '../schemas/plan';
import {
  type ChangesetPart,
  type DraftReview,
  type DraftStructuralChange,
  type DraftValueChange,
  type ImpactPreview,
  type ReconfigChangeset,
  ReconfigReview,
  type ReviewQuestion,
  type ReviewSource,
  type TenantPlan,
} from '../schemas/review';
import { type CompileDraft, defaultCompile, draftStates, errorMessage, evaluateState } from './draft-model';
import type { StepCall } from './result';
import { PRESET_SOURCE } from './seed-draft';
import { type SeedDraft, validateDraft } from './validate';

/**
 * Step 7 (06 §2): the two drafts as changesets, their impact preview, and the review payload tier 1 shows. Pure: the
 * engine evaluates in memory; nothing is written (the only write is `applyDraft`, after the user accepts).
 */

type JsonRow = Record<string, unknown>;
const json = (v: unknown): unknown => (v === undefined ? null : v);

// ---------------------------------------------------------------------------------------------------------------
// Rows: the seed loader's mapping (worker `seed/drafts.ts`), so an AI tenant is stored as a seeded one is.

/** A member of a tenant dimension other than `line` as a dimension_member row. */
export function dimensionMemberRow(m: Member, sort: number): JsonRow {
  const attrs: Record<string, unknown> = { ...m };
  delete attrs.id;
  delete attrs.label;
  return { label: json(m.label), attrs, sort, active: true };
}

/** A seed line as a line_item row. `source_id` stays null: the line's sources are the job's, kept in the review. */
export function lineItemRow(m: Member): JsonRow {
  return {
    legacy_id: json(m.legacy_id),
    pool_id: json(m.pool),
    tenant_l1_label: json(m.l1_label),
    l2: json(m.l2),
    name: json(m.name),
    vendor_key: null,
    vendor_text: json(m.vendor),
    nature: json(m.nature),
    accounting: json(m.accounting),
    driver_text: json(m.driver_text),
    qty: json(m.qty),
    unit: json(m.unit),
    addr_tag: json(m.addr),
    domain_key: json(m.domain),
    scale_driver: json(m.drv),
    in_scope: m.in_scope === 1,
    memo: m.memo === 1,
    confidence: json(m.confidence),
    source_id: null,
    lever_hook_text: json(m.lever_hook),
    notes: typeof m.notes === 'string' ? m.notes : '',
    active: true,
  };
}

/** Dimensions whose members are tenant rows (scope `tenant` or `global+tenant`). */
export const tenantDimensions = (bundle: Pick<ModelBundle, 'dimensions'>): string[] =>
  bundle.dimensions.filter((d) => d.scope.split('+').includes('tenant')).map((d) => d.id);

/** Dimensions step 3 copies from the global presets rather than drafting (checklist steps with `seed.from = presets`). */
const presetDims = (): Set<string> =>
  new Set(ONBOARDING_CHECKLIST.steps.filter((s) => s.seed.from === 'presets').flatMap((s) => s.seed.dims));

const valueChanges = (values: Readonly<Record<string, InputValue>>, note: (variable: string) => string | undefined): DraftValueChange[] =>
  Object.entries(values).flatMap(([key, v]) => {
    const cells = typeof v === 'number' ? [['', v] as const] : Object.entries(v);
    const n = note(key);
    return cells.map(([member_key, value]) => ({
      target: 'variable' as const,
      key,
      member_key,
      op: 'set' as const,
      new_value: value,
      ...(n === undefined ? {} : { note: n }),
    }));
  });

// ---------------------------------------------------------------------------------------------------------------
// The two changesets

/**
 * The seed draft as changesets (06 §2 step 8 "creates the tenant and seed"), in apply order:
 * 1. tenant defaults, origin `ai_reconfig`: every drafted tenant member and line, and every drafted value, each value
 *    noted with its source;
 * 2. tenant defaults, origin `seed`: the members and values step 3 copied from the global presets (the lever library);
 * 3. one per preset scenario, origin `seed`: its values and pins, copied from the global presets.
 * Parts with no change are left out.
 */
export function seedChangeset(seed: SeedDraft, bundle: Pick<ModelBundle, 'dimensions'>): ReconfigChangeset {
  const copiedDims = presetDims();
  const provenance = new Map((seed.provenance ?? []).map((p) => [p.target, p]));
  const copied = (variable: string): boolean => provenance.get(variable)?.source === PRESET_SOURCE;

  const members = (fromPresets: boolean): DraftStructuralChange[] =>
    tenantDimensions(bundle)
      .filter((dim) => copiedDims.has(dim) === fromPresets)
      .flatMap((dim) =>
        (seed.dimensionMembers[dim] ?? []).map((m, i) => ({
          target: 'structural' as const,
          key: dim,
          member_key: m.id,
          op: 'insert' as const,
          new_value: dim === LINE_ITEM_DIM ? lineItemRow(m) : dimensionMemberRow(m, i + 1),
        })),
      );
  const values = (fromPresets: boolean): Record<string, InputValue> =>
    Object.fromEntries(Object.entries(seed.variableValues).filter(([id]) => copied(id) === fromPresets));
  const sourceNote = (variable: string): string | undefined => provenance.get(variable)?.source ?? undefined;

  const parts: ChangesetPart[] = [
    { scope: null, origin: 'ai_reconfig', changes: [...members(false), ...valueChanges(values(false), sourceNote)] },
    { scope: null, origin: 'seed', changes: [...members(true), ...valueChanges(values(true), () => PRESET_SOURCE)] },
    ...seed.scenarios.scenarios.map(
      (s): ChangesetPart => ({
        scope: s.id,
        origin: 'seed',
        changes: [
          ...valueChanges(s.values, () => undefined),
          ...Object.entries(s.overrides ?? {}).map(([cell, value]): DraftValueChange => {
            const m = /^(.+?)\[(.*)\]$/.exec(cell);
            return { target: 'override', key: m ? m[1]! : cell, member_key: m ? m[2]! : '', op: 'set', new_value: value, note: PRESET_SOURCE };
          }),
        ],
      }),
    ),
  ];
  return { kind: 'seed', parts: parts.filter((p) => p.changes.length > 0) };
}

/** What the seed creates besides changesets: the tenant record, the preset scenarios and the line-lever links. */
export function tenantPlan(seed: TenantSeed): TenantPlan {
  return {
    record: { ...seed.tenant },
    presets: seed.scenarios.scenarios.map((s) => ({ key: s.id, label: s.label })),
    defaultScenario: seed.scenarios.default_scenario,
    leverMappings: (seed.dimensionMembers[LINE_ITEM_DIM] ?? []).flatMap((m) =>
      (Array.isArray(m.lever_ids) ? m.lever_ids : []).map((c) => ({ line_key: m.id, lever_code: String(c) })),
    ),
  };
}

/**
 * The lever tuning as its own changesets (06 §2 step 6: a **separate** changeset with reasons): one per scope, the
 * tenant defaults first, then scenarios in the order the tuning names them; origin `ai_reconfig`; each change keeps
 * the reason as its note.
 */
export function leverTuningChangeset(tuning: LeverTuningDraft): ReconfigChangeset {
  const byScope = new Map<string | null, DraftValueChange[]>([[null, []]]);
  for (const c of tuning.changes) {
    const list = byScope.get(c.scenario) ?? [];
    list.push({ target: 'variable', key: c.variable, member_key: c.memberKey ?? '', op: 'set', new_value: c.value, note: c.reason });
    byScope.set(c.scenario, list);
  }
  return {
    kind: 'lever_tuning',
    parts: [...byScope].filter(([, changes]) => changes.length > 0).map(([scope, changes]) => ({ scope, origin: 'ai_reconfig', changes })),
  };
}

/** The seed with a draft's value changes put on it in memory (structural changes are not replayed). */
export function withChanges(seed: SeedDraft, changeset: ReconfigChangeset): SeedDraft {
  const set = (values: Record<string, InputValue>, c: DraftValueChange): void => {
    if (c.new_value === null) return;
    const cur = values[c.key];
    values[c.key] = c.member_key === '' ? c.new_value : { ...(typeof cur === 'object' ? cur : {}), [c.member_key]: c.new_value };
  };
  const defaults: Record<string, InputValue> = { ...seed.variableValues };
  const scenarios = seed.scenarios.scenarios.map((s) => ({ ...s, values: { ...s.values }, overrides: { ...(s.overrides ?? {}) } }));
  for (const part of changeset.parts) {
    const scenario = part.scope === null ? null : scenarios.find((s) => s.id === part.scope);
    for (const c of part.changes) {
      if (c.target === 'structural') continue;
      if (c.target === 'variable') set(scenario ? scenario.values : defaults, c);
      else if (scenario && c.new_value !== null) scenario.overrides[c.member_key === '' ? c.key : `${c.key}[${c.member_key}]`] = c.new_value;
    }
  }
  return { ...seed, variableValues: defaults, scenarios: { ...seed.scenarios, scenarios } };
}

// ---------------------------------------------------------------------------------------------------------------
// Impact preview

/**
 * Before → after of every cell of the impact nodes (`pipeline.json`), per state: the tenant defaults (scope null) and
 * each scenario. `before` null previews a new tenant (nothing to compare with).
 */
export function previewImpact(
  before: SeedDraft | null,
  after: SeedDraft,
  bundle: ModelBundle,
  opts: { compile?: CompileDraft; config?: ReviewConfig; model?: CompiledModel } = {},
): ImpactPreview[] {
  const config = opts.config ?? REVIEW_CONFIG;
  let model: CompiledModel;
  try {
    model = opts.model ?? (opts.compile ?? defaultCompile)(bundle, after.dimensionMembers);
  } catch (e) {
    return [{ scope: null, rows: [], error: `The draft does not compile: ${errorMessage(e)}` }];
  }
  const nodes = new Map(bundle.nodes.map((n) => [n.id, n]));
  const cells = config.impact.nodes.flatMap((id) => {
    const node = nodes.get(id);
    return node ? nodeMemberKeys(node, after.dimensionMembers).map((k) => (k === '' ? id : `${id}[${k}]`)) : [];
  });
  /** An evaluation, or why the state does not evaluate. */
  type Outcome = { get(c: string): number; has(c: string): boolean } | string;
  const evaluateAll = (seed: SeedDraft): Map<string | null, Outcome> =>
    new Map(
      draftStates(seed, bundle).map((s): [string | null, Outcome] => {
        try {
          return [s.scope, evaluateState(model, s)];
        } catch (e) {
          return [s.scope, `The state does not evaluate: ${errorMessage(e)}`];
        }
      }),
    );
  const prev = before ? evaluateAll(before) : null;
  const next = evaluateAll(after);
  const value = (ev: Outcome | undefined, cell: string): number | null => {
    if (ev === undefined || typeof ev === 'string' || !ev.has(cell)) return null;
    const v = ev.get(cell);
    return Number.isFinite(v) ? v : null;
  };
  return [...next].map(([scope, ev]) => {
    const b = prev?.get(scope);
    const error = typeof ev === 'string' ? ev : typeof b === 'string' ? b : null;
    return { scope, rows: cells.map((cell) => ({ cell, before: value(b, cell), after: value(ev, cell) })), error };
  });
}

// ---------------------------------------------------------------------------------------------------------------
// The review payload

const OTHER_SECTION = 'other';

/** Changes per checklist step (members by dimension, values by registry variable, pins with the scenarios). */
function sections(changeset: ReconfigChangeset, bundle: ModelBundle): { section: string; changes: number }[] {
  const variables = new Map(bundle.variables.map((v) => [v.id, v]));
  const scenarioStep = ONBOARDING_CHECKLIST.steps.find((s) => s.seed.files.includes('scenarios.json'))?.id;
  const counts = new Map<string, number>();
  for (const part of changeset.parts)
    for (const c of part.changes) {
      const section =
        c.target === 'structural'
          ? checklistStepForDim(c.key)?.id
          : c.target === 'override'
            ? scenarioStep
            : (() => {
                const v = variables.get(c.key);
                return v ? checklistStepForVariable(v)?.id : undefined;
              })();
      const key = section ?? OTHER_SECTION;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  const order = ONBOARDING_CHECKLIST.steps.map((s) => s.id as string);
  return [...counts]
    .map(([section, changes]) => ({ section, changes }))
    .sort((a, b) => (order.indexOf(a.section) + 1 || order.length + 1) - (order.indexOf(b.section) + 1 || order.length + 1));
}

const changeCount = (cs: ReconfigChangeset): number => cs.parts.reduce((n, p) => n + p.changes.length, 0);

/** Cells a draft's value changes write, as step 4 names them (`var[member_key]`). */
const draftCells = (cs: ReconfigChangeset): Set<string> =>
  new Set(cs.parts.flatMap((p) => p.changes.filter((c): c is DraftValueChange => c.target !== 'structural').map((c) => `${c.key}[${c.member_key}]`)));

export interface ReviewPayloadInput {
  plan: ReconfigPlan;
  /** The checked fact base of step 2 (null for a job without research). */
  facts: FactBase | null;
  /** Every model call of the job (steps 1-6): their sources and usage. */
  calls: readonly StepCall[];
  /** Review flags of steps 1-6. */
  flags: readonly ReviewFlag[];
  bundle: ModelBundle;
  /**
   * The state the drafts go on. Onboarding: the calibrated seed draft, which is also the seed changeset. Tuning an
   * existing tenant: its current inputs (no seed changeset is drafted).
   */
  seed: SeedDraft;
  /** Step 4 on `seed` (onboarding). */
  validation: ValidationReport | null;
  /** Step 5 (onboarding): the report and the repair's open questions. */
  calibration: { report: CalibrationReport; openQuestions: readonly string[] } | null;
  /** Step 6, checked (`tuneLevers`); null when the job does not tune. */
  tuning: LeverTuningDraft | null;
}

export interface ReviewPayloadOptions {
  compile?: CompileDraft;
  config?: ReviewConfig;
}

/** Every page the job's calls saw and every fact URL, deduplicated, in first-seen order. */
function reviewSources(calls: readonly StepCall[], facts: FactBase | null): ReviewSource[] {
  const byUrl = new Map<string, { title: string | null; seenBy: Set<string>; factIds: string[] }>();
  const touch = (url: string, title: string | null) => {
    let s = byUrl.get(url);
    if (!s) byUrl.set(url, (s = { title, seenBy: new Set(), factIds: [] }));
    s.title ??= title;
    return s;
  };
  for (const call of calls) for (const src of call.sources) touch(src.url, src.title).seenBy.add(call.step);
  for (const f of facts?.facts ?? []) {
    if (f.sourceUrl === null) continue;
    const s = touch(f.sourceUrl, f.sourceTitle);
    s.seenBy.add('facts');
    s.factIds.push(f.id);
  }
  return [...byUrl].map(([url, s]) => ({ url, title: s.title, seenBy: [...s.seenBy], factIds: s.factIds }));
}

function openQuestions(input: ReviewPayloadInput, config: ReviewConfig): ReviewQuestion[] {
  const q = (origin: ReviewQuestion['origin'], item: ReviewQuestion['item']) => (question: string, i: number): ReviewQuestion => ({
    id: `${origin}-${i + 1}`,
    question,
    origin,
    item,
    blocking: false,
  });
  return [
    ...input.plan.openQuestions.map(q('plan', null)),
    ...(input.facts?.gaps ?? []).map((g, i) => q('research', g.step)(g.question, i)),
    ...(input.calibration?.openQuestions ?? []).map(q('calibration', null)),
    ...(input.tuning?.openQuestions ?? []).map(q('lever_tuning', config.tuning.step)),
  ];
}

/**
 * Step 7 (06 §2): what tier 1 shows before anything is written: the plan, the sources, the open questions, validation
 * and calibration, and the two drafts (the seed when the plan produces one, the lever tuning when there is one), each
 * as changesets with change counts per checklist step, its validation entries and the impact preview (the seed against
 * nothing, the tuning against the seed). Pure; the result parses as `ReconfigReview`.
 */
export function reviewPayload(input: ReviewPayloadInput, opts: ReviewPayloadOptions = {}): ReconfigReview {
  const config = opts.config ?? REVIEW_CONFIG;
  const { bundle, seed } = input;
  const compile = opts.compile ?? defaultCompile;
  let model: CompiledModel | undefined;
  try {
    model = compile(bundle, seed.dimensionMembers);
  } catch {
    model = undefined; // previewImpact reports the compile error
  }
  const impactOpts = { compile, config, ...(model ? { model } : {}) };

  let seedDraft: DraftReview | null = null;
  if (input.plan.produce.includes('seed')) {
    const changeset = seedChangeset(seed, bundle);
    seedDraft = {
      kind: 'seed',
      title: config.drafts.seed.title,
      summary: config.drafts.seed.summary,
      changes: changeCount(changeset),
      sections: sections(changeset, bundle),
      warnings: [...(input.validation?.entries ?? [])],
      impact: previewImpact(null, seed, bundle, impactOpts),
      changeset,
      tuning: null,
    };
  }

  let tuningDraft: DraftReview | null = null;
  if (input.tuning) {
    const changeset = leverTuningChangeset(input.tuning);
    const tuned = withChanges(seed, changeset);
    const cells = draftCells(changeset);
    let warnings: DraftValidationEntry[] = [];
    if (model) {
      const report = validateDraft(tuned, bundle, { compile: () => model! });
      warnings = report.entries.filter((e) => e.cells.some((c) => cells.has(c)));
    }
    tuningDraft = {
      kind: 'lever_tuning',
      title: config.drafts.lever_tuning.title,
      summary: input.tuning.summary,
      changes: changeCount(changeset),
      sections: sections(changeset, bundle),
      warnings,
      impact: previewImpact(seed, tuned, bundle, impactOpts),
      changeset,
      tuning: input.tuning,
    };
  }

  const usage = input.calls.reduce(
    (u, c) => ({
      calls: u.calls + 1,
      inputTokens: u.inputTokens + c.usage.inputTokens,
      outputTokens: u.outputTokens + c.usage.outputTokens,
      cacheCreationInputTokens: u.cacheCreationInputTokens + c.usage.cacheCreationInputTokens,
      cacheReadInputTokens: u.cacheReadInputTokens + c.usage.cacheReadInputTokens,
    }),
    { calls: 0, inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
  );

  return ReconfigReview.parse({
    plan: input.plan,
    sources: reviewSources(input.calls, input.facts),
    facts: input.facts?.facts ?? [],
    openQuestions: openQuestions(input, config),
    flags: [...input.flags],
    validation: input.validation,
    calibration: input.calibration?.report ?? null,
    tenant: seedDraft ? tenantPlan(seed) : null,
    drafts: { seed: seedDraft, lever_tuning: tuningDraft },
    usage,
  } satisfies ReconfigReview);
}
