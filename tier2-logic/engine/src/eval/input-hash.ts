/**
 * `inputHash(values, overrides)`: the calc_run cache key (docs/spec/01 §5). SHA-256 over the model
 * digest and every cell sorted by key, each value as its float64 bit pattern, so map order does not
 * matter while a one-ulp change, or 0 → −0, does (PORTING.md §4).
 */
import { sha256Hex, type ModelBundle, type TenantMembers } from '@glidepath/spec';
import type { CellKey } from '../types';

const HASH_DOMAIN = 'glidepath.inputHash.v1';
const MODEL_DOMAIN = 'glidepath.model.v1';
const HEX = 16;
/** Hex digits of one uint32. */
const HEX_PER_WORD = 8;

/**
 * Digest of what a compiled model computes: the bundle and the tenant members in order (member order
 * is evaluation order, S06, which `membersHash` deliberately ignores).
 */
export function modelDigest(bundle: ModelBundle, members: TenantMembers): string {
  return sha256Hex(
    `${MODEL_DOMAIN}\n${JSON.stringify([
      bundle.specVersion,
      bundle.modelId,
      bundle.variables,
      bundle.nodes,
      bundle.dimensions,
      members,
    ])}`,
  );
}

const bitsView = new DataView(new ArrayBuffer(Float64Array.BYTES_PER_ELEMENT));

/** The 16 hex digits of a float64's bit pattern (big-endian). */
export function float64Bits(x: number): string {
  bitsView.setFloat64(0, x);
  const hi = bitsView.getUint32(0).toString(HEX).padStart(HEX_PER_WORD, '0');
  const lo = bitsView
    .getUint32(Uint32Array.BYTES_PER_ELEMENT)
    .toString(HEX)
    .padStart(HEX_PER_WORD, '0');
  return hi + lo;
}

function section(name: string, cells: ReadonlyMap<CellKey, number>): string {
  const keys = [...cells.keys()].sort();
  let out = `${name} ${keys.length}\n`;
  for (const k of keys) out += `${JSON.stringify(k)} ${float64Bits(cells.get(k)!)}\n`;
  return out;
}

/** SHA-256 (lowercase hex) of the model digest, the values and the overrides, each sorted by key. */
export function inputHash(
  digest: string,
  values: ReadonlyMap<CellKey, number>,
  overrides: ReadonlyMap<CellKey, number>,
): string {
  return sha256Hex(
    `${HASH_DOMAIN}\n${digest}\n${section('values', values)}${section('overrides', overrides)}`,
  );
}
