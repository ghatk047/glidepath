import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PostgresObjectStore } from '@glidepath/data-access';
import type { Db } from '@glidepath/data-access';
import { seedIds } from './ids';

/**
 * The latest parity result of a tenant (API-14). `pnpm parity:golden` compares the engine with the Python reference
 * (golden values and the parity replay) and writes `golden-report.json` and `replay-report.json`;
 * `migrate --parity <dir>` records their tallies as one object of the tenant, `ai/parity/latest.json`. The tenant's
 * own object store carries it, so row level security keeps it to the tenant's members with no table of its own;
 * `GET /api/ai/reconfig` reads it back as the tenant's `{passed, total}`. Nothing here decides pass or fail: the
 * counts are the harness's.
 */

export const PARITY_FORMAT = 'glidepath.parity/1';
/** Where the record lives: bucket `ai`, this key (a job's own objects are under `<job id>/`). */
export const PARITY_KEY = 'parity/latest.json';

export interface ParityTally {
  readonly passed: number;
  readonly total: number;
}

/**
 * The stored record. `passed` and `total` are the parity replay's (the 245 checks of `parity_report.json`: the
 * "parity 245/245" of the Airlines tile, docs/ux/03_screens.md); `golden` keeps the golden values' tally beside it.
 */
export interface ParityRecord extends ParityTally {
  readonly format: typeof PARITY_FORMAT;
  readonly tenant: string;
  readonly recordedAt: string;
  readonly golden: ParityTally;
  readonly replay: ParityTally;
}

export class ParityReportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ParityReportError';
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const count = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

/** `{ summary: { total, passed } }` of a harness report file. */
function tallyOf(dir: string, file: string): ParityTally {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(join(dir, file), 'utf8'));
  } catch {
    throw new ParityReportError(`parity: ${join(dir, file)} is missing or not JSON (run pnpm parity:golden first)`);
  }
  const summary = isRecord(raw) ? raw.summary : undefined;
  if (!isRecord(summary) || !count(summary.passed) || !count(summary.total) || summary.passed > summary.total)
    throw new ParityReportError(`parity: ${file} has no summary of passed and total counts`);
  return { passed: summary.passed, total: summary.total };
}

/** Reads the two report files of `pnpm parity:golden` from `dir`: the replay is the headline, the golden values ride along. */
export function readParityReports(dir: string, tenant: string, recordedAt: Date = new Date()): ParityRecord {
  const golden = tallyOf(dir, 'golden-report.json');
  const replay = tallyOf(dir, 'replay-report.json');
  return {
    format: PARITY_FORMAT,
    tenant,
    recordedAt: recordedAt.toISOString(),
    passed: replay.passed,
    total: replay.total,
    golden,
    replay,
  };
}

export interface RecordParityOptions {
  /** Folder holding `golden-report.json` and `replay-report.json`. */
  readonly dir: string;
  /** Slug of the tenant the reports were made for (the seed tenant: the reference files are its). */
  readonly tenant: string;
  readonly now?: Date;
  readonly log?: (message: string) => void;
}

/**
 * `migrate --parity <dir>`: stores the reports' totals as the tenant's latest parity, replacing the earlier record.
 * Run as the owner role after the tenant is seeded.
 */
export async function recordParity(db: Db, o: RecordParityOptions): Promise<ParityRecord> {
  const record = readParityReports(o.dir, o.tenant, o.now);
  const store = new PostgresObjectStore(db, seedIds.tenant(o.tenant), seedIds.seedActor());
  await store.put('ai', PARITY_KEY, new TextEncoder().encode(`${JSON.stringify(record, null, 2)}\n`), { contentType: 'application/json' });
  o.log?.(`parity: ${o.tenant} ${record.passed}/${record.total} recorded`);
  return record;
}
