import { describe, expect, it } from 'vitest';
import { loadParityInputs } from './load';
import { REPLAY_RULES, ruleFor, runReplay } from './replay';
import { Runner } from './runs';

const inputs = await loadParityInputs();
const runner = new Runner(inputs.bundle, inputs.seed);

/** Checks per rule, from the replay table of tier2-logic/engine/PORTING.md §6. */
const PORTING_COUNTS: Record<string, number> = {
  R01: 85,
  R02: 70,
  R03: 5,
  R04: 5,
  R05: 5,
  R06: 4,
  R07: 4,
  R08: 4,
  R09: 4,
  R10: 4,
  R11: 4,
  R12: 4,
  R13: 1,
  R14: 1,
  R15: 21,
  R16: 1,
  R17: 4,
  R18: 1,
  R19: 3,
  R20: 5,
  R21: 5,
  R22: 5,
};

describe('parity replay', () => {
  it('every check falls under exactly one rule, with the counts of PORTING.md §6', () => {
    const counts: Record<string, number> = {};
    const runs: Record<string, number> = {};
    for (const { check } of inputs.report.checks) {
      const { rule } = ruleFor(check);
      counts[rule.id] = (counts[rule.id] ?? 0) + 1;
      runs[rule.run] = (runs[rule.run] ?? 0) + 1;
    }
    expect(REPLAY_RULES.map((r) => r.id)).toEqual(Object.keys(PORTING_COUNTS));
    expect(counts).toEqual(PORTING_COUNTS);
    expect(runs).toEqual({ PARITY: 212, CB_OFF: 18, PLAIN: 15 });
    expect(() => ruleFor('levers v0.3 E L01 in-year')).toThrow(/matches 0 rules/);
  });

  it('replays the 245 checks of parity_report.json within 1e-6 absolute after round(x, 6): 245/245', () => {
    const report = runReplay(runner, inputs.report);
    const misses = report.rows.filter((r) => !r.pass).map((r) => `${r.rule} ${r.check}`);
    expect(misses).toEqual([]);
    expect(`${report.passed}/${report.total}`).toBe('245/245');
    // Spot checks of the table: run and value of one check per run kind.
    const row = (check: string) => report.rows.find((r) => r.check === check)!;
    expect(row('levers v0.3 VP vp_infra net C').run).toBe('PARITY(C)');
    expect(row('baseline headwinds').run).toBe('CB_OFF');
    expect(row('invariant D VP nets sum to total net').run).toBe('PLAIN(D)');
  });
});
