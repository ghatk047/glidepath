import { cssVar, tokenValue } from '../tokens';
import { cubicBezier, parseCubicBezier } from './easing';
import { prefersReducedMotion } from './reduced';
import { motionMs, type DurationToken } from './tokens';

/**
 * Number roll. Interpolates the DISPLAY only: `set(target)` takes the value tier 2 pushed and
 * animates what is shown from the current display to it. It never computes a result.
 * Framework-free (a React wrapper can call `set` from an effect).
 */

const FRAME_MS = 16;

export interface FrameInfo {
  /** Reserved width in `ch` (widest of old/new text) so the box never changes size mid-roll. */
  minWidthCh: number;
}

export interface NumberRollOptions {
  /** Display formatter, e.g. `fmt.money` from the format module. */
  format: (value: number) => string;
  /** Starting value; null/undefined shows nothing until the first set(). */
  initial?: number | null;
  onFrame: (text: string, info: FrameInfo) => void;
  /** Duration token: `roll` (520 ms, default) or `value` (420 ms). */
  durationToken?: Extract<DurationToken, 'roll' | 'value'>;
  /** Checked on every set(); defaults to the prefers-reduced-motion media query. */
  reducedMotion?: () => boolean;
  now?: () => number;
  schedule?: (cb: () => void) => unknown;
  cancel?: (handle: unknown) => void;
}

export class NumberRoll {
  private readonly o: NumberRollOptions;
  private readonly ease = cubicBezier(...parseCubicBezier(tokenValue['motion.ease']));
  private readonly durationMs: number;
  private shown: number | null;
  private target: number | null;
  private text = '';
  private reservedCh = 0;
  private handle: unknown = undefined;
  private active = false;
  private from = 0;
  private startedAt = 0;

  constructor(options: NumberRollOptions) {
    this.o = options;
    this.durationMs = motionMs(options.durationToken ?? 'roll');
    this.shown = options.initial ?? null;
    this.target = this.shown;
    if (this.shown !== null) {
      this.text = options.format(this.shown);
      this.reservedCh = this.text.length;
      options.onFrame(this.text, { minWidthCh: this.reservedCh });
    }
  }

  /** The value on screen right now (mid-roll this is an in-between value). */
  get displayed(): number | null {
    return this.shown;
  }
  /** The value last pushed by tier 2. */
  get value(): number | null {
    return this.target;
  }
  get rolling(): boolean {
    return this.active;
  }

  set(next: number): void {
    const reduced = (this.o.reducedMotion ?? prefersReducedMotion)();
    const from = this.shown;
    const wasRolling = this.active;
    this.stop();
    this.target = next;
    if (reduced || from === null || from === next) {
      this.show(next, 0);
      return;
    }
    // Reserve the widest text of old/new (and of an interrupted roll) for the whole transition.
    const base = wasRolling ? this.reservedCh : this.text.length;
    this.reservedCh = Math.max(base, this.text.length, this.o.format(next).length);
    this.from = from;
    this.startedAt = (this.o.now ?? Date.now)();
    this.active = true;
    this.queue();
  }

  destroy(): void {
    this.stop();
  }

  private show(value: number, widthCh: number): void {
    this.shown = value;
    this.text = this.o.format(value);
    this.reservedCh = Math.max(widthCh, this.text.length);
    this.o.onFrame(this.text, { minWidthCh: this.reservedCh });
  }

  private queue(): void {
    const schedule =
      this.o.schedule ??
      ((cb: () => void) => {
        const raf = (globalThis as { requestAnimationFrame?: (cb: () => void) => number })
          .requestAnimationFrame;
        return raf ? raf(cb) : setTimeout(cb, FRAME_MS);
      });
    this.handle = schedule(() => this.tick());
  }

  private stop(): void {
    if (this.handle !== undefined) {
      const cancel =
        this.o.cancel ??
        ((h: unknown) => {
          const caf = (globalThis as { cancelAnimationFrame?: (h: number) => void })
            .cancelAnimationFrame;
          if ((globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame && caf) {
            caf(h as number);
          } else clearTimeout(h as ReturnType<typeof setTimeout>);
        });
      cancel(this.handle);
      this.handle = undefined;
    }
    this.active = false;
  }

  private tick(): void {
    this.handle = undefined;
    if (!this.active || this.target === null) return;
    const t = Math.min(1, ((this.o.now ?? Date.now)() - this.startedAt) / this.durationMs);
    if (t >= 1) {
      this.active = false;
      this.show(this.target, 0); // roll over: the box is exactly the final text
      return;
    }
    const v = this.from + (this.target - this.from) * this.ease(t);
    this.shown = v;
    this.text = this.o.format(v);
    this.o.onFrame(this.text, { minWidthCh: this.reservedCh });
    this.queue();
  }
}

/** Minimal DOM surface so this works on any element (and in tests without a DOM). */
export interface RollElement {
  textContent: string | null;
  style: { setProperty(name: string, value: string): void };
}

/** Roll the text of an element: tabular numerals (token) and a reserved min-width in ch. */
export function bindNumberRoll(
  el: RollElement,
  options: Omit<NumberRollOptions, 'onFrame'>,
): NumberRoll {
  el.style.setProperty('font-variant-numeric', cssVar['type.numerals']);
  return new NumberRoll({
    ...options,
    onFrame: (text, { minWidthCh }) => {
      el.textContent = text;
      el.style.setProperty('min-width', `${minWidthCh}ch`);
    },
  });
}
