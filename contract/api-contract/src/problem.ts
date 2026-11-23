import { z } from 'zod';
import { CellKey, OneLine } from './ids';

/** Media type of every error body. */
export const PROBLEM_CONTENT_TYPE = 'application/problem+json';

/** Problem `type` URIs used by tier 2 (relative references, RFC 9457 §3.1.1). */
export const problemTypes = {
  validation: '/problems/validation',
  versionConflict: '/problems/version-conflict',
  notFound: '/problems/not-found',
  unauthenticated: '/problems/unauthenticated',
  forbidden: '/problems/forbidden',
  badRequest: '/problems/bad-request',
  internal: '/problems/internal',
} as const;

/** Validation rule ids, verbatim from `docs/spec/schema.json` `validation_rules`. */
export const RuleId = z.enum([
  'VR01',
  'VR02',
  'VR03',
  'VR04',
  'VR05',
  'VR06',
  'VR07',
  'VR08',
  'VR09',
  'VR10',
]);
export type RuleId = z.infer<typeof RuleId>;

export const Severity = z.enum(['error', 'warning']);
export type Severity = z.infer<typeof Severity>;

/**
 * One rule result, in tier 2's words. Tier 1 shows `message`; it never evaluates the rule.
 * `cells` are the cells the rule points at (may be empty for model-wide checks such as VR08).
 */
export const Violation = z.object({
  rule: RuleId,
  cells: z.array(CellKey),
  severity: Severity,
  message: OneLine,
});
export type Violation = z.infer<typeof Violation>;

/**
 * RFC 9457 problem details. `detail` is required and is the one-line cause-and-fix message
 * shown in the panel's error chip (IA §6 "Error").
 */
export const Problem = z.object({
  type: z.string().min(1).default('about:blank'),
  title: OneLine,
  status: z.number().int().min(400).max(599),
  detail: OneLine,
  instance: z.string().min(1).optional(),
  violations: z.array(Violation).optional(),
});
export type Problem = z.infer<typeof Problem>;
