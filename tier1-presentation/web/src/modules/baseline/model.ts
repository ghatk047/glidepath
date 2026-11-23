import { useMemo } from 'react';
import { useRouter } from '@tanstack/react-router';
import type { BaselineGroupBy, Member, TenantSlug } from '@glidepath/api-contract';
import { useMembers } from '../../data';
import { useViewStore } from '../../app/view-store';

/** Group-by options of the header segmented control (screens.md Baseline): the view's `by`. */
export const GROUP_BY_OPTIONS = [
  { id: 'pool', label: 'Cost pool' },
  { id: 'domain', label: 'Domain' },
  { id: 'vp', label: 'VP' },
] as const satisfies readonly { id: BaselineGroupBy; label: string }[];

/** Eyebrow noun of the group detail per grouping. */
export const GROUP_NOUN: Record<BaselineGroupBy, string> = {
  pool: 'Pool',
  domain: 'Domain',
  vp: 'VP',
};

/** Addressability categories of the treemap colours (`addr_tag` members, in tenant order). */
export interface AddrCategory {
  key: string;
  label: string;
}

/** Line display fields, read from the tenant's members (`GET /members`), never computed. */
export interface LineInfo {
  key: string;
  name: string;
  vendor: string;
  domain: string;
  addr: string;
  confidence: string;
}

const text = (v: unknown): string => (typeof v === 'string' ? v : '');

export interface BaselineMembers {
  lines: ReadonlyMap<string, LineInfo>;
  addrCategories: readonly AddrCategory[];
  addrLabel: (key: string) => string;
  /** Domain label by member key. */
  domainLabel: (key: string) => string;
  loading: boolean;
}

/** Labels and line attributes for the Baseline screen. */
export function useBaselineMembers(tenant: TenantSlug): BaselineMembers {
  const members = useMembers(tenant);
  const dims = members.data?.dimensions as Record<string, readonly Member[]> | undefined;
  return useMemo(() => {
    const labelOf = (list: readonly Member[] | undefined) =>
      new Map((list ?? []).map((m) => [m.key as string, m.label]));
    const domains = labelOf(dims?.['domain']);
    const addrs = labelOf(dims?.['addr_tag']);
    const lines = new Map<string, LineInfo>(
      (dims?.['line'] ?? []).map((m) => [
        m.key,
        {
          key: m.key,
          name: m.label,
          vendor: text(m.attrs['vendor']),
          domain: text(m.attrs['domain']),
          addr: text(m.attrs['addr']),
          confidence: text(m.attrs['confidence']),
        },
      ]),
    );
    return {
      lines,
      addrCategories: (dims?.['addr_tag'] ?? []).map((m) => ({ key: m.key, label: m.label })),
      addrLabel: (k: string) => addrs.get(k) ?? k,
      domainLabel: (k: string) => domains.get(k) ?? k,
      loading: members.data === undefined,
    };
  }, [dims, members.data]);
}

const isBy = (v: string | null): v is BaselineGroupBy =>
  v === 'pool' || v === 'domain' || v === 'vp';

/** `?group` is the grouping (`pool`, `domain`, `vp`), `?key` the selected group member (IA §5). */
export function useBaselineSelection(): { by: BaselineGroupBy; key: string | null } {
  const group = useViewStore((s) => s.selection.group);
  const key = useViewStore((s) => s.selection.key);
  return { by: isBy(group) ? group : 'pool', key };
}

/** URL moves of the screen: select a group, change the grouping, go to the Excel module. */
export function useBaselineNavigation() {
  const router = useRouter();
  return useMemo(() => {
    const params = () => (router.state.matches.at(-1)?.params ?? {}) as Record<string, string>;
    const go = (module: string, search: Record<string, string> | undefined) => {
      const p = params();
      if (!p['tenant'] || !p['scenario']) return;
      void router.navigate({
        to: '/$tenant/$scenario/$module',
        params: { tenant: p['tenant'], scenario: p['scenario'], module },
        ...(search ? { search } : {}),
      } as never);
    };
    return {
      select: (by: BaselineGroupBy, key: string | null) =>
        go('baseline', key === null ? { group: by } : { group: by, key }),
      toExcel: () => go('excel', undefined),
    };
  }, [router]);
}
