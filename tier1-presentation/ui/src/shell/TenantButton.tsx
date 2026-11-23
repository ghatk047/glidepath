import type { MouseEventHandler } from 'react';
import { ShellStyles } from './ShellStyles';

export type TenantStatus = 'ready' | 'switching' | 'unavailable';

export interface TenantButtonProps {
  /** IATA code of the tenant, shown as a neutral monogram. Never a logo (rule 9). */
  code: string;
  /** Tenant status pushed by tier 2: 'switching' dims the button, 'unavailable' adds a warn dot. */
  status?: TenantStatus;
  /** Airline name for the accessible name only. */
  name?: string;
  onClick?: MouseEventHandler<HTMLButtonElement>;
}

const MONOGRAM_MAX = 3;

/** Tenant button (#6): the IATA code in a neutral monogram. It opens Airlines. */
export function TenantButton({ code, status = 'ready', name, onClick }: TenantButtonProps) {
  const mono = code.trim().toUpperCase().slice(0, MONOGRAM_MAX);
  const state = status === 'ready' ? '' : `, ${status}`;
  return (
    <ShellStyles>
      <button
        type="button"
        className="gp-tenant-btn"
        data-status={status}
        aria-busy={status === 'switching' || undefined}
        aria-label={`${name ?? mono}${state}, switch airline`}
        title={`${name ?? mono} · switch airline`}
        onClick={onClick}
      >
        <span className="gp-tenant-code" data-monogram="">
          {mono}
        </span>
      </button>
    </ShellStyles>
  );
}
