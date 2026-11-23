import { useId, useMemo, useState } from 'react';
import type { VariableDef } from '@glidepath/api-contract';
import { GlassPanel, Skeleton } from '@glidepath/ui/glass';
import { Stepper } from '@glidepath/ui/inputs/controls';
import { useBindContext, useVariable } from '../../bind';
import { useBundle, useMembers } from '../../data';
import { COPY, CORPORATE_GROUP, DRIVER_GROUPS, DRIVER_GROUP_OF, type DriverGroupKey } from './copy';
import { driverFormat } from './format';
import { activeMembers } from './members';

const fail = () => undefined; // the commit queue (WEB-05) surfaces errors in the shell

interface Member {
  key: string;
  label: string;
}

/** One cell of a driver: a stepper on the scenario's value; nothing renders until tier 2 has it. */
function DriverCell({ def, member, label }: { def: VariableDef; member: string; label: string }) {
  const v = useVariable(def.id, member);
  if (typeof v.value !== 'number') return null;
  const show = driverFormat(def.unit, def.step);
  return (
    <div className="gp-market-cell" data-member={member} data-stale={v.stale || undefined}>
      {label && <span className="gp-market-cell-member">{label}</span>}
      {def.step === null ? (
        <span className="gp-market-cell-static" data-value={v.value}>
          {show(v.value)}
        </span>
      ) : (
        <Stepper
          variableId={def.id}
          label={label ? `${def.label} · ${label}` : def.label}
          value={v.value}
          step={def.step}
          {...(def.min !== null ? { min: def.min } : {})}
          {...(def.max !== null ? { max: def.max } : {})}
          format={show}
          onChange={(next) => {
            v.preview(next);
            void v.commit(next).catch(fail);
          }}
        />
      )}
    </div>
  );
}

/** The cells (members) a variable has, from its dimensions in the members payload. */
function cellsOf(
  dims: readonly string[],
  all: Readonly<Record<string, readonly Member[]>>,
): { member: string; label: string }[] {
  let acc: { member: string; label: string }[] = [{ member: '', label: '' }];
  for (const d of dims) {
    const ms = all[d] ?? [];
    acc = acc.flatMap((a) =>
      ms.map((m) => ({
        member: a.member ? `${a.member},${m.key}` : m.key,
        label: a.label ? `${a.label} · ${m.label}` : m.label,
      })),
    );
  }
  return acc;
}

function Driver({
  def,
  dimensions,
}: {
  def: VariableDef;
  dimensions: Readonly<Record<string, readonly Member[]>>;
}) {
  const cells = useMemo(() => cellsOf(def.dims, dimensions), [def.dims, dimensions]);
  return (
    <li className="gp-market-driver" data-variable-id={def.id}>
      <div className="gp-market-driver-name">
        <span>{def.label}</span>
        <code>{def.id}</code>
      </div>
      <div className="gp-market-driver-cells">
        {cells.map((c) => (
          <DriverCell key={c.member} def={def} member={c.member} label={c.label} />
        ))}
      </div>
    </li>
  );
}

const OTHER = { key: 'other', label: 'Other' } as const;

/**
 * "More drivers": every variable of the registry's Corporate drivers group (all 91 for AA),
 * under macro, fuel, demand, labor, fleet, airports, financing, tax and valuation. The list is
 * the bundle's; the grouping is `DRIVER_GROUP_OF`. Cells mount only while the list is open.
 */
export function MoreDrivers() {
  const { tenant } = useBindContext();
  const bundle = useBundle(tenant);
  const members = useMembers(tenant);
  const [open, setOpen] = useState(false);
  const panelId = useId();

  const drivers = useMemo(
    () => (bundle.data?.variables ?? []).filter((v) => v.group === CORPORATE_GROUP),
    [bundle.data],
  );
  const dimensions = useMemo(() => {
    const out: Record<string, Member[]> = {};
    for (const dim of Object.keys(members.data?.dimensions ?? {})) {
      out[dim] = activeMembers(members.data, dim).map((m) => ({
        key: m.key as string,
        label: m.label,
      }));
    }
    return out;
  }, [members.data]);

  const sections = useMemo(() => {
    const by = new Map<string, VariableDef[]>();
    for (const d of drivers) {
      const key: string = DRIVER_GROUP_OF[d.id] ?? OTHER.key;
      by.set(key, [...(by.get(key) ?? []), d]);
    }
    const order: readonly { key: string; label: string }[] = [...DRIVER_GROUPS, OTHER];
    return order.filter((g) => by.has(g.key)).map((g) => ({ ...g, defs: by.get(g.key)! }));
  }, [drivers]);

  const count = bundle.data ? drivers.length : null;
  return (
    <GlassPanel
      span={12}
      level={1}
      data-testid="market-more"
      header={{
        label: COPY.moreDrivers,
        status: (
          <button
            type="button"
            className="gp-market-more-toggle"
            aria-expanded={open}
            aria-controls={panelId}
            aria-label={COPY.moreDriversName(count)}
            onClick={() => setOpen((o) => !o)}
          >
            <span>{count === null ? COPY.moreDrivers : `${COPY.moreDrivers} · ${count}`}</span>
          </button>
        ),
      }}
      loading={!bundle.data}
    >
      <div id={panelId} hidden={!open}>
        {open &&
          sections.map((s) => (
            <section
              key={s.key}
              className="gp-market-group-section"
              data-group={s.key as DriverGroupKey}
              aria-label={s.label}
            >
              <h3 className="gp-market-group-title">
                {s.label} <span>{s.defs.length}</span>
              </h3>
              <ul className="gp-market-drivers">
                {s.defs.map((d) => (
                  <Driver key={d.id} def={d} dimensions={dimensions} />
                ))}
              </ul>
            </section>
          ))}
        {!bundle.data && <Skeleton size="text" width="100%" />}
      </div>
    </GlassPanel>
  );
}
