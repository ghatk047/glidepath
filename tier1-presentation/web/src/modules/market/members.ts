import type { MembersResponse } from '@glidepath/api-contract';

export type MemberRow = MembersResponse['dimensions'][keyof MembersResponse['dimensions']][number];

/** Active members of one dimension in tier 2's order (`[]` while the members are loading). */
export function activeMembers(data: MembersResponse | undefined, dim: string): MemberRow[] {
  const found = Object.entries(data?.dimensions ?? {}).find(([k]) => k === dim);
  return (found?.[1] ?? []).filter((m) => m.active);
}
