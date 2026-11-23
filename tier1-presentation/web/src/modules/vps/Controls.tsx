import { Segmented } from '@glidepath/ui/inputs/controls';
import { useVariable } from '../../bind';
import { BoundToggle } from './Bound';

/** Copy of the registry enum `g.vp_target_method`, in registry order (min, min + 1, ...). */
const TARGET_METHODS = ['Proportional', 'Equal', 'Manual'] as const;

/** Target method segmented control and chargeback toggle (screens doc: Controls panel). */
export function Controls() {
  const method = useVariable('g.vp_target_method');
  const first = method.definition?.min ?? null;
  const options = TARGET_METHODS.map((label, i) => ({
    id: String(first === null ? i : first + i),
    label,
  }));
  const current = typeof method.value === 'number' ? String(method.value) : '';
  return (
    <div className="gp-vps-controls" role="group" aria-label="VP controls">
      <div className="gp-vps-controls-item">
        <span className="gp-vps-eyebrow" id="vps-targets-label">
          Targets
        </span>
        {first !== null && (
          <Segmented
            variableId="g.vp_target_method"
            label="Target method"
            options={options}
            value={current}
            onChange={(id) => void method.commit(Number(id)).catch(() => undefined)}
          />
        )}
      </div>
      <div className="gp-vps-controls-item">
        <span className="gp-vps-eyebrow">Chargeback</span>
        <BoundToggle variable="g.chargeback_on" label="Chargeback" />
      </div>
      <span className="gp-vps-note">Bars = VP target + own cost growth</span>
    </div>
  );
}
