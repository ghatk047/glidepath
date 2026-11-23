import type { Member, NodeDef, TenantMembers, VariableDef } from '@glidepath/spec';
import { describe, expect, it } from 'vitest';
import type { InputValueRow } from '../resolve';
import type { ValidationState } from './state';
import { CORPORATE_LAYER, vr10CorpInputYears } from './vr10';

// A small model in the shape of the corporate layer: year columns read iyear inputs through `year.in`.

const variable = (id: string, dims: string[], layer = CORPORATE_LAYER): VariableDef => ({
  id,
  kind: 'decision',
  label: id.replace('corp.', 'Driver '),
  unit: '%',
  type: 'number',
  dims,
  min: null,
  max: null,
  step: null,
  layer,
  role: 'driver',
  ui: { control: 'number', hero: false },
  scenario_varies: false,
});

const variables: VariableDef[] = [
  variable('corp.s', []),
  variable('corp.g', ['iyear']),
  variable('corp.h', ['iyear']),
  variable('corp.w', ['iyear']),
  variable('corp.l', ['lgroup', 'iyear']),
  variable('x.flag', [], 'levers'),
];

const node = (id: string, dims: string[], def: Partial<NodeDef>): NodeDef => ({
  id,
  dims,
  unit: '$M',
  label: id,
  layer: 'corporate',
  output: false,
  ...def,
});

const nodes: NodeDef[] = [
  // base-year case reads a scalar; later years read growth through year.in
  node('n.a', ['year'], {
    cases: [
      { when: { year: ['y1'] }, expr: 'corp.s' },
      { when: null, expr: 'n.a[year.prev] * (1 + corp.g[year.in] / 100) * corp.h[year.in]' },
    ],
  }),
  // an aggregate filtered by a where clause: only years with it == 0
  node('n.b', [], { expr: 'SUM(y in year where y.it == 0, corp.g[y.in] + corp.w[y.in])' }),
  node('n.c', ['year', 'lgroup'], { expr: 'corp.l[lgroup, year.in]' }),
  // a member subset, a member literal, and both branches of IF
  node('n.d', ['year'], {
    members: { year: ['y3'] },
    expr: "corp.g['i1'] + IF(x.flag > 0, corp.s, 0)",
  }),
  // implicit indexing by the bound iyear
  node('n.e', ['iyear'], { members: { iyear: ['i3'] }, expr: 'corp.g * 2' }),
  node('n.f', [], { expr: 'COUNT(y in year where y.it == 1) + x.flag' }),
];

const members: TenantMembers = {
  year: [
    { id: 'y1', label: 'Year one', in: 'i1', prev: '', it: 0 },
    { id: 'y2', label: 'Year two', in: 'i2', prev: 'y1', it: 0 },
    { id: 'y3', label: 'Year three', in: 'i3', prev: 'y2', it: 1 },
  ],
  iyear: [
    { id: 'i1', label: 'Input year 1' },
    { id: 'i2', label: 'Input year 2' },
    { id: 'i3', label: 'Input year 3' },
  ],
  lgroup: [
    { id: 'g1', label: 'Group one' },
    { id: 'g2', label: 'Group two' },
  ],
};

const I = ['i1', 'i2', 'i3'];
const full: InputValueRow[] = [
  { var_key: 'corp.s', member_key: '', value: 1 },
  ...['corp.g', 'corp.h', 'corp.w'].flatMap((v) =>
    I.map((i) => ({ var_key: v, member_key: i, value: 1 })),
  ),
  ...['g1', 'g2'].flatMap((g) =>
    I.map((i) => ({ var_key: 'corp.l', member_key: `${g},${i}`, value: 1 })),
  ),
  { var_key: 'x.flag', member_key: '', value: 0 },
];

const state = (
  over: { values?: InputValueRow[]; members?: TenantMembers; nodes?: NodeDef[] } = {},
): ValidationState => ({
  bundle: { variables, nodes: over.nodes ?? nodes },
  members: over.members ?? members,
  values: over.values ?? full,
});
const without = (...cells: string[]): InputValueRow[] =>
  full.filter((r) => !cells.includes(`${r.var_key}[${r.member_key}]`));

