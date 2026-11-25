/** Pure geometry and glyph set for ComputeFlow. No IO, no business values. */

/** Maths glyphs that rise through the waves (plan 5.1). */
export const COMPUTE_GLYPHS: readonly string[] = [
  '∑', '∫', '∂', 'λ', 'σ', 'μ', '∇', 'π', '≈', 'Δ', '√', '∞',
];

/** The wave tile is 200 wide and 40 tall; the svg shows it twice (viewBox 0 0 400 40). */
export const WAVE_WIDTH = 200;
export const WAVE_HEIGHT = 40;
const MID = WAVE_HEIGHT / 2;
const SEGMENTS = 80;
const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * One periodic sine tile in the viewBox `0 0 200 40`. `cycles` is rounded to a whole number
 * (at least 1) so the tile joins itself at x = 0 and x = 200; `amplitude` is clamped to keep the
 * curve (and its stroke) inside the box. Deterministic: same inputs, same string.
 */
export function wavePath(cycles: number, amplitude: number): string {
  const n = Math.max(1, Math.round(Number.isFinite(cycles) ? cycles : 1));
  const a = Math.min(MID - 1, Math.max(0, Number.isFinite(amplitude) ? amplitude : 0));
  const pts: string[] = [];
  for (let i = 0; i <= SEGMENTS; i++) {
    const x = (i / SEGMENTS) * WAVE_WIDTH;
    const y = MID - a * Math.sin((i / SEGMENTS) * n * 2 * Math.PI);
    pts.push(`${i === 0 ? 'M' : 'L'}${r2(x)} ${r2(y)}`);
  }
  return pts.join(' ');
}
