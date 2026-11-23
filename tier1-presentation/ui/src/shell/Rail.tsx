import type { MouseEvent, ReactNode } from 'react';
import { ShellStyles } from './ShellStyles';
import { TenantButton, type TenantStatus } from './TenantButton';

export interface RailItem {
  id: string;
  label: string;
  /** Icon element; drawn with `currentColor`, so the rail tints it (accent when current). */
  icon: ReactNode;
  /** Link target. Default `#<id>` (hash routing). */
  href?: string;
  /** Items with a different group get a divider between them (modules, then design pack). */
  group?: string;
}

export interface RailProps {
  items: readonly RailItem[];
  /** id of the current item: gets aria-current="page", the glass-2 tint and the accent icon. */
  current: string;
  /** IATA code for the tenant monogram on top. */
  tenantCode: string;
  tenantName?: string;
  tenantStatus?: TenantStatus;
  /** Tenant monogram pressed: web opens Airlines. */
  onTenant?: () => void;
  /** An item was activated. Call `event.preventDefault()` to route without following the href. */
  onSelect?: (id: string, event: MouseEvent<HTMLAnchorElement>) => void;
  /** Accessible name of the navigation landmark. */
  label?: string;
}

/**
 * Rail (#1): left column of 84 px with module icons and 10 px labels; under 760 px a bottom bar
 * that scrolls inside itself. Presentational: the current id and items arrive as props.
 */
export function Rail({
  items,
  current,
  tenantCode,
  tenantName,
  tenantStatus,
  onTenant,
  onSelect,
  label = 'Modules',
}: RailProps) {
  return (
    <ShellStyles>
      <nav className="gp-rail" aria-label={label}>
        <TenantButton
          code={tenantCode}
          name={tenantName}
          status={tenantStatus}
          onClick={onTenant}
        />
        {items.map((item, i) => (
          <RailEntry
            key={item.id}
            item={item}
            divider={i > 0 && item.group !== items[i - 1]!.group}
            current={item.id === current}
            onSelect={onSelect}
          />
        ))}
      </nav>
    </ShellStyles>
  );
}

function RailEntry({
  item,
  divider,
  current,
  onSelect,
}: {
  item: RailItem;
  divider: boolean;
  current: boolean;
  onSelect: RailProps['onSelect'];
}) {
  return (
    <>
      {divider && <div className="gp-rail-sep" aria-hidden="true" />}
      <a
        className="gp-rail-item"
        href={item.href ?? `#${item.id}`}
        aria-current={current ? 'page' : undefined}
        data-item={item.id}
        onClick={(e) => onSelect?.(item.id, e)}
      >
        <span className="gp-rail-icon" aria-hidden="true">
          {item.icon}
        </span>
        <span>{item.label}</span>
      </a>
    </>
  );
}
