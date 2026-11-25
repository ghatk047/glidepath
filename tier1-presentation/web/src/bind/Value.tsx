import { useLayoutEffect, useRef } from 'react';
import { EditableNumber } from '@glidepath/ui/inputs/editable';
import { EM_DASH } from '@glidepath/ui/format';
import { bindNumberRoll, type NumberRoll } from '@glidepath/ui/motion';
import { useBindContext } from './context';
import { formatFor, type FormatProp } from './format';
import { useNode } from './useNode';

export interface ValueProps {
  /** Formula node id, verbatim (`res.net`). */
  node: string;
  member?: string;
  /** `fmt` kind or function; default by the node's unit from the bundle. */
  format?: FormatProp;
  /**
   * Opens the trace drawer (inventory #9: outputs open the trace drawer). Default: the
   * provider's `onTrace`. With neither, the value is plain text.
   */
  onTrace?: (cell: string) => void;
  className?: string;
}

const isNum = (v: number | null | undefined): v is number =>
  typeof v === 'number' && Number.isFinite(v);

/** Plain rolled number (no trace): the display tweens to each pushed value. */
function Rolled({
  value,
  format,
  className,
  stale,
}: {
  value: number | null | undefined;
  format: (v: number) => string;
  className: string | undefined;
  stale: boolean;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const roll = useRef<NumberRoll | null>(null);
  const fmtRef = useRef(format);
  fmtRef.current = format;
  const first = useRef(value);

  useLayoutEffect(() => {
    const el = ref.current!;
    const r = bindNumberRoll(el, {
      format: (n) => fmtRef.current(n),
      initial: isNum(first.current) ? first.current : null,
    });
    if (!isNum(first.current)) el.textContent = EM_DASH;
    roll.current = r;
    return () => {
      r.destroy();
      roll.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    if (isNum(value)) roll.current?.set(value);
    else if (ref.current) ref.current.textContent = EM_DASH;
  }, [value]);

  return (
    <span
      ref={ref}
      className={['gp-value', className].filter(Boolean).join(' ')}
      data-stale={stale || undefined}
      data-value={isNum(value) ? value : undefined}
    />
  );
}

/**
 * `<Value node="res.net" format="money" />`: an output cell as tier 2 pushed it. Subscribes on
 * mount (`useNode`). With a trace handler it is the output Editable number (#9) that opens the
 * trace drawer; otherwise a rolled number. Stale values (session dropped) carry `data-stale`.
 */
export function Value({ node, member = '', format, onTrace, className }: ValueProps) {
  const ctx = useBindContext();
  const bound = useNode(node, member);
  const show = formatFor(format, bound.def?.unit, undefined, bound.def?.percentScale);
  const trace = onTrace ?? ctx.onTrace;

  if (trace) {
    return (
      <span
        data-stale={bound.stale || undefined}
        // the raw pushed value, as the rolled number carries it, whether or not the cell opens the trace
        data-value={isNum(bound.value) ? bound.value : undefined}
        className="gp-value-wrap"
      >
        <EditableNumber
          mode="output"
          nodeId={node}
          value={bound.value}
          format={show}
          onTrace={() => trace(bound.cell)}
          className={className}
        />
      </span>
    );
  }
  return <Rolled value={bound.value} format={show} className={className} stale={bound.stale} />;
}
