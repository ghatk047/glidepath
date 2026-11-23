import {
  ChangesetHistoryResponse,
  InputsResponse,
  MembersResponse,
  OneLine,
  ScenariosResponse,
} from '@glidepath/api-contract';
import type { ChangesetPage, ChangesetRecord, MembersSnapshot, ResolvedInputsRecord, ScenarioRecord } from '@glidepath/data-access';
import { CHANGE_ROW_TARGET_KIND } from '@glidepath/domain';
import type { ZodType } from 'zod';

/** An answer this server built does not match the contract: a bug here, never a client error (500, not 422). */
export class ContractViolation extends Error {
  constructor(what: string, detail: string) {
    super(`${what} does not match the contract: ${detail}`);
    this.name = 'ContractViolation';
  }
}

/** Validates (and strips) a response body against its contract schema. */
export function checked<T>(what: string, schema: ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (r.success) return r.data;
  const first = r.error.issues[0];
  throw new ContractViolation(what, `${first?.path.join('.') ?? '?'}: ${first?.message ?? 'invalid'}`);
}

// ----------------------------------------------------------------------------- members

/** `GET members`: every member of the pinned model's dimensions, active or not, in member order. */
export function toMembersResponse(snapshot: MembersSnapshot): MembersResponse {
  const dimensions: Record<string, object[]> = {};
  for (const r of snapshot.rows) {
    (dimensions[r.dim_key] ??= []).push({ key: r.member_key, label: r.label, attrs: { ...r.attrs }, sort: r.sort, active: r.active });
  }
  return checked('members', MembersResponse, { membersHash: snapshot.membersHash, dimensions });
}

// ----------------------------------------------------------------------------- scenarios

/**
 * Short names of the spec's presets for the scenario bar (docs/spec 01_data_model: Rates only, A, B, C, D),
 * by preset key. A preset the map does not know, and every user / blend / solver scenario, uses its label
 * without a leading `X. ` key prefix.
 */
const PRESET_SHORT_LABEL: Readonly<Record<string, string>> = {
  rates: 'Rates only',
  A: 'Commercial',
  B: 'Op-model reset',
  C: 'Balanced',
  D: 'Full stretch',
};

/** The chip name of a scenario (tier 2 owns it; the SPA only displays it). */
export function shortLabelOf(s: Pick<ScenarioRecord, 'key' | 'label' | 'kind'>): string {
  if (s.kind === 'preset') {
    const known = PRESET_SHORT_LABEL[s.key];
    if (known) return known;
    const prefix = `${s.key}.`;
    if (s.label.startsWith(prefix)) return s.label.slice(prefix.length).trim() || s.label;
  }
  return s.label;
}

/**
 * A scenario in contract shape (validated with the whole response by {@link toScenariosResponse}).
 * `editsCount` is the domain's stored counter (`loadEditsCounts`), never recounted from change rows.
 */
export function toScenario(s: ScenarioRecord, editsCount: number): object {
  return {
    id: s.id,
    key: s.key,
    label: s.label,
    shortLabel: shortLabelOf(s),
    kind: s.kind,
    parentId: s.parent_id,
    modelVersionId: s.model_version_id,
    version: s.version,
    editsCount,
    locked: s.locked,
    archived: s.archived,
    createdBy: s.created_by,
    createdAt: s.created_at,
  };
}

export function toScenariosResponse(scenarios: readonly object[]): ScenariosResponse {
  return checked('scenarios', ScenariosResponse, { scenarios });
}

// ----------------------------------------------------------------------------- inputs

export function toInputsResponse(scenario: ScenarioRecord, inputs: ResolvedInputsRecord): InputsResponse {
  const values = inputs.values.map((v) => ({
    var: v.var_key,
    member: v.member_key,
    value: v.value,
    from: v.resolved_from,
    fromScenarioId: v.scenario_id,
    confidence: v.confidence,
    note: v.note,
  }));
  return checked('inputs', InputsResponse, {
    scenarioId: scenario.id,
    version: scenario.version,
    inputs: values,
    overrides: inputs.overrides.map((o) => ({ node: o.node_key, member: o.member_key, value: o.value, reason: o.reason })),
  });
}

// ----------------------------------------------------------------------------- history

/** `change.target` is the table written; the API says variable, override or structural (domain's mapping). */
function toChangeRecord(c: ChangesetRecord['changes'][number]): object {
  return {
    seq: c.seq,
    target: CHANGE_ROW_TARGET_KIND[c.target],
    key: c.key,
    member: c.member_key,
    op: c.op,
    oldValue: c.old_value,
    newValue: c.new_value,
  };
}

/** `summary` is stored as JSON (counts); only a one-line text is shown as such. */
function summaryText(summary: unknown): string | null {
  if (typeof summary !== 'string') return null;
  const r = OneLine.safeParse(summary);
  return r.success ? r.data : null;
}

export function toChangesetSummary(cs: ChangesetRecord): object {
  return {
    id: cs.id,
    scenarioId: cs.scenario_id,
    origin: cs.origin,
    status: cs.status,
    baseVersion: cs.base_scenario_version,
    editsCount: cs.changes.length,
    createdBy: cs.created_by,
    createdByName: cs.created_by_name,
    createdAt: cs.created_at,
    revertsId: cs.reverts_id,
    summary: summaryText(cs.summary),
    changes: cs.changes.map(toChangeRecord),
  };
}

export function toHistoryResponse(scenarioId: string, page: ChangesetPage): ChangesetHistoryResponse {
  return checked('changesets', ChangesetHistoryResponse, {
    scenarioId,
    changesets: page.changesets.map(toChangesetSummary),
    nextCursor: page.nextCursor,
  });
}
