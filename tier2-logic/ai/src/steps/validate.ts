import {
  BOUNDS_POLICY,
  validateInputs,
  validateOutputs,
  type BoundsPolicy,
  type ValidationEntry,
} from '@glidepath/domain';
import type { InputValue, ModelBundle, TenantSeed } from '@glidepath/spec';
import { CALIBRATION, type CalibrationConfig } from '../calibration/catalog';
import { DraftCheck, type DraftValidationEntry, type ValidationReport } from '../schemas/calibration';
import type { ValueProvenance } from '../schemas/seed';
import { type CompileDraft, defaultCompile, draftStates, type DraftState, errorMessage, evaluateState } from './draft-model';
import { PRESET_SOURCE } from './seed-draft';

/** A seed draft as step 3 returns it (`TenantSeedDraft`), or a plain tenant seed (no provenance). */
export type SeedDraft = TenantSeed & { readonly provenance?: readonly ValueProvenance[] };

export interface ValidateDraftOptions {
  /** Defaults to the engine's `compile`. */
  readonly compile?: CompileDraft;
  readonly config?: CalibrationConfig;
}

/** A finding before entries of several states are merged. */
type Finding = Omit<DraftValidationEntry, 'scopes'> & { scope: string | null };

const CHECK_ORDER: readonly DraftCheck[] = ['members', ...DraftCheck.options.filter((c) => c !== 'members' && c !== 'engine'), 'engine'];

/** VR04 entries become errors or warnings by `BOUNDS_POLICY`: as `ai_reconfig` writes them, or as the seed does. */
const severityOf = (policy: BoundsPolicy): 'error' | 'warning' => (policy === 'reject' ? 'error' : 'warning');

/** Split an engine or contract cell key (`id`, `id[]`, `id[a,b]`) into id and member key. */
function splitCell(cell: string): { id: string; memberKey: string } {
  const open = cell.indexOf('[');
  if (open < 0 || !cell.endsWith(']')) return { id: cell, memberKey: '' };
  return { id: cell.slice(0, open), memberKey: cell.slice(open + 1, -1) };
}

// ---------------------------------------------------------------------------------------------------------------
// Member integrity

