import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Member } from '@glidepath/spec';
import { beforeAll, describe, expect, it } from 'vitest';
import { splitMemberKey } from '../member-key';
import { LINE_ITEM_ATTRIBUTES, LINE_ITEM_JOINED_ATTRIBUTES, memberOfRow } from '../member-rows';
import { isNullable, repoRoot, schemaJson } from '../test-support/schema-json';
import {
  loadSeedFixture,
  mutate,
  type Mutation,
  type SeedFixture,
} from '../test-support/seed-state';
import {
  INPUT_RULE_IDS,
  VALIDATION_RULES,
  type InputRuleId,
  type ValidationEntry,
} from './catalog';
import { INPUT_RULES, validateInputs } from './index';
import { LINE_ITEM_KEYS, OUT_OF_SCOPE_MEMO_DOMAIN, SEED_LINE_ATTRIBUTES } from './input-rules';
import { toCellKey, type ValidationState } from './state';
import { CORPORATE_LAYER } from './vr10';

let fx: SeedFixture;
/** Every fixture mutates preset B, which passes every rule without a warning. */
let base: ValidationState;

beforeAll(async () => {
  fx = await loadSeedFixture();
  base = fx.stateFor('B');
});

interface Fixture {
  readonly what: string;
  readonly mutation: Mutation;
}
interface FailFixture extends Fixture {
  /** The rule's entries, in order; rule and severity are the rule's. */
  readonly entries: readonly Pick<ValidationEntry, 'cells' | 'message'>[];
}

const VPS = ['vp_commercial', 'vp_operations', 'vp_corporate', 'vp_infra'];
const domShare = (domain: string, vp: string) => toCellKey('org.dom_share', `${domain},${vp}`);

/** A line as the database serves it (v_dimension_members, `memberOfRow`): `vendor` = vendor_key. */
const dbLine = (id: string, vendor_key: string | null): Member =>
  memberOfRow('line', id, {
    name: `Line ${id}`,
    pool_id: 'cloud',
    domain_key: 'cybersecurity',
    vendor_key,
    vendor_text: 'Various',
    in_scope: true,
    memo: false,
    active: true,
  })!;

