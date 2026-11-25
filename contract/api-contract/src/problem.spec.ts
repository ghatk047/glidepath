import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PROBLEM_CONTENT_TYPE, Problem, RuleId, Severity, Violation, problemTypes } from './index';

const schemaJson = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../docs/spec/schema.json', import.meta.url)), 'utf8'),
) as { validation_rules: { id: string; severity: string }[] };

const validation = {
  type: problemTypes.validation,
  title: 'Changeset rejected',
  status: 422,
  detail: "Org_Map row 'Data & analytics' sums to 95%. Make it 100%.",
  violations: [
    {
      rule: 'VR01',
      cells: ['org.dom_share[cio,data_analytics]', 'org.dom_share[cfo,data_analytics]'],
      severity: 'error',
      message: "Org_Map row 'Data & analytics' sums to 95%. Make it 100%.",
    },
    {
      rule: 'VR04',
      cells: ['hc.us[]'],
      severity: 'warning',
      message: 'US headcount is above the registry maximum.',
    },
  ],
};

describe('problem: RFC 9457 problem JSON', () => {
  it('parses type, title, status, detail and violations', () => {
    expect(Problem.parse(validation)).toEqual(validation);
  });

  it('accepts a problem without violations and defaults type to about:blank', () => {
    const parsed = Problem.parse({ title: 'Not found', status: 404, detail: 'No such scenario.' });
    expect(parsed.type).toBe('about:blank');
    expect(parsed.violations).toBeUndefined();
  });

  it('keeps instance when present', () => {
    const p = { ...validation, instance: '/api/t/zz/changesets' };
    expect(Problem.parse(p).instance).toBe('/api/t/zz/changesets');
  });

  it('requires detail to be one non-empty line for the error chip (IA §6)', () => {
    expect(Problem.safeParse({ ...validation, detail: 'line one\nline two' }).success).toBe(false);
    expect(Problem.safeParse({ ...validation, detail: '' }).success).toBe(false);
    const noDetail: Record<string, unknown> = { ...validation };
    delete noDetail.detail;
    expect(Problem.safeParse(noDetail).success).toBe(false);
  });

  it('requires an HTTP error status', () => {
    for (const status of [200, 302, 600, 422.5]) {
      expect(Problem.safeParse({ ...validation, status }).success, String(status)).toBe(false);
    }
  });

  it('limits violation rules to VR01–VR10 exactly as in schema.json', () => {
    expect([...RuleId.options]).toEqual(schemaJson.validation_rules.map((r) => r.id));
    expect(Violation.safeParse({ ...validation.violations[0], rule: 'VR11' }).success).toBe(false);
    expect(Violation.safeParse({ ...validation.violations[0], rule: 'vr01' }).success).toBe(false);
  });

  it('severity is error | warning (schema.json severities)', () => {
    expect([...Severity.options]).toEqual(['error', 'warning']);
    for (const rule of schemaJson.validation_rules) {
      expect(
        Severity.options.some((s) => rule.severity.startsWith(s)),
        rule.id,
      ).toBe(true);
    }
    expect(Violation.safeParse({ ...validation.violations[0], severity: 'info' }).success).toBe(
      false,
    );
  });

  it('violation cells are cell keys and the message is one line', () => {
    const v = validation.violations[0]!;
    expect(Violation.safeParse({ ...v, cells: ['org.dom_share'] }).success).toBe(false);
    expect(Violation.safeParse({ ...v, message: 'a\nb' }).success).toBe(false);
    expect(Violation.safeParse({ ...v, cells: [] }).success).toBe(true);
  });

  it('exports the problem media type', () => {
    expect(PROBLEM_CONTENT_TYPE).toBe('application/problem+json');
  });
});
