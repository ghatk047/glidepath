import { SearchResponse } from '@glidepath/api-contract';
import type { AppModule, BundleResponse, SearchKind } from '@glidepath/api-contract';
import type { MembersSnapshot } from '@glidepath/data-access';

/** Results a ⌘K query returns at most (component inventory #4: "Up to 9 results"). */
export const MAX_RESULTS = 9;

/** One searchable thing. `label` and `id` weigh most; `extra` (group, family, question) a little. */
export interface IndexEntry {
  kind: SearchKind;
  id: string;
  label: string;
  unit: string | null;
  group: string | null;
  module: AppModule | null;
  hint: string | null;
  extra: string;
}

/** The eight screens of the IA (02 §1, §4); `hint` is the question each module answers. */
const SCREENS: readonly { id: AppModule; label: string; hint: string }[] = [
  { id: 'cockpit', label: 'Cockpit', hint: 'Can we reach the bar?' },
  { id: 'baseline', label: 'Baseline', hint: 'Where is the money, and what can move?' },
  { id: 'levers', label: 'Levers', hint: 'What does each lever give, and when?' },
  { id: 'vps', label: 'VPs', hint: 'Is each VP on the hook fairly?' },
  { id: 'path', label: 'Path', hint: 'What is the least risky way there?' },
  { id: 'market', label: 'Market', hint: 'What is it worth to shareholders?' },
  { id: 'excel', label: 'Excel', hint: 'Can my team work offline?' },
  { id: 'airlines', label: 'Airlines', hint: 'Can this run for another airline?' },
];

/** Module that shows a variable or node of a spec layer (02 §4); null when the layer has no home screen. */
const LAYER_MODULE: Readonly<Record<string, AppModule>> = {
  target: 'cockpit',
  results: 'cockpit',
  baseline: 'baseline',
  levers: 'levers',
  vp: 'vps',
  simulation: 'path',
  corporate: 'market',
  pnl: 'market',
  it_bridge: 'market',
  valuation: 'market',
  bridge: 'market',
};
const moduleOf = (layer: string): AppModule | null => LAYER_MODULE[layer] ?? null;

/** Node whose unit is the unit of a baseline line's amount. */
const LINE_AMOUNT_NODE = 'base.pool_outlay';

const oneLine = (s: string): string | null => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t === '' ? null : t;
};
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/**
 * The ⌘K index: every input and output node of the model bundle (labels, units, groups from the
 * bundle), the levers and baseline lines among the tenant's dimension members (tier 3, the caller's
 * tenant only) and the eight screens. Nodes that are not outputs (intermediate formulas) are not offered.
 */
export function buildIndex(bundle: BundleResponse, members: MembersSnapshot): IndexEntry[] {
  const out: IndexEntry[] = [];
  for (const v of bundle.variables) {
    out.push({
      kind: 'input',
      id: v.id,
      label: v.label || v.id,
      unit: v.unit,
      group: v.group || null,
      module: moduleOf(v.layer),
      hint: oneLine(v.group),
      extra: v.group,
    });
  }
  for (const n of bundle.nodes) {
    if (!n.output) continue;
    out.push({
      kind: 'node',
      id: n.id,
      label: n.label || n.id,
      unit: n.unit,
      group: n.layer,
      module: moduleOf(n.layer),
      hint: null,
      extra: n.layer,
    });
  }
  const lineUnit = bundle.nodes.find((n) => n.id === LINE_AMOUNT_NODE)?.unit ?? null;
  for (const r of members.rows) {
    if (!r.active) continue;
    if (r.dim_key === 'lever') {
      const category = str(r.attrs.category);
      out.push({
        kind: 'lever',
        id: r.member_key,
        label: r.label,
        unit: null,
        group: oneLine(category),
        module: 'levers',
        hint: oneLine(category),
        extra: category,
      });
    } else if (r.dim_key === 'line') {
      const pool = str(r.attrs.pool);
      const domain = str(r.attrs.domain);
      const vendor = str(r.attrs.vendor);
      out.push({
        kind: 'line',
        id: r.member_key,
        label: r.label,
        unit: lineUnit,
        group: oneLine(pool),
        module: 'baseline',
        hint: oneLine([pool, domain].filter(Boolean).join(' · ')),
        extra: `${pool} ${domain} ${vendor}`,
      });
    }
  }
  for (const s of SCREENS) {
    out.push({ kind: 'screen', id: s.id, label: s.label, unit: null, group: null, module: s.id, hint: s.hint, extra: s.hint });
  }
  return out;
}

const tokensOf = (s: string): string[] => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/** Tie order among equal scores: the thing you most likely mean first. */
const KIND_RANK: Record<SearchKind, number> = { lever: 0, input: 1, node: 2, line: 3, screen: 4 };

interface Prepared {
  entry: IndexEntry;
  labelWords: string[];
  labelLower: string;
  idLower: string;
  idParts: string[];
  extraLower: string;
}

/**
 * Score of one query token against an entry, or 0 for no match: a whole label word or id part beats a
 * label prefix, which beats a substring of the label or id, which beats the group / hint text.
 */
function tokenScore(p: Prepared, t: string): number {
  if (p.labelWords.includes(t)) return p.labelWords[0] === t ? 130 : 120;
  if (p.idParts.includes(t)) return 110;
  if (p.labelWords.some((w) => w.startsWith(t))) return p.labelWords[0]!.startsWith(t) ? 100 : 90;
  if (p.idParts.some((w) => w.startsWith(t))) return 80;
  if (p.labelLower.includes(t)) return 60;
  if (p.idLower.includes(t)) return 50;
  if (p.extraLower.includes(t)) return 20;
  return 0;
}

/**
 * Ranked search over the index: every query token must match (label, id, group or hint). Entries sort by
 * score, then kind (lever, input, node, line, screen), then label and id. At most `limit` (never more than
 * {@link MAX_RESULTS}) results.
 */
export function search(index: readonly IndexEntry[], q: string, limit: number = MAX_RESULTS): SearchResponse {
  const tokens = tokensOf(q);
  const cap = Math.max(1, Math.min(limit, MAX_RESULTS));
  const qLower = q.trim().toLowerCase();
  const scored: { entry: IndexEntry; score: number }[] = [];
  if (tokens.length > 0) {
    for (const entry of index) {
      const label = entry.label.toLowerCase();
      const p: Prepared = {
        entry,
        labelWords: tokensOf(entry.label),
        labelLower: label,
        idLower: entry.id.toLowerCase(),
        idParts: tokensOf(entry.id),
        extraLower: entry.extra.toLowerCase(),
      };
      let score = 0;
      let all = true;
      for (const t of tokens) {
        const s = tokenScore(p, t);
        if (s === 0) {
          all = false;
          break;
        }
        score += s;
      }
      if (!all) continue;
      if (p.idLower === qLower || label === qLower) score += 200;
      scored.push({ entry, score });
    }
  }
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      KIND_RANK[a.entry.kind] - KIND_RANK[b.entry.kind] ||
      (a.entry.label < b.entry.label ? -1 : a.entry.label > b.entry.label ? 1 : 0) ||
      (a.entry.id < b.entry.id ? -1 : a.entry.id > b.entry.id ? 1 : 0),
  );
  return SearchResponse.parse({
    q,
    results: scored.slice(0, cap).map(({ entry: e }) => ({
      kind: e.kind,
      id: e.id,
      label: e.label,
      unit: e.unit,
      group: e.group,
      module: e.module,
      hint: e.hint,
    })),
  });
}
