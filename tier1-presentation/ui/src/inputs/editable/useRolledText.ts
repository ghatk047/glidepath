import { useEffect, useRef, useState } from 'react';
import { EM_DASH } from '../../format';
import { NumberRoll } from '../../motion';

export interface RolledText {
  text: string;
  /** Reserved width in `ch`, so the roll causes no layout shift. */
  minWidthCh: number;
}

/**
 * React wrapper for the framework-free NumberRoll: the DISPLAYED text tweens to the value tier 2
 * pushed. Nothing is computed here; `format` is the presentation transform (`fmt.*`).
 */
export function useRolledText(
  value: number | null | undefined,
  format: (v: number) => string,
): RolledText {
  const fmtRef = useRef(format);
  const rollRef = useRef<NumberRoll | null>(null);
  const [state, setState] = useState<RolledText>(() => {
    const text = typeof value === 'number' ? format(value) : EM_DASH;
    return { text, minWidthCh: text.length };
  });

  useEffect(() => {
    fmtRef.current = format;
  });

  useEffect(() => {
    const roll = new NumberRoll({
      format: (v) => fmtRef.current(v),
      initial: null,
      onFrame: (text, { minWidthCh }) =>
        setState((s) =>
          s.text === text && s.minWidthCh === minWidthCh ? s : { text, minWidthCh },
        ),
    });
    rollRef.current = roll;
    return () => {
      roll.destroy();
      rollRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (typeof value === 'number' && Number.isFinite(value)) rollRef.current?.set(value);
    else setState({ text: EM_DASH, minWidthCh: EM_DASH.length });
  }, [value, format]);

  return state;
}
