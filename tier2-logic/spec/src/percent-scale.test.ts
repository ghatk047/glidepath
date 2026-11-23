import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  endsInTimes100,
  isPercentUnit,
  nodePercentScale,
  variablePercentScale,
  type ModelBundle,
} from './index';
import { loadModelBundleFromDir } from './node';

const here = dirname(fileURLToPath(import.meta.url));
const specDir = resolve(here, '../../../docs/spec');

describe('percent scale (WEB-10)', async () => {
  const bundle: ModelBundle = await loadModelBundleFromDir(specDir);
  const pctVars = bundle.variables.filter((v) => isPercentUnit(v.unit));
  const pctNodes = bundle.nodes.filter((n) => isPercentUnit(n.unit));

  it('every corporate % variable is points and g.target_pct is fraction', () => {
    const corporate = pctVars.filter((v) => v.layer === 'corporate');
    expect(corporate.length).toBe(33); // 32 `%` + `corp.fuel_eff` `%/yr`
    for (const v of corporate) expect(variablePercentScale(v), v.id).toBe('points');
    const target = bundle.variables.find((v) => v.id === 'g.target_pct')!;
    expect(variablePercentScale(target)).toBe('fraction');
  });

  it('the rule holds for every % variable: points have registry ranges past 1, fractions stay within [-1, 1]', () => {
    expect(pctVars.length).toBe(93);
    for (const v of pctVars) {
      const scale = variablePercentScale(v);
      if (scale === 'points') {
        expect(Math.max(Math.abs(v.min ?? 0), Math.abs(v.max ?? 0)), `${v.id} max`).toBeGreaterThan(
          1,
        );
      } else {
        expect(scale, v.id).toBe('fraction');
        expect(v.min ?? 0, `${v.id} min`).toBeGreaterThanOrEqual(-1);
        expect(v.max ?? 0, `${v.id} max`).toBeLessThanOrEqual(1);
      }
    }
  });

  it('units outside the percent family have no percent scale', () => {
    for (const v of bundle.variables.filter((x) => !isPercentUnit(x.unit))) {
      expect(variablePercentScale(v), v.id).toBeNull();
    }
    for (const n of bundle.nodes.filter((x) => !isPercentUnit(x.unit))) {
      expect(nodePercentScale(n), n.id).toBeNull();
    }
  });

  it('% nodes: corporate-layer nodes and nodes whose formula ends in "* 100" are points, the rest fractions', () => {
    const points = pctNodes.filter((n) => nodePercentScale(n) === 'points').map((n) => n.id);
    // Evidence: engine magnitudes at the five presets (server percent-scale test) and
    // docs/spec/03b_node_catalogue.md (`* 100` formulas; pl.* from corporate points inputs).
    expect(points.sort()).toEqual(
      ['br.eps_pct27', 'pl.lf', 'pl.op_margin', 'pl.rate', 'val.px_vs'].sort(),
    );
  });

  it('endsInTimes100 reads one product, not a sum with a trailing product', () => {
    expect(endsInTimes100('pl.ebit / pl.rev * 100')).toBe(true);
    expect(endsInTimes100('(val.px / corp.price_now - 1) * 100')).toBe(true);
    expect(endsInTimes100('SAFEDIV(br.eps27, pl.eps[fy27b], 0) * 100')).toBe(true);
    expect(endsInTimes100('a + b * 100')).toBe(false);
    expect(endsInTimes100('SAFEDIV(a, b, 0)')).toBe(false);
    expect(endsInTimes100('corp.it_swb / 100')).toBe(false);
  });
});
