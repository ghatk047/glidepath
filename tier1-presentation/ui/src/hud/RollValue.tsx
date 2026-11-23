import { useLayoutEffect, useRef } from 'react';
import { bindNumberRoll, type NumberRoll } from '../motion';

export interface RollValueProps {
  /** The value tier 2 pushed. Null/undefined shows the format's empty mark. */
  value: number | null | undefined;
  /** Display formatter, e.g. `fmt.money`. */
  format: (value: number | null | undefined) => string;
  className?: string;
}

const isNum = (v: number | null | undefined): v is number =>
  typeof v === 'number' && Number.isFinite(v);

/** React wrapper over the framework-free number roll: tweens the display only. */
export function RollValue({ value, format, className }: RollValueProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const roll = useRef<NumberRoll | null>(null);
  const first = useRef(value);
  const fmtRef = useRef(format);
  fmtRef.current = format;

  useLayoutEffect(() => {
    const el = ref.current!;
    const r = bindNumberRoll(el, {
      format: (n) => fmtRef.current(n),
      initial: isNum(first.current) ? first.current : null,
    });
    if (!isNum(first.current)) el.textContent = fmtRef.current(first.current);
    roll.current = r;
    return () => {
      r.destroy();
      roll.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    if (isNum(value)) roll.current?.set(value);
    else if (ref.current) ref.current.textContent = fmtRef.current(value);
  }, [value]);

  return <span ref={ref} className={className} data-value={isNum(value) ? value : undefined} />;
}
