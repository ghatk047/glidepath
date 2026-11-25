import { useEffect, type CSSProperties } from 'react';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { toCellKey } from '@glidepath/api-contract';
import { fmt } from '@glidepath/ui/format';
import { GlassPanel, Skeleton } from '@glidepath/ui/glass';
import { useBindContext, useNode, Value } from '../../bind';
import { useMembers } from '../../data';
import { COPY, YEAR, YEAR_SHORT } from './copy';
import { epsFmt } from './format';
import { activeMembers } from './members';
import { epsAxis, topPct } from './scale';

const EPS = 'pl.eps';

/** Pushed values of one id over several members, in the order given (undefined = not yet). */
function useCells(id: string, members: readonly string[]): (number | null | undefined)[] {
  const { session } = useBindContext();
  const cells = members.map((m) => toCellKey(id, m));
  const key = cells.join('|');
  useEffect(() => session.subscribe(cells), [session, key]);
  return useStore(
    session.store,
    useShallow((s) => cells.map((c) => s.cells.get(c)?.value)),
  );
}

/**
 * Adjusted EPS (4 bars): `pl.eps` for each active member of the `year` dimension in tier 2's
 * order (FY25A, FY26E, FY27E base, FY27E + IT); the IT member (`attrs.it`) is the highlighted bar.
 */
export function EpsPanel() {
  const { tenant } = useBindContext();
  const members = useMembers(tenant);
  const years = activeMembers(members.data, 'year');
  const values = useCells(
    EPS,
    years.map((y) => y.key as string),
  );
  const axis = epsAxis(values);
  const loading = years.length === 0 || values.every((v) => v === undefined);

  return (
    <GlassPanel
      span={4}
      level={1}
      data-testid="market-eps"
      header={{
        label: COPY.epsLabel,
        status: <span className="gp-market-unit">{COPY.epsUnit}</span>,
      }}
      loading={loading}
    >
      <div className="gp-market-eps" role="group" aria-label={COPY.epsLabel}>
        <ul className="gp-market-eps-grid" aria-hidden="true">
          {axis.ticks.map((t) => (
            <li key={t} style={{ '--top': `${topPct(t, axis)}%` } as CSSProperties}>
              <span>{fmt.eps(t, { digits: 1 })}</span>
            </li>
          ))}
        </ul>
        <ol className="gp-market-eps-bars">
          {years.map((y, i) => {
            const v = values[i];
            const key = y.key as string;
            const num = typeof v === 'number';
            const top = num ? topPct(Math.max(v, 0), axis) : 0;
            const to = num ? topPct(Math.min(v, 0), axis) : 0;
            return (
              <li
                key={key}
                data-year={key}
                data-it={y.attrs?.['it'] === 1 || undefined}
                data-negative={(num && v < 0) || undefined}
                style={{ '--bar-top': top, '--bar-end': to } as CSSProperties}
              >
                {num ? (
                  <>
                    <span className="gp-market-eps-bar" />
                    <span className="gp-market-eps-value" data-value={v}>
                      {epsFmt(v)}
                    </span>
                  </>
                ) : (
                  <Skeleton size="text" width="60%" />
                )}
                <span className="gp-market-eps-cat">{YEAR_SHORT[key] ?? y.label}</span>
              </li>
            );
          })}
        </ol>
      </div>
    </GlassPanel>
  );
}

/** Share price: `val.px` without and with the program, and `br.fuel_equiv_cents`. */
export function SharePricePanel() {
  const price = useNode('val.px', YEAR.withIt);
  const cents = useNode('br.fuel_equiv_cents');
  return (
    <GlassPanel
      span={3}
      level={2}
      data-testid="market-price"
      header={{ label: COPY.priceLabel }}
      loading={price.value === undefined}
    >
      <dl className="gp-market-price">
        <div>
          <dt>{COPY.withoutIt}</dt>
          <dd>
            <Value node="val.px" member={YEAR.base} format={(v) => epsFmt(v)} />
          </dd>
        </div>
        <div data-with-it="">
          <dt>{COPY.withIt}</dt>
          <dd>
            <Value node="val.px" member={YEAR.withIt} format={(v) => epsFmt(v)} />
          </dd>
        </div>
      </dl>
      <p className="gp-market-fuel">
        {COPY.worth}{' '}
        <strong data-node="br.fuel_equiv_cents" data-value={cents.value ?? undefined}>
          {fmt.cents(typeof cents.value === 'number' ? cents.value : null)}
        </strong>{' '}
        {COPY.fuelTail}
      </p>
    </GlassPanel>
  );
}
