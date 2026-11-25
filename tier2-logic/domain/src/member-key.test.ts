import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadModelBundleFromDir } from '@glidepath/spec/node';
import type { ModelBundle, VariableDef } from '@glidepath/spec';
import { beforeAll, describe, expect, it } from 'vitest';
import { SCALAR_MEMBER_KEY, memberKey, splitMemberKey } from './member-key';
import { repoRoot } from './test-support/schema-json';

const specDir = resolve(repoRoot, 'docs/spec');
let bundle: ModelBundle;
const variable = (id: string): VariableDef => {
  const v = bundle.variables.find((x) => x.id === id);
  if (!v) throw new Error(`no variable ${id}`);
  return v;
};

beforeAll(async () => {
  bundle = await loadModelBundleFromDir(specDir);
});

describe("memberKey joins member ids in the variable's dims order, '' for scalars", () => {
  it("corp.lab_hc_g (lgroup, iyear) at pilots / fy27 is 'pilots,fy27', whatever the binding order", () => {
    const v = variable('corp.lab_hc_g');
    expect(v.dims).toEqual(['lgroup', 'iyear']);
    expect(memberKey(v, { iyear: 'fy27', lgroup: 'pilots' })).toBe('pilots,fy27');
    expect(memberKey(v, { lgroup: 'pilots', iyear: 'fy27' })).toBe('pilots,fy27');
    expect(memberKey(v, ['pilots', 'fy27'])).toBe('pilots,fy27');
    expect(splitMemberKey(v, 'pilots,fy27')).toEqual({ lgroup: 'pilots', iyear: 'fy27' });
  });

  it("scalars get ''", () => {
    const v = variable('g.target_net');
    expect(v.dims).toEqual([]);
    expect(memberKey(v, {})).toBe(SCALAR_MEMBER_KEY);
    expect(memberKey(v, {})).toBe('');
    expect(memberKey(v, [])).toBe('');
    expect(splitMemberKey(v, '')).toEqual({});
  });

  it("one dim and the spec's own examples ('L05', 'commercial_applications,vp_infra')", () => {
    expect(memberKey(variable('lev.start'), { lever: 'L05' })).toBe('L05');
    expect(
      memberKey(variable('org.dom_share'), { vp: 'vp_infra', domain: 'commercial_applications' }),
    ).toBe('commercial_applications,vp_infra');
  });

  it('ignores bindings of dims the variable does not have (an evaluation environment binds more)', () => {
    expect(memberKey(variable('lev.start'), { lever: 'L05', pool: 'cloud', vp: 'vp_infra' })).toBe(
      'L05',
    );
    expect(memberKey(variable('g.target_net'), { lever: 'L05' })).toBe('');
  });

  it('every aa_default key in variables.json round-trips and names seed members of the right dims', () => {
    const members = JSON.parse(
      readFileSync(resolve(specDir, 'seed/aa/dimension_members.json'), 'utf8'),
    ) as Record<string, { id: string }[]>;
    const ids = new Map(
      Object.entries(members).map(([d, ms]) => [d, new Set(ms.map((m) => m.id))]),
    );
    let checked = 0;
    for (const v of bundle.variables) {
      if (v.dims.length === 0 || typeof v.aa_default !== 'object') continue;
      for (const key of Object.keys(v.aa_default)) {
        const binding = splitMemberKey(v, key);
        for (const d of v.dims)
          expect(ids.get(d)?.has(binding[d]!), `${v.id}[${key}] ${d}`).toBe(true);
        expect(memberKey(v, binding)).toBe(key);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(100);
  });

  it('rejects a missing dim, a wrong arity, an empty member and a member containing a comma', () => {
    const v = variable('corp.lab_hc_g');
    expect(() => memberKey(v, { lgroup: 'pilots' })).toThrow(/corp\.lab_hc_g.*iyear/);
    expect(() => memberKey(v, ['pilots'])).toThrow(/corp\.lab_hc_g.*2/);
    expect(() => memberKey(v, { lgroup: '', iyear: 'fy27' })).toThrow(/empty/);
    expect(() => memberKey(v, { lgroup: 'a,b', iyear: 'fy27' })).toThrow(/','/);
    expect(() => splitMemberKey(v, 'pilots')).toThrow(/corp\.lab_hc_g.*2/);
    expect(() => splitMemberKey(v, 'pilots,')).toThrow(/empty/);
    expect(() => splitMemberKey(variable('lev.start'), '')).toThrow(/empty/);
    expect(() => splitMemberKey(variable('g.target_net'), 'L05')).toThrow(/scalar/);
    expect(() => memberKey({ dims: ['lever'] }, {})).toThrow(/variable.*lever/);
  });
});
