import type { ReactNode } from 'react';
import { fmt } from '../format';
import { HudStyles } from './HudStyles';

export type ChipStatus = 'clear' | 'short' | 'conflict' | 'info';
type Tone = 'pos' | 'neg' | 'warn' | 'neutral';

/** Every status carries an icon glyph and a word, never colour alone (04 inventory #18). */
const STATUS: Record<ChipStatus, { icon: string; tone: Tone }> = {
  clear: { icon: '▲', tone: 'pos' },
  short: { icon: '▼', tone: 'neg' },
  conflict: { icon: '⚠', tone: 'warn' },
  info: { icon: '●', tone: 'neutral' },
};

interface ChipBase {
  className?: string;
}
/** Gap mode: `res.gap` in $M. >= 0 reads "▲ $23.9M clear", < 0 reads "▼ $23.7M short". */
export interface GapChipProps extends ChipBase {
  gap: number | null | undefined;
  status?: undefined;
  label?: undefined;
}
/** Status mode: a status with its own words and number, e.g. "1 conflict". */
export interface LabelChipProps extends ChipBase {
  status: ChipStatus;
  /** Word plus number, e.g. "1 conflict". The icon is added by the chip. */
  label: ReactNode;
  gap?: undefined;
}
export type StatusChipProps = GapChipProps | LabelChipProps;

/**
 * Status chip (`gapChip`): icon + word + number. The value is a prop from tier 2; the chip only
 * picks the icon and word for the sign it is handed.
 */
export function StatusChip(props: StatusChipProps) {
  let status: ChipStatus;
  let body: ReactNode;
  if (props.status !== undefined) {
    status = props.status;
    body = props.label;
  } else if (typeof props.gap === 'number' && Number.isFinite(props.gap)) {
    const clear = props.gap >= 0;
    status = clear ? 'clear' : 'short';
    body = `${fmt.money(clear ? props.gap : -props.gap)} ${clear ? 'clear' : 'short'}`;
  } else {
    status = 'info';
    body = `${fmt.money(props.gap)} gap`;
  }
  const { icon, tone } = STATUS[status];
  return (
    <>
      <HudStyles />
      <span
        className={props.className ? `gp-chip ${props.className}` : 'gp-chip'}
        data-tone={tone}
        data-status={status}
      >
        <span className="gp-chip-icon" aria-hidden="true">
          {icon}
        </span>{' '}
        <span className="gp-chip-text">{body}</span>
      </span>
    </>
  );
}