describe('VR10 reads the corp cells each expression uses, per year', () => {
  it('all inputs present: no entry', () => {
    expect(vr10CorpInputYears(state())).toEqual([]);
  });

  it('a year only a skipped case or a filtered-out aggregate member would read is not needed', () => {
    // corp.h is read by n.a's later-year case only (y2, y3 -> i2, i3); corp.w by n.b for it == 0 (i1, i2)
    expect(vr10CorpInputYears(state({ values: without('corp.h[i1]', 'corp.w[i3]') }))).toEqual([]);
  });

  it('a missing year names its cell and the nodes that read it (literal, aggregate, implicit index)', () => {
    expect(vr10CorpInputYears(state({ values: without('corp.g[i1]', 'corp.g[i3]') }))).toEqual([
      {
        rule: 'VR10',
        severity: 'error',
        cells: ['corp.g[i1]', 'corp.g[i3]'],
        message:
          'Driver g has no value for Input year 1 and Input year 3; n.a, n.b, n.d and 1 more need it.',
      },
    ]);
    expect(vr10CorpInputYears(state({ values: without('corp.h[i2]') }))).toEqual([
      {
        rule: 'VR10',
        severity: 'error',
        cells: ['corp.h[i2]'],
        message: 'Driver h has no value for Input year 2; n.a needs it.',
      },
    ]);
  });

  it('both branches of IF count, and scalars and two-dim inputs are checked', () => {
    expect(
      vr10CorpInputYears(state({ values: without('corp.s[]', 'corp.l[g2,i3]') })).map((e) => [
        e.cells,
        e.message,
      ]),
    ).toEqual([
      [['corp.s[]'], 'Driver s has no value; n.a and n.d need it.'],
      [['corp.l[g2,i3]'], 'Driver l has no value for Group two, Input year 3; n.c needs it.'],
    ]);
  });

  it('a year without the attribute its index reads cannot be resolved: one entry per variable, at the node cells', () => {
    const noIn: TenantMembers = {
      ...members,
      year: members.year!.map((m): Member => (m.id === 'y3' ? { ...m, in: null } : m)),
    };
    expect(vr10CorpInputYears(state({ members: noIn })).map((e) => [e.cells, e.message])).toEqual([
      [
        ['n.a[y3]'],
        "n.a[y3] cannot read Driver g: year 'y3' has no attribute 'in'; fix the member attributes or the expression.",
      ],
      [
        ['n.a[y3]'],
        "n.a[y3] cannot read Driver h: year 'y3' has no attribute 'in'; fix the member attributes or the expression.",
      ],
      [
        ['n.c[y3,g1]', 'n.c[y3,g2]'],
        "n.c[y3,g1] and n.c[y3,g2] cannot read Driver l: year 'y3' has no attribute 'in'; fix the member attributes or the expression.",
      ],
    ]);
  });

  it('references that cannot be indexed: no binding for an implicit dim, wrong arity, a computed index', () => {
    const reasons = (expr: string, dims: string[] = []) =>
      vr10CorpInputYears(state({ nodes: [node('n.x', dims, { expr })] })).map((e) => e.message);
    expect(reasons('corp.g')).toEqual([
      'n.x[] cannot read Driver g: no iyear is bound to index it; fix the member attributes or the expression.',
    ]);
    expect(reasons("corp.g['i1', 'i2']")).toEqual([
      'n.x[] cannot read Driver g: it takes 1 index(es), not 2; fix the member attributes or the expression.',
    ]);
    expect(reasons('corp.g[year.it + 1]', ['year'])[0]).toMatch(
      /^n\.x\[y1\], n\.x\[y2\] and n\.x\[y3\] cannot read Driver g: an index must be a member/,
    );
  });

  it('where clauses evaluate statically: functions, aggregates, attributes of every type', () => {
    const where = [
      'OR(y.it == 1, NOT(y.it == 1))',
      'MIN(1, 2) < MAX(3, 4)',
      'ABS(-1) == 1',
      'SAFEDIV(1, 0) == 0',
      'SAFEDIV(4, 2, 9) == 2',
      'SAFEDIV(1, 0, 5) == 5',
      'IF(y.it, 1, 1)',
      '2 ^ 2 == 4',
      '6 / 3 - 1 == 1',
      '1 + 1 >= 2',
      '1 <= 1',
      '2 > 1',
      "y.in != 'zz'",
      'y.tags',
      'y.flagged == 1',
      'y.tags == y.tags',
      'COUNT(z in year where z.it == 0) == 2',
      'SUM(z in year, z.it) == 1',
      'MAXOVER(z in year, z.it) == 1',
      'MINOVER(z in year where z.it == 5, z.it) == 0',
      'MAXOVER(z in year where z.it == 5, z.it) == 0',
      'MINOVER(z in year, z.it) == 0',
      'COUNT(z in year) == 3',
    ].join(', ');
    const tagged: TenantMembers = {
      ...members,
      year: members.year!.map((m) => ({ ...m, tags: ['t'], flagged: true })),
    };
    const agg = node('n.x', [], { expr: `SUM(y in year where AND(${where}), corp.g[y.in])` });
    const run = (values: InputValueRow[]) =>
      vr10CorpInputYears(state({ nodes: [agg], members: tagged, values })).flatMap((e) => e.cells);
    expect(run(full)).toEqual([]);
    expect(run(without('corp.g[i1]', 'corp.g[i2]', 'corp.g[i3]'))).toEqual([
      'corp.g[i1]',
      'corp.g[i2]',
      'corp.g[i3]',
    ]);
    // a where clause that is false everywhere reads nothing
    const none = node('n.x', [], { expr: 'SUM(y in year where y.it == 7, corp.g[y.in])' });
    expect(vr10CorpInputYears(state({ nodes: [none], values: [] }))).toEqual([]);
  });

  it('a where clause that reads a cell or calls an unknown function is a model error', () => {
    const bad = (where: string) => () =>
      vr10CorpInputYears(
        state({
          nodes: [node('n.x', [], { expr: `SUM(y in year where ${where}, corp.g[y.in])` })],
        }),
      );
    expect(bad('x.flag > 0')).toThrow(/where clause reads x\.flag/);
    expect(bad('FOO(1)')).toThrow(/unknown function FOO/);
  });

  it('a model without corporate inputs, or nodes without them, has nothing to check', () => {
    expect(
      vr10CorpInputYears({
        bundle: { variables: [variable('x.flag', [], 'levers')], nodes },
        members,
        values: [],
      }),
    ).toEqual([]);
    expect(vr10CorpInputYears(state({ nodes: [nodes[5]!], values: [] }))).toEqual([]);
  });

  it('a node with no expression for a cell is skipped (the engine reports it)', () => {
    const partial = node('n.x', ['year'], {
      cases: [{ when: { year: ['y1'] }, expr: 'corp.s' }],
    });
    expect(vr10CorpInputYears(state({ nodes: [partial], values: [] })).map((e) => e.cells)).toEqual(
      [['corp.s[]']],
    );
  });
});
