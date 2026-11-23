import { cssVar, tokenValue } from '../tokens';
import { motionMs } from './tokens';

/**
 * Spring durations. The spring curve and the toast hold come from tokens; the moodboard gives the
 * spring duration only as a band ("250-300 ms", docs/ux/01_moodboard.md#Motion) with no token yet,
 * so the two ends live here until tokens.json grows `motion.springShort` / `motion.springLong`.
 */
const SPRING_SHORT_MS = 250;
const SPRING_LONG_MS = 300;

export interface SpringPreset {
  /** Token value, for JS-driven animation: "cubic-bezier(.34,1.56,.64,1)". */
  easing: string;
  /** Token reference, for CSS: "var(--motion-spring)". */
  cssEasing: string;
  durationMs: number;
  /** Toast only: how long it stays on screen (token motion.toast). */
  holdMs?: number;
  /** What the preset becomes under prefers-reduced-motion: no animation, values jump. */
  reduced: { durationMs: 0; holdMs?: number };
}

const preset = (durationMs: number, holdMs?: number): SpringPreset => ({
  easing: tokenValue['motion.spring'],
  cssEasing: cssVar['motion.spring'],
  durationMs,
  ...(holdMs === undefined ? {} : { holdMs }),
  // A toast still stays up long enough to read; only the spring in/out is off.
  reduced: { durationMs: 0, ...(holdMs === undefined ? {} : { holdMs }) },
});

export const springs = {
  toggle: preset(SPRING_SHORT_MS),
  toast: preset(SPRING_LONG_MS, motionMs('toast')),
  drawer: preset(SPRING_LONG_MS),
} as const satisfies Record<string, SpringPreset>;

export type SpringName = keyof typeof springs;

/** CSS `transition` value for the given properties, or "none" under reduced motion. */
export function transition(
  name: SpringName,
  properties: readonly string[],
  reduced = false,
): string {
  if (reduced || properties.length === 0) return 'none';
  const { durationMs, cssEasing } = springs[name];
  return properties.map((p) => `${p} ${durationMs}ms ${cssEasing}`).join(', ');
}