/** One pass and at least one fail fixture per input rule. */
const FIXTURES: Readonly<Record<InputRuleId, { pass: Fixture[]; fail: FailFixture[] }>> = {
  VR01: {
    pass: [
      {
        what: 'a domain re-split 60/40 between two VPs',
        mutation: {
          set: [
            ['org.dom_share', 'commercial_applications,vp_commercial', 0.6],
            ['org.dom_share', 'commercial_applications,vp_operations', 0.4],
          ],
        },
      },
      {
        what: 'shares whose float sum is 0.9999999999999999',
        mutation: {
          set: [
            ['org.dom_share', 'commercial_applications,vp_commercial', 0.3],
            ['org.dom_share', 'commercial_applications,vp_operations', 0.6],
            ['org.dom_share', 'commercial_applications,vp_corporate', 0.1],
          ],
        },
      },
    ],
    fail: [
      {
        what: 'a domain owned 90% and the memo domain owned 20%',
        mutation: {
          set: [
            ['org.dom_share', 'commercial_applications,vp_commercial', 0.9],
            ['org.dom_share', 'out_of_scope_memo,vp_infra', 0.2],
          ],
        },
        entries: [
          {
            cells: VPS.map((vp) => domShare('commercial_applications', vp)),
            message:
              'Commercial applications ownership sums to 90%; its VP shares must add up to 100%.',
          },
          {
            cells: VPS.map((vp) => domShare('out_of_scope_memo', vp)),
            message:
              'Out of scope (memo) belongs to no VP, but its VP shares sum to 20%; set them to 0%.',
          },
        ],
      },
      {
        what: 'a new domain without ownership rows',
        mutation: { add: { domain: [{ id: 'loyalty_tech', label: 'Loyalty technology' }] } },
        entries: [
          {
            cells: VPS.map((vp) => domShare('loyalty_tech', vp)),
            message: 'Loyalty technology ownership sums to 0%; its VP shares must add up to 100%.',
          },
        ],
      },
    ],
  },
  VR02: {
    pass: [
      {
        what: 'the shared-services flag moved to another VP',
        mutation: {
          set: [
            ['org.ss_flag', 'vp_infra', 0],
            ['org.ss_flag', 'vp_commercial', 1],
          ],
        },
      },
      {
        what: 'chargeback off and no VP flagged',
        mutation: {
          set: [
            ['g.chargeback_on', '', 0],
            ['org.ss_flag', 'vp_infra', 0],
          ],
        },
      },
    ],
    fail: [
      {
        what: 'chargeback on and no VP flagged',
        mutation: { set: [['org.ss_flag', 'vp_infra', 0]] },
        entries: [
          {
            cells: ['g.chargeback_on[]', ...VPS.map((vp) => toCellKey('org.ss_flag', vp))],
            message:
              'Chargeback is on but no VP is marked as the shared-services owner; mark exactly one.',
          },
        ],
      },
      {
        what: 'chargeback on and two VPs flagged',
        mutation: { set: [['org.ss_flag', 'vp_corporate', 1]] },
        entries: [
          {
            cells: ['g.chargeback_on[]', 'org.ss_flag[vp_corporate]', 'org.ss_flag[vp_infra]'],
            message:
              'Chargeback is on but 2 VPs are marked as the shared-services owner (Corporate Technology and Infrastructure & All Others); mark exactly one.',
          },
        ],
      },
    ],
  },
  VR03: {
    pass: [
      {
        what: 'usage override on, keys 30/60/10/0 (float sum 0.9999999999999999)',
        mutation: {
          set: [
            ['org.usage_override_on', '', 1],
            ['org.usage_override', 'vp_commercial', 0.3],
            ['org.usage_override', 'vp_operations', 0.6],
            ['org.usage_override', 'vp_corporate', 0.1],
            ['org.usage_override', 'vp_infra', 0],
          ],
        },
      },
      {
        what: 'usage override off, keys summing to 75%',
        mutation: { set: [['org.usage_override', 'vp_infra', 0]] },
      },
    ],
    fail: [
      {
        what: 'usage override on, keys summing to 125%',
        mutation: {
          set: [
            ['org.usage_override_on', '', 1],
            ['org.usage_override', 'vp_infra', 0.5],
          ],
        },
        entries: [
          {
            cells: [
              'org.usage_override_on[]',
              ...VPS.map((vp) => toCellKey('org.usage_override', vp)),
            ],
            message:
              'Metered usage keys sum to 125%; with the usage override on they must add up to 100%.',
          },
        ],
      },
    ],
  },
  VR04: {
    pass: [
      {
        what: 'values on their bounds, and float noise past a bound',
        mutation: {
          set: [
            ['lev.L09.n', '', 300],
            ['portfolio.apps', '', 500],
            ['corp.gdp', 'fy26', 5 + 1e-12],
            ['line.amount', 'it_001', 0],
          ],
        },
      },
    ],
    fail: [
      {
        what: 'values above a max and below a min, scalar and dimensioned, one bound open',
        mutation: {
          set: [
            ['lev.L09.n', '', 301],
            ['portfolio.apps', '', 499],
            ['corp.gdp', 'fy26', 6],
            ['line.amount', 'it_001', -5],
          ],
        },
        entries: [
          {
            cells: ['corp.gdp[fy26]'],
            message:
              'US real GDP growth (FY2026E) is 6, above the maximum 5; keep it within -4 to 5.',
          },
          {
            cells: ['lev.L09.n[]'],
            message:
              'Applications retired / consolidated in 2027 is 301, above the maximum 300; keep it within 0 to 300.',
          },
          {
            cells: ['line.amount[it_001]'],
            message:
              'CY26 normalized outlay per line (opex + cash capex) (it_001) is -5, below the minimum 0; keep it at 0 or more.',
          },
          {
            cells: ['portfolio.apps[]'],
            message:
              'Applications in portfolio is 499, below the minimum 500; keep it within 500 to 3000.',
          },
        ],
      },
    ],
  },
  VR06: {
    pass: [
      {
        what: 'splits of 70% and 30%',
        mutation: {
          set: [
            ['lev.L09.split_sw', '', 0.7],
            ['lev.L09.split_cloud', '', 0.3],
          ],
        },
      },
      {
        what: 'splits whose float sum is 1.0000000000000002',
        mutation: {
          set: [
            ['lev.L09.split_sw', '', 0.07],
            ['lev.L09.split_cloud', '', 0.1 * 9.3],
          ],
        },
      },
    ],
    fail: [
      {
        what: 'splits of 80% and 30%',
        mutation: {
          set: [
            ['lev.L09.split_sw', '', 0.8],
            ['lev.L09.split_cloud', '', 0.3],
          ],
        },
        entries: [
          {
            cells: ['lev.L09.split_sw[]', 'lev.L09.split_cloud[]'],
            message:
              'App-retirement savings land 80% in software and 30% in cloud, 110% in all; keep the two within 100%.',
          },
        ],
      },
    ],
  },
  VR07: {
    pass: [
      {
        what: 'every app of the portfolio retired',
        mutation: {
          set: [
            ['lev.L09.n', '', 300],
            ['portfolio.apps', '', 300],
          ],
        },
      },
    ],
    fail: [
      {
        what: 'more apps retired than the portfolio holds',
        mutation: {
          set: [
            ['lev.L09.n', '', 300],
            ['portfolio.apps', '', 250],
          ],
        },
        entries: [
          {
            cells: ['lev.L09.n[]', 'portfolio.apps[]'],
            message:
              '300 applications retired exceed the 250 in the portfolio; retire at most 250.',
          },
        ],
      },
    ],
  },
  VR09: {
    pass: [
      {
        what: 'a line moved to another pool and domain, with a vendor key',
        mutation: {
          patch: {
            line: { it_001: { pool: 'cloud', domain: 'cybersecurity', vendor_key: 'ibm' } },
          },
        },
      },
      {
        what: 'a new line in line_item column shape (pool_id, domain_key, vendor_key null)',
        mutation: {
          add: {
            line: [
              { id: 'it_900', pool_id: 'cloud', domain_key: 'cybersecurity', vendor_key: null },
            ],
          },
        },
      },
      {
        what: 'lines read from the database (vendor = vendor_key): a vendor member, and none',
        mutation: { add: { line: [dbLine('it_901', 'ibm'), dbLine('it_902', null)] } },
      },
      {
        what: "a seed-file line's vendor is free text (vendor_text), not a key",
        mutation: { patch: { line: { it_002: { vendor: 'Some firm, not a vendor member' } } } },
      },
    ],
    fail: [
      {
        what: 'an unknown pool, a missing domain, an unknown vendor key, an unknown domain_key',
        mutation: {
          patch: {
            line: {
              it_001: { pool: 'mainframe' },
              it_002: { domain: null },
              it_003: { vendor_key: 'acme' },
            },
          },
          add: { line: [{ id: 'it_900', pool_id: 'cloud', domain_key: 'retired_domain' }] },
        },
        entries: [
          {
            cells: ['line[it_001]'],
            message:
              "Line it_001 names canonical pool 'mainframe', which does not exist; pick an existing canonical pool.",
          },
          {
            cells: ['line[it_002]'],
            message: 'Line it_002 has no domain; assign an existing domain.',
          },
          {
            cells: ['line[it_003]'],
            message:
              "Line it_003 names vendor 'acme', which does not exist; pick an existing vendor.",
          },
          {
            cells: ['line[it_900]'],
            message:
              "Line it_900 names domain 'retired_domain', which does not exist; pick an existing domain.",
          },
        ],
      },
      {
        what: 'a line read from the database names an unknown vendor key (vendor = vendor_key)',
        mutation: { add: { line: [dbLine('it_903', 'acme')] } },
        entries: [
          {
            cells: ['line[it_903]'],
            message:
              "Line it_903 names vendor 'acme', which does not exist; pick an existing vendor.",
          },
        ],
      },
    ],
  },
  VR10: {
    pass: [
      {
        what: 'fy25 values no expression reads removed (corp.cpi, corp.yield_gdp)',
        mutation: {
          unset: [
            ['corp.cpi', 'fy25'],
            ['corp.yield_gdp', 'fy25'],
          ],
        },
      },
    ],
    fail: [
      {
        what: 'a base-year scalar, a growth year and a labor-group year removed',
        mutation: {
          unset: [
            ['corp.asm25', ''],
            ['corp.asm_g', 'fy26'],
            ['corp.lab_hc_g', 'pilots,fy27'],
          ],
        },
        entries: [
          { cells: ['corp.asm25[]'], message: 'ASMs, FY2025 has no value; pl.asm needs it.' },
          {
            cells: ['corp.asm_g[fy26]'],
            message:
              'ASM (capacity) growth has no value for FY2026E; pl.asm, pl.dep and pl.oth_base need it.',
          },
          {
            cells: ['corp.lab_hc_g[pilots,fy27]'],
            message:
              'Headcount growth by labor group has no value for Pilots (APA), FY2027E; pl.lab_hc needs it.',
          },
        ],
      },
    ],
  },
};

