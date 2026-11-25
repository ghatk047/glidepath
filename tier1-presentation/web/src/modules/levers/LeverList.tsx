import type { CSSProperties } from 'react';
import type { LeversFamiliesView } from '@glidepath/api-contract';
import { fmt } from '@glidepath/ui/format';
import { Toggle } from '@glidepath/ui/inputs/controls';
import { Value, useNode, useVariable } from '../../bind';

export interface LeverListProps {
  families: LeversFamiliesView;
  /** In-year bar scale: the `levers.scale` view's `max`. */
  scaleMax: number | undefined;
  labels: Readonly<Record<string, string>>;
  selected: string;
  onSelect(lever: string): void;
}

interface RowProps {
  lever: string;
  label: string;
  scaleMax: number | undefined;
  selected: boolean;
  onSelect(lever: string): void;
}

/** One lever: `lev.on` toggle, name, in-year bar scaled by `levers.scale`, `lev.iy`. */
function LeverRow({ lever, label, scaleMax, selected, onSelect }: RowProps) {
  const on = useVariable('lev.on', lever);
  const iy = useNode('lev.iy', lever);
  const isOn = on.value !== 0;
  const style = {
    '--value': iy.value ?? 0,
    '--max': scaleMax ?? 1,
  } as CSSProperties;
  return (
    <li
      className="gp-lv-row"
      aria-current={selected ? 'true' : undefined}
      data-off={!isOn || undefined}
      data-stale={on.stale || iy.stale || undefined}
    >
      <Toggle
        variableId="lev.on"
        label={`${label} on`}
        value={isOn}
        disabled={on.value === undefined}
        onChange={(next) => void on.commit(next ? 1 : 0).catch(() => undefined)}
      />
      <span className="gp-lv-main">
        <button
          type="button"
          className="gp-lv-name"
          data-lever={lever}
          aria-pressed={selected}
          onClick={() => onSelect(lever)}
        >
          {label}
        </button>
        <span className="gp-lv-bar" aria-hidden="true">
          <i style={style} />
        </span>
      </span>
      <Value node="lev.iy" member={lever} format="money" className="gp-lv-iy" />
    </li>
  );
}

/** Lever list (panel 4): families with totals from `levers.families`, rows below. */
export function LeverList({ families, scaleMax, labels, selected, onSelect }: LeverListProps) {
  return (
    <>
      {families.families.map((f) => (
        <div key={f.key} className="gp-lv-group" role="group" aria-label={f.label}>
          <div className="gp-lv-family">
            <h3 className="gp-lv-eyebrow">{f.label}</h3>
            <span className="gp-lv-eyebrow" data-family-total={f.key} data-value={f.value}>
              {fmt.money(f.value)}
            </span>
          </div>
          <ul className="gp-lv-list">
            {f.levers.map((lever) => (
              <LeverRow
                key={lever}
                lever={lever}
                label={labels[lever] ?? lever}
                scaleMax={scaleMax}
                selected={lever === selected}
                onSelect={onSelect}
              />
            ))}
          </ul>
        </div>
      ))}
    </>
  );
}
