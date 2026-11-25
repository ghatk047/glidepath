import { AppModule } from '@glidepath/api-contract';
import { themeNames, type ThemeName } from '@glidepath/ui/tokens';

/**
 * QA-07 helpers (pure, unit-tested): what G12 counts as a failure, the Lighthouse threshold and the
 * way a violation is worded in a failing assertion. The browser work is in `a11y/a11y.spec.ts`.
 */

/** The eight modules (contract ids) and the two themes (token ids): G12 runs every pair. */
export const A11Y_MODULES: readonly AppModule[] = AppModule.options;
export const A11Y_THEMES: readonly ThemeName[] = themeNames;

/** G12 (08 §1): "axe-core on each module, zero serious violations". Critical is worse than serious. */
export const BLOCKING_IMPACTS: ReadonlySet<string> = new Set(['serious', 'critical']);

/** QA-07 acceptance: Lighthouse accessibility score, in Lighthouse's 0..100 scale, at least 95. */
export const LIGHTHOUSE_A11Y_MIN = 95;
/** The screens the Lighthouse score is asserted on (07 §5 names them as the preloaded three). */
export const LIGHTHOUSE_MODULES = [
  'cockpit',
  'levers',
  'path',
] as const satisfies readonly AppModule[];

export interface ViolationLike {
  id: string;
  impact?: string | null;
  help: string;
  nodes: readonly { target: unknown; failureSummary?: string }[];
}

export const isBlocking = (v: Pick<ViolationLike, 'impact'>): boolean =>
  v.impact != null && BLOCKING_IMPACTS.has(v.impact);

export const blocking = <V extends Pick<ViolationLike, 'impact'>>(violations: readonly V[]): V[] =>
  violations.filter(isBlocking);

/** One readable line per violation: rule, impact, help text and the first few targets. */
export function describeViolation(v: ViolationLike, maxTargets = 3): string {
  const targets = v.nodes
    .slice(0, maxTargets)
    .map((n) => (Array.isArray(n.target) ? n.target.join(' ') : String(n.target)));
  const more = v.nodes.length > maxTargets ? ` (+${v.nodes.length - maxTargets} more)` : '';
  // axe's own account of the first node (colours and ratio for contrast, the missing name, ...)
  const why = v.nodes[0]?.failureSummary?.replace(/\s+/g, ' ').trim();
  return `${v.id} [${v.impact ?? 'none'}]: ${v.help} at ${targets.join(' | ')}${more}${why ? ` -- ${why}` : ''}`;
}

/** A Lighthouse category score (0..1, or null when it could not be computed) as a 0..100 integer. */
export const lighthousePercent = (score: number | null | undefined): number =>
  score == null ? Number.NaN : Math.round(score * 100);

export const meetsLighthouseMin = (score: number | null | undefined): boolean =>
  lighthousePercent(score) >= LIGHTHOUSE_A11Y_MIN;

export interface LighthouseResultLike {
  categories: Record<
    string,
    { score: number | null; auditRefs: readonly { id: string; weight: number }[] }
  >;
  audits: Record<
    string,
    {
      title: string;
      score: number | null;
      scoreDisplayMode: string;
      details?: { items?: readonly { node?: { selector?: string } }[] };
    }
  >;
}

/** Weighted accessibility audits that did not pass (with the first elements), so a low score names what to fix. */
export function failedA11yAudits(lhr: LighthouseResultLike): string[] {
  const refs = lhr.categories.accessibility?.auditRefs ?? [];
  const failed: string[] = [];
  for (const ref of refs) {
    const audit = lhr.audits[ref.id];
    if (ref.weight <= 0 || !audit) continue;
    if (audit.scoreDisplayMode === 'notApplicable' || audit.scoreDisplayMode === 'manual') continue;
    if (audit.score === null || audit.score >= 1) continue;
    const at = (audit.details?.items ?? [])
      .map((i) => i.node?.selector)
      .filter((x): x is string => !!x)
      .slice(0, 4);
    failed.push(`${ref.id}: ${audit.title}${at.length ? ` at ${at.join(' | ')}` : ''}`);
  }
  return failed;
}
