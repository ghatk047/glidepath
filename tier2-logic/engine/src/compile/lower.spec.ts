import { beforeAll, describe, expect, it } from 'vitest';
import { bundleOf, loadSeedModel, membersOf } from '../../test/helpers';
import { compileModel, type EngineModel } from './compile';
import { disassemble } from './lower';
import { CHK, JF, JMP, JZ, MISS, WIDTH } from './program';

let model: EngineModel;
let lineIdsOfPool: (pool: string) => string[];

beforeAll(async () => {
  const { bundle, seed } = await loadSeedModel();
  model = compileModel(bundle, seed.dimensionMembers);
  lineIdsOfPool = (pool) =>
    seed.dimensionMembers['line']!.filter((l) => l['pool'] === pool).map((l) => l.id);
});

const dump = (m: EngineModel, key: string) =>
  disassemble(m.program, m.program.cellKeys.indexOf(key));

describe('lowering to a flat program (lower.spec.ts)', () => {
  it('instruction dump for 5 sample nodes', () => {
    // IF(line.drv == 'us', …): the condition is a member attribute, so the branch is picked at compile
    // time; inputs are checked where they are read.
    expect(dump(model, 'base.line_scale[it_001]')).toEqual([
      '@0 CHK in:hc.us',
      '@1 CHK in:hc.us_seed',
      '@2 base.line_scale[it_001] = DIV in:hc.us, in:hc.us_seed',
    ]);

    // SUM(l in line where l.pool == pool, …): an index list of the lines that pass, in member order.
    const terms = lineIdsOfPool('software').map((l) => `base.line_outlay[${l}]`);
    expect(terms.length).toBeGreaterThan(1);
    expect(dump(model, 'base.pool_outlay[software]')).toEqual([
      `@0 base.pool_outlay[software] = SUM [${terms.join(', ')}]`,
    ]);

    // MAX(1, lev.start - g.head_start): arguments left to right into temps, then one list op.
    expect(dump(model, 'lev.eff_start[L01]')).toEqual([
      '@0 CHK in:lev.start[L01]',
      '@1 CHK in:g.head_start',
      '@2 t0 = SUB in:lev.start[L01], in:g.head_start',
      '@3 lev.eff_start[L01] = MAX [#1, t0]',
    ]);

    // IF with a cell-valued condition stays lazy: a conditional jump over each branch.
    expect(dump(model, 'lev.ramp_factor[L01]')).toEqual([
      '@0 t0 = SUB #13, lev.eff_start[L01]',
      '@1 CHK in:lev.ramp[L01]',
      '@2 t0 = LE t0, in:lev.ramp[L01]',
      '@3 JF t0 -> @11',
      '@4 t1 = SUB #13, lev.eff_start[L01]',
      '@5 t2 = SUB #14, lev.eff_start[L01]',
      '@6 t1 = MUL t1, t2',
      '@7 CHK in:lev.ramp[L01]',
      '@8 t2 = MUL #2, in:lev.ramp[L01]',
      '@9 t0 = DIV t1, t2',
      '@10 JMP -> @18',
      '@11 CHK in:lev.ramp[L01]',
      '@12 t1 = ADD in:lev.ramp[L01], #1',
      '@13 t1 = DIV t1, #2',
      '@14 t2 = SUB #13, lev.eff_start[L01]',
      '@15 CHK in:lev.ramp[L01]',
      '@16 t2 = SUB t2, in:lev.ramp[L01]',
      '@17 t0 = ADD t1, t2',
      '@18 lev.ramp_factor[L01] = DIV t0, #12',
    ]);

    // SAFEDIV(a, b, 0): the divisor first; the numerator only when it is non-zero, the alt only when zero.
    expect(dump(model, 'vp.usage_default[vp_commercial]')).toEqual([
      '@0 t0 = SUM [vp.nonshared[vp_commercial], vp.nonshared[vp_operations], vp.nonshared[vp_corporate], vp.nonshared[vp_infra]]',
      '@1 JZ t0 -> @4',
      '@2 vp.usage_default[vp_commercial] = SDIV vp.nonshared[vp_commercial], t0',
      '@3 JMP -> @5',
      '@4 vp.usage_default[vp_commercial] = #0',
    ]);
  });

  it('one Float64Array slot per cell and input; each instruction reads slots and writes at most one', () => {
    const p = model.program;
    expect(p.nCells).toBe(3370);
    expect(new Set(p.cellKeys).size).toBe(p.nCells);
    expect(new Set(p.inputKeys).size).toBe(p.nInputs);
    expect(p.inputBase).toBe(p.nCells);
    expect(p.constBase).toBe(p.inputBase + p.nInputs);
    expect(p.tempBase).toBe(p.constBase + p.consts.length);
    expect(p.nSlots).toBe(p.tempBase + p.nTemps);
    expect(p.cellStart).toHaveLength(p.nCells + 1);
    expect(p.code.length % WIDTH).toBe(0);
    expect(p.cellStart[p.nCells]).toBe(p.code.length / WIDTH);

    for (let t = 0; t < p.nCells; t++) {
      let wroteSelf = false;
      for (let i = p.cellStart[t]!; i < p.cellStart[t + 1]!; i++) {
        const [op, dst, a, b] = Array.from(p.code.subarray(i * WIDTH, (i + 1) * WIDTH));
        if (op === JF || op === JZ || op === JMP) {
          // Jumps stay inside the cell's code.
          expect(b! > i && b! <= p.cellStart[t + 1]!, `${p.cellKeys[t]} @${i}`).toBe(true);
        }
        if (op === CHK) expect(a! >= p.inputBase && a! < p.constBase).toBe(true);
        if (op === JF || op === JZ || op === JMP || op === CHK || op === MISS) {
          expect(dst).toBe(-1);
          continue;
        }
        // A cell writes only its own slot or temporaries.
        expect(dst === t || dst! >= p.tempBase, `${p.cellKeys[t]} @${i} writes ${dst}`).toBe(true);
        if (dst === t) wroteSelf = true;
      }
      expect(wroteSelf, p.cellKeys[t]).toBe(true);
    }
    expect(model.diagnostics.dangling).toEqual([]);
  });

  it('dangling node keys and missing attributes compile to MISSING reads', () => {
    const m = compileModel(
      bundleOf({
        variables: [{ id: 'x', dims: ['d'] }],
        nodes: [
          { id: 'v', dims: ['d'], members: { d: ['a'] }, expr: '1' },
          {
            id: 'n',
            dims: ['d'],
            expr: "IF(x > 0, v['b'], d.w) + SAFEDIV(1, x) + -x + ABS(x) + NOT(x)",
          },
        ],
      }),
      membersOf({ d: [{ id: 'a', w: 2 }, { id: 'b' }] }),
    );
    expect(m.diagnostics.dangling).toEqual(['v[b]']);
    // The untaken branches never run, so neither MISS raises unless its branch is taken (S20, S21).
    expect(dump(m, 'n[b]')).toEqual([
      '@0 CHK in:x[b]',
      '@1 t0 = GT in:x[b], #0',
      '@2 JF t0 -> @6',
      '@3 MISS "missing v[b]"',
      '@4 t0 = #NaN',
      '@5 JMP -> @8',
      `@6 MISS "member 'b' of 'd' has no attribute 'w'"`,
      '@7 t0 = #NaN',
      '@8 CHK in:x[b]',
      '@9 JZ in:x[b] -> @12',
      '@10 t1 = SDIV #1, in:x[b]',
      '@11 JMP -> @13',
      '@12 t1 = #0',
      '@13 t0 = ADD t0, t1',
      '@14 CHK in:x[b]',
      '@15 t1 = NEG in:x[b]',
      '@16 t0 = ADD t0, t1',
      '@17 CHK in:x[b]',
      '@18 t1 = ABS in:x[b]',
      '@19 t0 = ADD t0, t1',
      '@20 CHK in:x[b]',
      '@21 t1 = NOT in:x[b]',
      '@22 n[b] = ADD t0, t1',
    ]);
    expect(dump(m, 'n[a]').slice(5, 7)).toEqual(['@5 JMP -> @7', '@6 t0 = #2']);
    expect(m.upstream('n[a]')).toEqual(['x[a]', 'v[b]']);
  });
});
