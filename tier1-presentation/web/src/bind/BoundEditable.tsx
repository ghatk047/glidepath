import {
  EditableNumber,
  parseNumber,
  type EditableNumberPopover,
} from '@glidepath/ui/inputs/editable';
import { formatFor, type FormatProp } from './format';
import { useVariable } from './useVariable';
import { Value } from './Value';

interface Common {
  member?: string;
  /** `fmt` kind or function; default by the unit (and step) tier 2 sent. */
  format?: FormatProp;
  className?: string;
}

export interface BoundEditableInputProps extends Common {
  /** Registry variable id, verbatim (`g.target_net`). */
  variable: string;
  node?: never;
  /** Solid underline; default: the scenario sets this value itself (`from: 'scenario'`). */
  changed?: boolean;
  onTrace?: never;
}

export interface BoundEditableOutputProps extends Common {
  /** Formula node id, verbatim (`res.net`): click opens the trace drawer. */
  node: string;
  variable?: never;
  changed?: never;
  onTrace?: (cell: string) => void;
}

export type BoundEditableProps = BoundEditableInputProps | BoundEditableOutputProps;

/** Percent cells are decimals (0.12); a typed "12" means 12%, the inverse of `fmt.pct`. */
const parseFor = (unit: string) =>
  unit === '%'
    ? (text: string) => {
        const n = parseNumber(text);
        return n === null ? null : n / 100;
      }
    : undefined;

function BoundInput({
  variable,
  member = '',
  format,
  changed,
  className,
}: BoundEditableInputProps) {
  const v = useVariable(variable, member);
  const d = v.definition;
  const show = formatFor(format, d?.unit, d?.step);
  const fail = () => undefined; // WEB-05 surfaces commit errors; the session shows tier 2's.

  const popover: EditableNumberPopover | undefined =
    d && d.min !== null && d.max !== null && d.step !== null
      ? {
          label: d.label,
          unit: d.unit,
          min: d.min,
          max: d.max,
          step: d.step,
          source: d.source,
          confidence: d.confidence,
          // Unknown default reads "Default —"; Reset never sends it (it clears the own value).
          defaultValue: d.default ?? Number.NaN,
          ...(parseFor(d.unit) ? { parse: parseFor(d.unit) } : {}),
          onChange: (next) => {
            v.preview(next);
            void v.commit(next).catch(fail);
          },
          onReset: () => void v.commit(null).catch(fail),
        }
      : undefined;

  return (
    <span data-stale={v.stale || undefined} className="gp-value-wrap">
      <EditableNumber
        variableId={variable}
        value={v.value}
        format={show}
        popover={popover}
        changed={changed ?? (v.from === undefined ? undefined : v.from === 'scenario')}
        className={className}
      />
    </span>
  );
}

/**
 * `<BoundEditable variable="g.target_net" />` (input: popover with the definition, edits go to
 * tier 2 as preview + commit) or `<BoundEditable node="res.net" />` (output: opens the trace).
 */
export function BoundEditable(props: BoundEditableProps) {
  if (props.node !== undefined) {
    const { node, member, format, onTrace, className } = props;
    return (
      <Value node={node} member={member} format={format} onTrace={onTrace} className={className} />
    );
  }
  return <BoundInput {...props} />;
}
