import type { RailItem } from '@glidepath/ui/shell';
import { MODULE_IDS, type ModuleId } from '../../app/modules';

/**
 * Rail entries and screen titles of the eight modules (IA §1, prototype `NAV`). UX copy only:
 * module ids come from the contract (`AppModule`), labels and titles are the approved wording.
 */
interface ModuleCopy {
  /** Rail label (under the icon). */
  label: string;
  /** Screen title in the top bar. */
  title: string;
  /** Stroke paths of the 24-unit icon (prototype `ICONS`). */
  icon: string;
}

export const MODULE_COPY: Readonly<Record<ModuleId, ModuleCopy>> = {
  cockpit: {
    label: 'Cockpit',
    title: 'Path to the bar',
    icon: '<path d="M4 16a8 8 0 1 1 16 0"/><path d="M12 16l4.5-5"/><circle cx="12" cy="16" r="1.2"/>',
  },
  baseline: {
    label: 'Baseline',
    title: 'Where the money is',
    icon: '<path d="M4 4h7v9H4zM13 4h7v5h-7zM13 11h7v9h-7zM4 15h7v5H4z"/>',
  },
  levers: {
    label: 'Levers',
    title: 'Lever studio',
    icon: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  },
  vps: {
    label: 'VPs',
    title: 'VP targets & ownership',
    icon: '<path d="M9 3h6v4H9zM3 16h6v4H3zM15 16h6v4h-6zM12 7v4M6 16v-5h12v5"/>',
  },
  path: {
    label: 'Path',
    title: 'Find a path',
    icon: '<path d="M5 19c3 0 3-7 7-7s4-7 7-7"/><circle cx="5" cy="19" r="1.6"/><circle cx="19" cy="5" r="1.6"/>',
  },
  market: {
    label: 'Market',
    title: 'Shareholder view',
    icon: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
  },
  excel: {
    label: 'Excel',
    title: 'Excel round trip',
    icon: '<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4M9 12h7M9 16h7"/>',
  },
  airlines: {
    label: 'Airlines',
    title: 'Airlines',
    icon: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3.2 3 3.2 15 0 18M12 3c-3.2 3-3.2 15 0 18"/>',
  },
};

/** Tool icons of the top bar (prototype `ICONS.search`, `ICONS.sun`). */
export const TOOL_ICONS = {
  search: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
} as const;

/** A 24-unit stroke icon drawn with `currentColor` (the rail and the buttons tint it). */
export function Icon({ paths }: { paths: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      dangerouslySetInnerHTML={{ __html: paths }}
    />
  );
}

/** Path of a module screen: `/:tenant/:scenario/:module`. */
export const modulePath = (tenant: string, scenario: string, module: ModuleId): string =>
  `/${encodeURIComponent(tenant)}/${encodeURIComponent(scenario)}/${module}`;

/** The rail's eight items, in site-map order. */
export function railItems(tenant: string, scenario: string): RailItem[] {
  return MODULE_IDS.map((id) => ({
    id,
    label: MODULE_COPY[id].label,
    icon: <Icon paths={MODULE_COPY[id].icon} />,
    href: modulePath(tenant, scenario, id),
  }));
}
