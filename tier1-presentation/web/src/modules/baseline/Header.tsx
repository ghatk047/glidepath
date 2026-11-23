import type { BaselineGroupBy } from '@glidepath/api-contract';
import { fmt } from '@glidepath/ui/format';
import { Segmented } from '@glidepath/ui/inputs/controls';
import { Value, useView } from '../../bind';
import { GROUP_BY_OPTIONS } from './model';

const wholeMoney = (v: number) => fmt.money(v, { digits: 0 });

/**
 * Header strip: CY26 normalized, opex, capex, locked share and line counts, bound to the spec's
 * `base.*` nodes and the `baseline.summary` view; group-by segmented (the `by` of `baseline.groups`).
 */
export function BaselineHeader({
  by,
  onBy,
}: {
  by: BaselineGroupBy;
  onBy: (by: BaselineGroupBy) => void;
}) {
  const summary = useView('baseline.summary', {});
  const counts = summary.payload;
  return (
    <section className="gp-bl-strip" aria-label="CY26 baseline totals">
      <div className="gp-bl-kpi" data-hero>
        <span className="gp-eyebrow">CY26 normalized</span>
        <strong data-kpi="base.total">
          <Value node="base.total" format={wholeMoney} />
        </strong>
      </div>
      <div className="gp-bl-kpi">
        <span className="gp-eyebrow">Opex</span>
        <strong data-kpi="base.opex_total">
          <Value node="base.opex_total" format="money" />
        </strong>
      </div>
      <div className="gp-bl-kpi">
        <span className="gp-eyebrow">Capex</span>
        <strong data-kpi="base.capex_total">
          <Value node="base.capex_total" format="money" />
        </strong>
      </div>
      <div className="gp-bl-kpi">
        <span className="gp-eyebrow">Locked for 2027</span>
        <strong data-kpi="base.locked_share">
          <Value node="base.locked_share" format="pct" />
        </strong>
      </div>
      <div className="gp-bl-kpi" data-stale={summary.stale || undefined}>
        <span className="gp-eyebrow">Lines</span>
        <strong data-kpi="lines">
          {counts ? fmt.fte(counts.lines) : '—'}
          {counts && <small> · {fmt.fte(counts.linesInScope)} in scope</small>}
        </strong>
      </div>
      <div className="gp-bl-groupby">
        <Segmented
          label="Group by"
          options={GROUP_BY_OPTIONS}
          value={by}
          onChange={onBy}
        />
      </div>
    </section>
  );
}
