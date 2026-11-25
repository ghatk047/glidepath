import { MAX_OBJECT_BYTES } from '@glidepath/data-access';

/** Operational default of `IMPORT_MAX_BYTES` (ADR-022): a workbook of the AA model is well under 1 MB. */
export const DEFAULT_IMPORT_MAX_BYTES = 10 * 1024 * 1024;

/**
 * The upload cap, from `IMPORT_MAX_BYTES` (a positive integer, bytes). Never above the object store's own cap
 * (ADR-025). A value that is not a positive integer is a start-up error, not a silent default.
 */
export function importMaxBytes(env: Readonly<Record<string, string | undefined>> = process.env): number {
  const raw = env.IMPORT_MAX_BYTES?.trim();
  if (raw === undefined || raw === '') return Math.min(DEFAULT_IMPORT_MAX_BYTES, MAX_OBJECT_BYTES);
  if (!/^\d+$/.test(raw) || Number(raw) < 1) {
    throw new Error(`IMPORT_MAX_BYTES must be a positive integer (bytes), got '${raw}'`);
  }
  return Math.min(Number(raw), MAX_OBJECT_BYTES);
}