function memberIntegrity(draft: SeedDraft, bundle: ModelBundle, config: CalibrationConfig): Finding[] {
  const out: Finding[] = [];
  const add = (scope: string | null, cells: string[], message: string): void => {
    out.push({ check: 'members', severity: 'error', cells, message, scope });
  };
  const dims = new Map(bundle.dimensions.map((d) => [d.id, d]));
  const memberIds = new Map<string, Set<string>>(
    Object.entries(draft.dimensionMembers).map(([dim, ms]) => [dim, new Set(ms.map((m) => m.id))]),
  );

  for (const dim of Object.keys(draft.dimensionMembers)) {
    if (!dims.has(dim)) add(null, [dim], `Dimension '${dim}' is not in the model; remove it or use a model dimension.`);
  }
  for (const d of bundle.dimensions) {
    if ((memberIds.get(d.id)?.size ?? 0) === 0) add(null, [d.id], `Dimension '${d.id}' (${d.label}) has no members; the model needs at least one.`);
  }

  // Member keys: right number of members, each a member of its dimension.
  const keyProblem = (dimsOf: readonly string[], memberKey: string): string | null => {
    const ids = memberKey === '' ? [] : memberKey.split(',');
    if (ids.length !== dimsOf.length) return `needs ${dimsOf.length} member(s) (${dimsOf.join(', ') || 'scalar'}), got '${memberKey}'`;
    const bad = ids.flatMap((id, i) => (memberIds.get(dimsOf[i]!)?.has(id) ? [] : [`'${id}' is not a ${dimsOf[i]} member`]));
    return bad.length > 0 ? bad.join('; ') : null;
  };

  const variables = new Map(bundle.variables.map((v) => [v.id, v]));
  const checkValues = (scope: string | null, values: Readonly<Record<string, InputValue>>): void => {
    for (const [varId, value] of Object.entries(values)) {
      const def = variables.get(varId);
      if (!def) {
        add(scope, [`${varId}[]`], `Variable '${varId}' is not in the registry; remove it or use a registry id.`);
        continue;
      }
      if (typeof value === 'number') {
        if (def.dims.length > 0) add(scope, [`${varId}[]`], `${varId} is per ${def.dims.join(', ')}; give one value per member, not a scalar.`);
        continue;
      }
      if (def.dims.length === 0) {
        add(scope, [`${varId}[]`], `${varId} is a scalar; give one value, not per-member values.`);
        continue;
      }
      for (const key of Object.keys(value)) {
        const problem = keyProblem(def.dims, key);
        if (problem) add(scope, [`${varId}[${key}]`], `${varId}[${key}]: member key ${problem}.`);
      }
    }
  };
  checkValues(null, draft.variableValues);

  const nodes = new Map(bundle.nodes.map((n) => [n.id, n]));
  for (const s of draft.scenarios.scenarios) {
    checkValues(s.id, s.values);
    for (const cell of Object.keys(s.overrides ?? {})) {
      const { id, memberKey } = splitCell(cell);
      const node = nodes.get(id);
      if (!node) {
        add(s.id, [cell], `Pinned cell ${cell} names no model node.`);
        continue;
      }
      const problem = keyProblem(node.dims, memberKey);
      if (problem) add(s.id, [cell], `Pinned cell ${cell}: member key ${problem}.`);
    }
  }

  // Attributes that name members of another dimension (year.prev, line.addr, lever.alloc_key, ...).
  for (const ref of config.memberReferences) {
    const targets = memberIds.get(ref.references) ?? new Set<string>();
    for (const m of draft.dimensionMembers[ref.dim] ?? []) {
      const raw = m[ref.attribute];
      const ids = Array.isArray(raw) ? raw : typeof raw === 'string' && raw !== '' ? [raw] : [];
      for (const id of ids) {
        if (typeof id !== 'string' || !targets.has(id))
          add(null, [`${ref.dim}/${m.id}`], `${ref.dim} '${m.id}': ${ref.attribute} '${String(id)}' is not a ${ref.references} member.`);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Rules

/** Bounds severity of a VR04 cell: drafted values are rejected (`ai_reconfig`), copied presets warn (`seed`). */
function boundsSeverity(cell: string, state: DraftState, presetVars: ReadonlySet<string>): 'error' | 'warning' {
  const { id, memberKey } = splitCell(cell);
  const row = state.values.find((r) => r.var_key === id && r.member_key === memberKey);
  const fromScenario = row !== undefined && row.scenario_id !== null;
  const copied = fromScenario || presetVars.has(id);
  return severityOf(copied ? BOUNDS_POLICY.seed : BOUNDS_POLICY.ai_reconfig);
}

const asFinding = (e: ValidationEntry, scope: string | null): Finding => ({
  check: e.rule,
  severity: e.severity,
  cells: [...e.cells],
  message: e.message,
  scope,
});

/**
 * Step 4 (06 §2): validate a seed draft without the database. Runs member integrity (dimensions, member keys of every
 * value and pin, member references), then VR01-VR10 on the tenant defaults and on each scenario over them: the input
 * rules of the domain (VR04 is the registry bounds, an error for a drafted value as `BOUNDS_POLICY.ai_reconfig`
 * rejects it, a warning for a value copied from the global presets), and VR05 and VR08 on an engine evaluation of each
 * state. The engine runs only when the members are sound. Pure.
 */
export function validateDraft(draft: SeedDraft, bundle: ModelBundle, opts: ValidateDraftOptions = {}): ValidationReport {
  const config = opts.config ?? CALIBRATION;
  const compile = opts.compile ?? defaultCompile;
  const findings = memberIntegrity(draft, bundle, config);
  const members = draft.dimensionMembers;
  const states = draftStates(draft, bundle);
  const presetVars = new Set((draft.provenance ?? []).filter((p) => p.source === PRESET_SOURCE).map((p) => p.target));

  for (const state of states) {
    for (const e of validateInputs({ bundle, members, values: state.values })) {
      const f = asFinding(e, state.scope);
      if (e.rule === 'VR04') f.severity = e.cells.some((c) => boundsSeverity(c, state, presetVars) === 'error') ? 'error' : 'warning';
      findings.push(f);
    }
  }

  if (!findings.some((f) => f.check === 'members')) {
    let model: ReturnType<CompileDraft> | null = null;
    try {
      model = compile(bundle, members);
    } catch (e) {
      findings.push({ check: 'engine', severity: 'error', cells: [], message: `The draft does not compile: ${errorMessage(e)}`, scope: null });
    }
    for (const state of model ? states : []) {
      try {
        const evaluation = evaluateState(model!, state);
        for (const e of validateOutputs({ bundle, members, evaluation, upstream: (c) => model!.upstream(c) })) findings.push(asFinding(e, state.scope));
      } catch (e) {
        findings.push({ check: 'engine', severity: 'error', cells: [], message: `The draft does not evaluate: ${errorMessage(e)}`, scope: state.scope });
      }
    }
  }

  return { ok: !findings.some((f) => f.severity === 'error'), entries: mergeFindings(findings) };
}

/** Identical findings of several states become one entry listing their scopes; entries in check order. */
function mergeFindings(findings: readonly Finding[]): DraftValidationEntry[] {
  const byKey = new Map<string, DraftValidationEntry>();
  for (const { scope, ...f } of findings) {
    const key = JSON.stringify([f.check, f.severity, f.cells, f.message]);
    const entry = byKey.get(key);
    if (entry) {
      if (!entry.scopes.includes(scope)) entry.scopes.push(scope);
    } else byKey.set(key, { ...f, scopes: [scope] });
  }
  const rank = (c: DraftCheck): number => CHECK_ORDER.indexOf(c);
  return [...byKey.values()].map((e, i) => ({ e, i })).sort((a, b) => rank(a.e.check) - rank(b.e.check) || a.i - b.i).map((x) => x.e);
}
