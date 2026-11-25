import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { section, tableRows, unquote } from './porting-doc';

const here = dirname(fileURLToPath(import.meta.url));
const reference = resolve(here, '../../../docs/spec/reference');
const porting = readFileSync(resolve(here, '../PORTING.md'), 'utf8');
const golden = JSON.parse(readFileSync(resolve(reference, 'golden_results.json'), 'utf8')) as {
  scenarios: Record<string, unknown>;
};
const report = JSON.parse(readFileSync(resolve(reference, 'parity_report.json'), 'utf8')) as {
  passed: number;
  checks: { check: string; engine: number; pass: boolean }[];
  parity_overrides: Record<string, number>;
};

const harness = section(porting, /^## \d+\. Parity harness design/);

function leaves(x: unknown): number {
  return x !== null && typeof x === 'object'
    ? Object.values(x).reduce<number>((n, v) => n + leaves(v), 0)
    : 1;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

describe('PORTING.md parity harness design (porting-harness.spec.ts)', () => {
  it('has the four harness headings', () => {
    expect(harness, 'section "## N. Parity harness design"').not.toBe('');
    expect(harness).toMatch(/^### Tolerance: 1e-6 relative \/ 1e-9 absolute$/m);
    expect(harness).toMatch(/^### Golden: 760 values$/m);
    expect(harness).toMatch(/^### Parity replay: 245 checks$/m);
    expect(harness).toMatch(/^### Fuzz: 200 vectors$/m);
  });

  it('states counts that match the reference data (760 golden values, 245 checks, 36 overrides)', () => {
    expect(Object.keys(golden.scenarios)).toEqual(['rates', 'A', 'B', 'C', 'D']);
    expect(leaves(golden.scenarios)).toBe(760);
    expect(report.checks).toHaveLength(245);
    expect(report.passed).toBe(245);
    expect(Object.keys(report.parity_overrides)).toHaveLength(36);
    expect(harness).toMatch(/36 node cells/);
  });

  it('replay table: every check name matches exactly one rule, with the stated counts', () => {
    const replay = section(harness, /^### Parity replay: 245 checks$/);
    const rows = tableRows(replay);
    const legend = new Map<string, string>();
    for (const c of rows) {
      const m = /^\{(\w+)\}$/.exec(unquote(c[0] ?? ''));
      if (m) legend.set(m[1]!, `(?:${c[1]!.split(/,\s*/).map(escape).join('|')})`);
    }
    const rules = rows
      .filter((c) => /^R\d\d$/.test(c[0] ?? ''))
      .map((c) => {
        const template = unquote(c[1] ?? '');
        const source = escape(template).replace(/\\\{(\w+)\\\}/g, (_, name: string) => {
          const alt = legend.get(name);
          if (!alt) throw new Error(`placeholder {${name}} has no legend row`);
          return alt;
        });
        return { id: c[0]!, re: new RegExp(`^${source}$`), run: c[2] ?? '', count: Number(c[4]) };
      });
    expect(rules.length).toBeGreaterThan(0);
    for (const r of rules)
      expect(r.run, r.id).toMatch(/^`(PARITY\((sid|C)\)|CB_OFF|PLAIN\(sid\))`$/);

    const hits = new Map<string, number>(rules.map((r) => [r.id, 0]));
    for (const { check } of report.checks) {
      const matched = rules.filter((r) => r.re.test(check));
      expect(
        matched.map((r) => r.id),
        check,
      ).toHaveLength(1);
      hits.set(matched[0]!.id, hits.get(matched[0]!.id)! + 1);
    }
    for (const r of rules) expect(hits.get(r.id), `${r.id} count`).toBe(r.count);
    expect(rules.reduce((n, r) => n + r.count, 0)).toBe(245);
  });
});
