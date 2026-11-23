/**
 * G3 golden parity (PORTING.md §6): every preset of golden_results.json is
 * `evaluate(resolveInputs(seed, preset))` with no extra values and no overrides, and each value must
 * match within 1e-6 relative / 1e-9 absolute after Python round(x, 6).
 */
import { goldenClose, pyRound, REFERENCE_DECIMALS } from './round';
import { plainRun, type Runner } from './runs';

/** Shape of `docs/spec/reference/golden_results.json` (`unified_minus_v03` is informational). */
export interface GoldenFile {
  readonly scenarios: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}

/** One golden value and the cell it is read from. */
export interface GoldenTarget {
  readonly scenario: string;
  /** Key as in the file: `res.net`, `levers.L01.rr`, `vp.vp_infra.net`. */
  readonly key: string;
  /** Cell key: verbatim for scalars, `lev.rr[L01]`, `vp.net[vp_infra]`. */
  readonly cell: string;
  readonly golden: number;
}

export interface GoldenRow extends GoldenTarget {
  /** Engine value, unrounded (null when the cell does not exist). */
  readonly ts: number | null;
  readonly rounded: number | null;
  readonly diff: number | null;
  readonly pass: boolean;
}

export interface GoldenReport {
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly rows: readonly GoldenRow[];
}

/** Groups whose entries are `{member: {field: value}}`: golden `group.member.field` → cell `prefix.field[member]`. */
const GROUPS: Readonly<Record<string, string>> = { levers: 'lev', vp: 'vp' };

function numberAt(value: unknown, where: string): number {
  if (typeof value !== 'number') throw new Error(`golden: ${where} is not a number`);
  return value;
}

/** Every golden value of every scenario, in file order. */
export function goldenTargets(file: GoldenFile): GoldenTarget[] {
  const out: GoldenTarget[] = [];
  for (const [scenario, entries] of Object.entries(file.scenarios)) {
    for (const [key, value] of Object.entries(entries)) {
      const prefix = GROUPS[key];
      if (prefix === undefined) {
        out.push({ scenario, key, cell: key, golden: numberAt(value, `${scenario}.${key}`) });
        continue;
      }
      for (const [member, fields] of Object.entries(
        value as Record<string, Record<string, unknown>>,
      )) {
        for (const [field, v] of Object.entries(fields)) {
          const where = `${scenario}.${key}.${member}.${field}`;
          out.push({
            scenario,
            key: `${key}.${member}.${field}`,
            cell: `${prefix}.${field}[${member}]`,
            golden: numberAt(v, where),
          });
        }
      }
    }
  }
  return out;
}

/** Evaluates each golden scenario as a plain preset and compares every value. */
export function runGolden(runner: Runner, file: GoldenFile): GoldenReport {
  const rows: GoldenRow[] = goldenTargets(file).map((t) => {
    const ev = runner.run(plainRun(t.scenario));
    if (!ev.has(t.cell)) return { ...t, ts: null, rounded: null, diff: null, pass: false };
    const ts = ev.get(t.cell);
    const rounded = pyRound(ts, REFERENCE_DECIMALS);
    return { ...t, ts, rounded, diff: rounded - t.golden, pass: goldenClose(rounded, t.golden) };
  });
  const passed = rows.filter((r) => r.pass).length;
  return { total: rows.length, passed, failed: rows.length - passed, rows };
}
