import { z } from 'zod';
import {
  ChangesetId,
  ClientRequestId,
  IsoDate,
  MarketSnapshotId,
  MemberKey,
  OneLine,
  VarKey,
} from './ids';
import { PreviewChange } from './ws';

/**
 * `POST /api/t/:tenant/market/refresh` (CON-03): a manual market snapshot (share price, Brent,
 * crack, jet: `corp.price_now`, `corp.brent[iyear]` …) written as one changeset
 * (origin `market_refresh`) on the tenant defaults, and a `market_snapshot` row.
 *
 * `feed`: tier 2 fetches the latest values from its configured source. `manual`: the user typed
 * them; `values` are input cells (var, member, value) exactly like a preview change.
 */
export const MarketRefreshRequest = z.discriminatedUnion('source', [
  z.object({ source: z.literal('feed'), clientRequestId: ClientRequestId.optional() }),
  z.object({
    source: z.literal('manual'),
    asOf: IsoDate,
    values: z.array(PreviewChange).min(1),
    clientRequestId: ClientRequestId.optional(),
  }),
]);
export type MarketRefreshRequest = z.infer<typeof MarketRefreshRequest>;

/** One input cell of the snapshot: the tenant default before and after (equal = unchanged). */
export const MarketValue = z.object({
  var: VarKey,
  member: MemberKey,
  from: z.number().nullable(),
  to: z.number(),
});
export type MarketValue = z.infer<typeof MarketValue>;

/** The snapshot and its changeset; `changesetId` is `null` when no value changed. */
export const MarketRefreshResult = z.object({
  snapshotId: MarketSnapshotId,
  asOf: IsoDate,
  /** Who supplied the values, as a label (feed name, or manual entry by a user). */
  source: OneLine,
  values: z.array(MarketValue),
  changesetId: ChangesetId.nullable(),
});
export type MarketRefreshResult = z.infer<typeof MarketRefreshResult>;
