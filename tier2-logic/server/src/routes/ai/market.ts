import { randomUUID } from 'node:crypto';
import { MarketRefreshRequest, MarketRefreshResult, TenantParams, problemTypes } from '@glidepath/api-contract';
import { schema, sql } from '@glidepath/data-access';
import { applyChangeset } from '@glidepath/domain';
import type { ChangesetDraft, Change } from '@glidepath/domain';
import type { Hono } from 'hono';
import { ApiError } from '../../app/problem';
import type { AppEnv } from '../../app/tenant';
import { checked } from '../read/mappers';
import type { SpecBundleSource } from '../read/spec-source';
import { guarded } from '../write/errors';
import { LruModelCache } from '../write/model-cache';
import { authorOf, writeContext } from '../write/support';

/**
 * The market inputs a snapshot may set (spec variable ids, verbatim): share price, Brent, jet crack spread and the
 * direct jet price. Anything else is not market data and is refused; the values and their bounds live in the registry.
 */
export const MARKET_VARIABLES: ReadonlySet<string> = new Set(['corp.price_now', 'corp.brent', 'corp.crack', 'corp.jet_direct']);

export interface MarketRoutesDeps {
  /** The spec bundle of the pinned model version: registry bounds, rules and the engine's formulas. */
  specBundle: SpecBundleSource;
}

const oneLine = (s: string): string => s.replace(/\s+/g, ' ').trim();
const validation = (detail: string): ApiError => new ApiError({ status: 422, title: 'Validation failed', detail, type: problemTypes.validation });

interface Payload {
  source: 'manual';
  enteredBy: string;
  values: { var: string; member: string; from: number | null; to: number }[];
}

/**
 * `POST /api/t/:tenant/market/refresh` (04 section 3, 09 M5): a manual market snapshot, no live feed. The typed values
 * are written as one changeset on the tenant defaults (origin `market_refresh`, through `applyChangeset`, so the
 * registry bounds and input rules apply) plus a `market_snapshot` row that records them and points at that changeset.
 * A snapshot that changes nothing stores the row and no changeset (`changesetId: null`). `source: 'feed'` is 501: no
 * feed is configured for the demo. A replayed `clientRequestId` answers the snapshot it already made.
 */
export function registerMarketRoutes(app: Hono<AppEnv>, deps: MarketRoutesDeps): void {
  const cache = new LruModelCache();

  app.post('/api/t/:tenant/market/refresh', (c) =>
    guarded(c, async () => {
      TenantParams.parse(c.req.param());
      const req = MarketRefreshRequest.parse(await c.req.json());
      if (req.source === 'feed') {
        throw new ApiError({
          status: 501,
          title: 'Not implemented',
          detail: 'No live market feed is configured. Send source "manual" with the values to set.',
        });
      }
      const seen = new Set<string>();
      for (const v of req.values) {
        if (!MARKET_VARIABLES.has(v.var)) throw validation(`${v.var} is not a market input. Use ${[...MARKET_VARIABLES].join(', ')}.`);
        const cell = `${v.var}[${v.member}]`;
        if (seen.has(cell)) throw validation(`${cell} appears twice. Send each cell once.`);
        seen.add(cell);
      }

      const t = c.get('tenant');
      const ctx = await writeContext(c, { specBundle: deps.specBundle, cache });
      const { current, base } = await ctx.store.transaction(async (tx) => {
        const state = await tx.loadInputs(null);
        const byCell = new Map(state.defaults.map((r) => [`${r.var_key}[${r.member_key}]`, r.value]));
        return { current: byCell, base: (await tx.changesSince(null, 0)).length };
      });
      const values = req.values.map((v) => ({ var: v.var as string, member: v.member as string, from: current.get(`${v.var}[${v.member}]`) ?? null, to: v.value }));
      const changed = values.filter((v) => v.from !== v.to);

      let changesetId: string | null = null;
      // A request that was already applied answers the snapshot it made (the values now equal the typed ones).
      if (req.clientRequestId !== undefined) {
        const prior = await ctx.store.transaction((tx) => tx.findChangesetByClientRequest(t.userId, req.clientRequestId!));
        if (prior !== null) {
          const [row] = await t.tx
            .select({ id: schema.market_snapshot.id, as_of: schema.market_snapshot.as_of, payload: schema.market_snapshot.payload })
            .from(schema.market_snapshot)
            .where(sql`${schema.market_snapshot.applied_changeset_id} = ${prior.id}`);
          if (row !== undefined) {
            const p = row.payload as Payload;
            return c.json(
              checked('market refresh result', MarketRefreshResult, {
                snapshotId: row.id,
                asOf: row.as_of,
                source: oneLine(`Manual entry by ${(await authorOf(t.tx, p.enteredBy))?.name ?? 'a tenant member'}`),
                values: p.values,
                changesetId: prior.id,
              }),
              201,
            );
          }
        }
      }
      if (changed.length > 0) {
        const draft: ChangesetDraft = {
          origin: 'market_refresh',
          scenario_id: null,
          base_scenario_version: base,
          changes: changed.map((v): Change => ({
            target: 'variable',
            key: v.var,
            member_key: v.member,
            op: 'set',
            new_value: v.to,
            note: `Market snapshot as of ${req.asOf}`,
          })) as Change[],
        };
        const applied = await applyChangeset(ctx.store, draft, {
          actor: t.userId,
          bundle: ctx.bundle,
          recompute: ctx.recompute,
          ...(req.clientRequestId === undefined ? {} : { clientRequestId: req.clientRequestId }),
        });
        changesetId = applied.changesetId;
      }

      const author = await authorOf(t.tx, t.userId);
      const label = oneLine(`Manual entry by ${author?.name ?? 'a tenant member'}`);
      const sourceId = randomUUID();
      const snapshotId = randomUUID();
      await t.tx.insert(schema.source).values({
        tenant_id: t.tenantId,
        id: sourceId,
        code: `market-${req.asOf}`,
        kind: 'market',
        title: `Market snapshot ${req.asOf} (${label})`,
        url: null,
        as_of: req.asOf,
      });
      const payload: Payload = { source: 'manual', enteredBy: t.userId, values };
      await t.tx.insert(schema.market_snapshot).values({
        tenant_id: t.tenantId,
        id: snapshotId,
        as_of: req.asOf,
        payload,
        source_id: sourceId,
        applied_changeset_id: changesetId,
      });

      return c.json(
        checked('market refresh result', MarketRefreshResult, { snapshotId, asOf: req.asOf, source: label, values, changesetId }),
        201,
      );
    }),
  );
}