describe('one pure function per rule with severity from schema.json (one pass + one fail fixture per rule)', () => {
  for (const id of INPUT_RULE_IDS) {
    const { pass, fail } = FIXTURES[id];

    for (const f of pass) {
      it(`${id} pass: ${f.what}`, () => {
        const state = mutate(base, f.mutation);
        expect(INPUT_RULES[id](state)).toEqual([]);
        expect(validateInputs(state).filter((e) => e.severity === 'error')).toEqual([]);
      });
    }

    for (const f of fail) {
      it(`${id} fail: ${f.what}`, () => {
        const state = mutate(base, f.mutation);
        const severity = VALIDATION_RULES[id].severity;
        const expected = f.entries.map((e) => ({ rule: id, severity, ...e }));
        expect(INPUT_RULES[id](state)).toEqual(expected);
        // the fixture breaks this rule only
        expect(validateInputs(state).filter((e) => e.rule === id)).toEqual(expected);
        expect(
          validateInputs(state).filter((e) => e.rule !== id && e.severity === 'error'),
        ).toEqual([]);
      });
    }
  }

  it('the base state passes every rule, and rules neither change their input nor depend on call order', () => {
    expect(validateInputs(base)).toEqual([]);
    const fail = mutate(base, FIXTURES.VR01.fail[0]!.mutation);
    const snapshot = JSON.stringify([fail.values, fail.members]);
    const byRule = new Map([...INPUT_RULE_IDS].reverse().map((id) => [id, INPUT_RULES[id](fail)]));
    const first = validateInputs(fail);
    expect(first.length).toBeGreaterThan(0);
    expect(INPUT_RULE_IDS.flatMap((id) => byRule.get(id)!)).toEqual(first);
    expect(validateInputs(fail)).toEqual(first);
    expect(JSON.stringify([fail.values, fail.members])).toBe(snapshot);
  });

  it('a rule whose variables the model does not define, or whose cells are absent, reports nothing', () => {
    const bare: ValidationState = {
      bundle: { variables: [], nodes: [] },
      members: base.members,
      values: [],
    };
    for (const id of INPUT_RULE_IDS.filter((r) => r !== 'VR09')) {
      expect(INPUT_RULES[id](bare)).toEqual([]);
    }
    const noL09 = mutate(base, {
      unset: [
        ['lev.L09.n', ''],
        ['lev.L09.split_sw', ''],
        ['lev.L09.split_cloud', ''],
      ],
    });
    expect(INPUT_RULES.VR06(noL09)).toEqual([]);
    expect(INPUT_RULES.VR07(noL09)).toEqual([]);
  });
});

