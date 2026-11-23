import { DimKey, type ReconfigJob, type Tenant, type TenantParity } from '@glidepath/api-contract';
import { GlassPanel, GridCell } from '@glidepath/ui/glass';
import { useMembers, useScenarios } from '../../data';
import { draftTile, tileOf, type TileModel } from './model';
import { COPY, cyLabel } from './copy';

export interface TilesProps {
  tenants: readonly Tenant[];
  current: string;
  job: ReconfigJob | null;
  /** Latest parity tier 2 recorded per tenant; a tenant without one has no entry. */
  parity: readonly TenantParity[];
  onSetUp(prompt: string | null, tenant: string | null): void;
}

/** "415 lines · 4 VPs · 5 scenarios · parity 245/245": the counts and parity tier 2 sent for the tenant. */
function LiveFacts({ tenant, parity }: { tenant: Tenant; parity: TenantParity | undefined }) {
  const members = useMembers(tenant.slug);
  const scenarios = useScenarios(tenant.slug);
  const dims = members.data?.dimensions;
  const lines = dims?.[DimKey.parse('line')]?.filter((m) => m.active).length;
  const vps = dims?.[DimKey.parse('vp')]?.filter((m) => m.active).length;
  const count = scenarios.data?.scenarios.filter((s) => !s.archived).length;
  const part = (n: number | undefined, one: string, many: string) =>
    n === undefined ? null : `${n} ${n === 1 ? one : many}`;
  const parts = [
    part(lines, 'line', 'lines'),
    part(vps, 'VP', 'VPs'),
    part(count, 'scenario', 'scenarios'),
    parity ? `${COPY.parity} ${parity.passed}/${parity.total}` : null,
  ];
  return (
    <p className="gp-airlines-facts" data-testid={`facts-${tenant.slug}`}>
      {parts.filter(Boolean).join(' · ')}
    </p>
  );
}

function Tile({
  tile,
  tenant,
  current,
  job,
  parity,
  onSetUp,
}: {
  tile: TileModel;
  tenant: Tenant | undefined;
  current: boolean;
  job: ReconfigJob | null;
  parity: TenantParity | undefined;
  onSetUp: TilesProps['onSetUp'];
}) {
  const onboarding = tile.kind === 'draft' ? (job?.onboarding ?? null) : null;
  const tag =
    tile.kind === 'live'
      ? COPY.live
      : onboarding
        ? `${onboarding.done} of ${onboarding.total}`
        : tile.kind === 'draft'
          ? COPY.draft
          : COPY.newTag;
  const status = tile.kind === 'live' ? 'Live' : tile.kind === 'draft' ? 'Draft' : COPY.notStarted;
  return (
    <GridCell span={3} className="gp-airlines-cell">
      <GlassPanel
        level={tile.kind === 'live' ? 2 : 1}
        as="article"
        padding="panel"
        className="gp-airlines-tile"
        data-tile={tile.slug ?? tile.key}
        data-kind={tile.kind}
        data-current={current || undefined}
        aria-label={`${tile.name}, ${status}`}
      >
        <div className="gp-airlines-top">
          <span className="gp-airlines-mono" data-monogram="">
            {tile.monogram}
          </span>
          <span className="gp-chip gp-airlines-tag" data-kind={tile.kind}>
            {tag}
          </span>
        </div>
        <h3 className="gp-airlines-name">{tile.name}</h3>
        <p className="gp-airlines-sub">
          {status}
          {tile.sub ? ` · ${tile.sub}` : ''}
        </p>
        {tile.kind === 'live' && tenant ? <LiveFacts tenant={tenant} parity={parity} /> : null}
        {onboarding && onboarding.total > 0 ? (
          <progress
            className="gp-airlines-progress"
            aria-label={`${tile.name} onboarding`}
            max={onboarding.total}
            value={onboarding.done}
          />
        ) : null}
        {tile.kind !== 'live' ? (
          <button
            type="button"
            className="gp-airlines-action"
            onClick={() => onSetUp(tile.prompt, tile.slug)}
          >
            {tile.kind === 'draft' ? COPY.continueSetup : COPY.setUpWithAi}
          </button>
        ) : null}
      </GlassPanel>
    </GridCell>
  );
}

/** Tenant tiles: the tenants tier 2 lists, an AI draft not yet a tenant, and "Add an airline". */
export function Tiles({ tenants, current, job, parity, onSetUp }: TilesProps) {
  const first = tenants[0];
  const cy = first ? cyLabel(first.targetYear) : '';
  const tiles = tenants.map((t) => ({
    tile: tileOf(t, job, cyLabel(t.targetYear) || cy),
    tenant: t,
  }));
  const extra =
    job && !tenants.some((t) => t.slug === job.plan?.tenant.slug) ? draftTile(job) : null;
  return (
    <>
      {tiles.map(({ tile, tenant }) => (
        <Tile
          key={tile.key}
          tile={tile}
          tenant={tenant}
          current={tile.slug === current}
          job={job}
          parity={parity.find((p) => p.tenant === tile.slug)}
          onSetUp={onSetUp}
        />
      ))}
      {extra ? (
        <Tile
          key={extra.key}
          tile={extra}
          tenant={undefined}
          current={false}
          job={job}
          parity={undefined}
          onSetUp={onSetUp}
        />
      ) : null}
      <GridCell span={3} className="gp-airlines-cell">
        <GlassPanel
          as="article"
          className="gp-airlines-tile gp-airlines-add"
          data-kind="add"
          aria-label={COPY.addAirline}
        >
          <button
            type="button"
            className="gp-airlines-plus"
            aria-label={COPY.addAirline}
            onClick={() => onSetUp(null, null)}
          >
            <span aria-hidden="true">+</span>
          </button>
          <h3 className="gp-airlines-name">{COPY.addAirline}</h3>
          <p className="gp-airlines-sub">{COPY.addBlurb}</p>
        </GlassPanel>
      </GridCell>
    </>
  );
}
