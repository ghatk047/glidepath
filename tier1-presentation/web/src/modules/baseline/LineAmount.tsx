import { fmt } from '@glidepath/ui/format';
import { EditableNumber, type EditableNumberPopover } from '@glidepath/ui/inputs/editable';
import { useVariable } from '../../bind';

/** Two decimals: the "CY26 $M" column of the line table (no plain-number `fmt`, so `fmt.money`). */
export const showAmount = (v: number): string => fmt.money(v, { digits: 2 });

/**
 * Editable `line.amount[line]` (the item's line inputs). `BoundEditable` needs a finite
 * min / max / step from the registry; `line.amount` has no max and no step, so the popover's
 * slider range is a display affordance here (twice the current value, 0.01 steps). Tier 2 still
 * validates the value and answers with warnings; nothing is clamped or checked in tier 1.
 */
export function LineAmount({
  line,
  name,
  format = showAmount,
}: {
  line: string;
  /** Line name for the popover title and the button's accessible name. */
  name?: string;
  format?: (v: number) => string;
}) {
  const v = useVariable('line.amount', line);
  const d = v.definition;
  const current = typeof v.value === 'number' ? v.value : 0;
  const popover: EditableNumberPopover | undefined = d && {
    label: `${name ?? line} · CY26 $M`,
    unit: d.unit,
    min: d.min ?? 0,
    max: d.max ?? Math.max(current * 2, 1),
    step: d.step ?? 0.01,
    source: d.source,
    confidence: d.confidence,
    defaultValue: d.default ?? Number.NaN,
    onChange: (next) => {
      v.preview(next);
      void v.commit(next).catch(() => undefined);
    },
    onReset: () => void v.commit(null).catch(() => undefined),
  };
  return (
    <span data-stale={v.stale || undefined} className="gp-value-wrap">
      <EditableNumber
        variableId="line.amount"
        value={v.value}
        format={format}
        popover={popover}
        changed={v.from === undefined ? undefined : v.from === 'scenario'}
      />
    </span>
  );
}