describe('the ids the rules read are the spec ids', () => {
  it('VR09 checks the line_item foreign keys of schema.json, read from the line attributes the model declares', () => {
    const line = schemaJson.tables.line_item.columns;
    const fkTarget: Record<string, string> = {
      pool: 'canonical_pool.id',
      domain: 'dimension_member(domain)',
      vendor: 'dimension_member(vendor)',
    };
    for (const k of LINE_ITEM_KEYS) {
      const col = line.find((c) => c.name === k.column);
      expect(col?.constraints, k.column).toContain(`fk ${fkTarget[k.dim]}`);
      expect(isNullable('line_item', k.column), k.column).toBe(k.nullable);
    }
    // Each key is read from the attribute v_dimension_members (and memberOfRow) exposes its column as.
    const lineAttrs = fx.bundle.dimensions.find((d) => d.id === 'line')!.attributes;
    for (const k of LINE_ITEM_KEYS) {
      expect(lineAttrs, k.column).toContain(k.attribute);
      expect(LINE_ITEM_ATTRIBUTES[k.column], k.column).toBe(k.attribute);
    }
    expect(LINE_ITEM_KEYS.filter((k) => k.seedText).map((k) => k.attribute)).toEqual(['vendor']);
    expect(fx.bundle.dimensions.map((d) => d.id)).toEqual(
      expect.arrayContaining(LINE_ITEM_KEYS.map((k) => k.dim)),
    );
  });

  it('seed-file lines carry SEED_LINE_ATTRIBUTES, which no line read from the database has; their vendor is free text', () => {
    const viewAttrs = [...Object.values(LINE_ITEM_ATTRIBUTES), ...LINE_ITEM_JOINED_ATTRIBUTES];
    for (const a of SEED_LINE_ATTRIBUTES) expect(viewAttrs).not.toContain(a);
    expect(
      Object.keys(dbLine('it_901', 'ibm')).filter((a) => SEED_LINE_ATTRIBUTES.includes(a as never)),
    ).toEqual([]);

    const zz = JSON.parse(
      readFileSync(resolve(repoRoot, 'tools/testkit/seed/zz/dimension_members.json'), 'utf8'),
    ) as Record<string, Member[]>;
    for (const [tenant, members] of [
      ['aa', fx.seed.dimensionMembers],
      ['zz', zz],
    ] as const) {
      const lines = members.line!;
      const vendors = new Set(members.vendor!.map((v) => v.id));
      for (const line of lines) {
        for (const a of SEED_LINE_ATTRIBUTES)
          expect(line[a], `${tenant} ${line.id} ${a}`).toBeDefined();
      }
      // `vendor` is the vendor's name (vendor_text), never a vendor key; the key is `vendor_key`.
      expect(
        lines.filter((l) => vendors.has(l.vendor as string)).map((l) => l.id),
        tenant,
      ).toEqual([]);
      expect(
        lines.filter((l) => l.vendor_key !== undefined && !vendors.has(l.vendor_key as string)),
        tenant,
      ).toEqual([]);
    }
    expect(zz.line!.some((l) => l.vendor_key !== undefined)).toBe(true);
  });

  it("VR10's corp inputs are the variables of the corporate layer, which are the corp. variables", () => {
    const corpLayer = fx.bundle.variables
      .filter((v) => v.layer === CORPORATE_LAYER)
      .map((v) => v.id);
    expect(corpLayer.length).toBeGreaterThan(0);
    expect(corpLayer).toEqual(
      fx.bundle.variables.filter((v) => v.id.startsWith('corp.')).map((v) => v.id),
    );
  });

  it('VR01 to VR07 read variables and dims the model defines, and the memo domain is a seed domain', () => {
    const ids = new Set(fx.bundle.variables.map((v) => v.id));
    for (const v of [
      'org.dom_share',
      'org.ss_flag',
      'g.chargeback_on',
      'org.usage_override',
      'org.usage_override_on',
      'lev.L09.split_sw',
      'lev.L09.split_cloud',
      'lev.L09.n',
      'portfolio.apps',
    ]) {
      expect(ids, v).toContain(v);
    }
    expect(fx.seed.dimensionMembers.domain!.map((d) => d.id)).toContain(OUT_OF_SCOPE_MEMO_DOMAIN);
  });
});

