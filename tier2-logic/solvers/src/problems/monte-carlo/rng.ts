/* eslint-disable no-magic-numbers -- published hash and PRNG constants (cyrb128, xoshiro128**), not business numbers */
/**
 * Seeded random streams for Monte Carlo (04 §4 "seed stored with the run"). One independent stream per
 * named purpose (an input cell, a correlation group): the stream is xoshiro128** seeded by the 128-bit
 * cyrb128 hash of `seed` and the name, so a draw depends only on the seed, the name and its index, never on
 * which other inputs are sampled or in what order.
 */

/** cyrb128: a 128-bit string hash (four 32-bit words), used only to seed the generator. */
function cyrb128(str: string): [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

const TWO_POW_26 = 67108864;
const TWO_POW_53 = 9007199254740992;
const WARM_UP = 8;

/** A uniform stream on the open interval (0, 1), 53-bit resolution. */
export class Stream {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(seed: number, name: string) {
    [this.a, this.b, this.c, this.d] = cyrb128(`${seed}\u0000${name}`);
    if ((this.a | this.b | this.c | this.d) === 0) this.a = 1;
    for (let i = 0; i < WARM_UP; i++) this.next32();
  }

  /** xoshiro128** step: one 32-bit unsigned integer. */
  next32(): number {
    const t = this.b << 9;
    let r = Math.imul(this.b, 5);
    r = Math.imul((r << 7) | (r >>> 25), 9);
    this.c ^= this.a;
    this.d ^= this.b;
    this.b ^= this.c;
    this.a ^= this.d;
    this.c ^= t;
    this.d = (this.d << 11) | (this.d >>> 21);
    return r >>> 0;
  }

  /** Uniform on (0, 1): 0 and 1 are never returned, so inverse CDFs stay finite. */
  uniform(): number {
    const hi = this.next32() >>> 5;
    const lo = this.next32() >>> 6;
    return (hi * TWO_POW_26 + lo + 0.5) / TWO_POW_53;
  }

  /** `n` uniforms. */
  uniforms(n: number): Float64Array {
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) out[i] = this.uniform();
    return out;
  }
}