/** The contract's CellKey (contract/api-contract ids.ts) and OneLine. */
const CELL_KEY = /^[^[\]\s]+\[[^[\]]*\]$/;
const ONE_LINE = /^[^\r\n]*$/;
/** A UI error chip holds one short sentence. */
const CHIP_MAX = 200;

describe('entries carry rule, severity, cells and a one-line message suitable for the UI error chip', () => {
  it('every entry of every fail fixture has exactly rule, severity, cells and message, as the contract Violation', () => {
    const variables = new Map(fx.bundle.variables.map((v) => [v.id, v]));
    const ids = new Set([
      ...variables.keys(),
      ...fx.bundle.nodes.map((n) => n.id),
      ...fx.bundle.dimensions.map((d) => d.id),
    ]);
    const entries = INPUT_RULE_IDS.flatMap((id) =>
      FIXTURES[id].fail.flatMap((f) => validateInputs(mutate(base, f.mutation))),
    );
    expect(new Set(entries.map((e) => e.rule))).toEqual(new Set(INPUT_RULE_IDS));

    for (const e of entries) {
      expect(Object.keys(e).sort()).toEqual(['cells', 'message', 'rule', 'severity']);
      expect(JSON.parse(JSON.stringify(e))).toEqual(e);
      expect(e.severity).toBe(VALIDATION_RULES[e.rule].severity);

      expect(e.cells.length).toBeGreaterThan(0);
      for (const cell of e.cells) {
        expect(cell).toMatch(CELL_KEY);
        const [, id, member] = /^(.+)\[(.*)\]$/.exec(cell)!;
        expect(ids, cell).toContain(id);
        const def = variables.get(id!);
        if (def) expect(() => splitMemberKey(def, member!), cell).not.toThrow();
      }

      expect(e.message).toMatch(ONE_LINE);
      expect(e.message).toBe(e.message.trim());
      expect(e.message.length).toBeGreaterThan(0);
      expect(e.message.length).toBeLessThanOrEqual(CHIP_MAX);
      expect(e.message).toMatch(/^[A-Z0-9].*\.$/);
      expect(e.message).not.toMatch(/undefined|NaN|null|\[object/);
    }
  });

  it('cells use the contract format: scalars end in [] and members are comma-joined', () => {
    expect(toCellKey('g.chargeback_on')).toBe('g.chargeback_on[]');
    expect(toCellKey('corp.lab_hc_g', 'pilots,fy27')).toBe('corp.lab_hc_g[pilots,fy27]');
  });
});

describe('aa seed for every preset passes all rules', () => {
  /**
   * Seed values above their registry max in docs/spec (read-only): lev.L15.pct is 0.1 in the tenant
   * defaults and in A and C (max 0.08); D sets four levers past their max. Rates and B override them.
   */
  const SPEC_VR04_WARNINGS: Readonly<Record<string, readonly string[]>> = {
    defaults: ['lev.L15.pct[]'],
    A: ['lev.L15.pct[]'],
    C: ['lev.L15.pct[]'],
    D: ['lev.L01.cut[]', 'lev.L01.rel[]', 'lev.L03.pct[]', 'lev.L15.pct[]'],
  };

  it('the seed has the five presets', () => {
    expect(fx.presets).toEqual(['rates', 'A', 'B', 'C', 'D']);
  });

  it('tenant defaults and every preset: no error from any rule; only the spec presets above a registry max warn (VR04)', () => {
    for (const preset of [null, ...fx.presets]) {
      const entries = validateInputs(fx.stateFor(preset));
      expect(
        entries.filter((e) => e.severity === 'error'),
        `preset ${preset}`,
      ).toEqual([]);
      const warnings = entries.filter((e) => e.severity === 'warning');
      expect(new Set(warnings.map((e) => e.rule)), `preset ${preset}`).toEqual(
        new Set(warnings.length ? ['VR04'] : []),
      );
      expect(
        warnings.flatMap((e) => e.cells),
        `preset ${preset}`,
      ).toEqual(SPEC_VR04_WARNINGS[preset ?? 'defaults'] ?? []);
    }
  });
});
