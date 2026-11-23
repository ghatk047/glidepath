/**
 * Input rules VR01-VR04, VR06, VR07 and VR09 of docs/spec/schema.json `validation_rules`: one pure
 * function per rule over a `ValidationState`, each returning its entries (empty = the rule holds).
 * Variable, dimension and member ids are the spec's, verbatim; no business number lives here.
 */
import type { AttrValue, DimId, Member, MemberId, VarId } from '@glidepath/spec';
import { LINE_ITEM_DIM } from '../changeset';
import { SCALAR_MEMBER_KEY, memberKey, type MemberKey } from '../member-key';
import { ruleEntry, type ValidationEntry } from './catalog';
import {
  RULE_TOLERANCE,
  contextOf,
  formatList,
  formatNumber,
  formatShare,
  memberKeyLabel,
  memberLabel,
  toCellKey,
  variableLabel,
  type RuleContext,
  type ValidationState,
} from './state';

const DOMAIN: DimId = 'domain';
const VP: DimId = 'vp';

/** The domain whose share sums to 0 (VR01): memo lines outside the IT scope belong to no VP. */
export const OUT_OF_SCOPE_MEMO_DOMAIN: MemberId = 'out_of_scope_memo';

const near = (a: number, b: number): boolean => Math.abs(a - b) <= RULE_TOLERANCE;
const sumOf = (ctx: RuleContext, varKey: VarId, keys: readonly MemberKey[]): number =>
  keys.reduce((s, k) => s + (ctx.value(varKey, k) ?? 0), 0);

// ------------------------------------------------------------------------------------------ VR01

const DOM_SHARE: VarId = 'org.dom_share';

/**
 * VR01: `org.dom_share` sums to 1 over vp for every domain, except `out_of_scope_memo`, which sums to
 * 0. One entry per domain that does not, pointing at the domain's cells for every VP.
 */
export function vr01DomainOwnership(state: ValidationState): ValidationEntry[] {
  const ctx = contextOf(state);
  const def = ctx.variables.get(DOM_SHARE);
  if (!def) return [];
  const vps = ctx.members(VP);
  return ctx.members(DOMAIN).flatMap((d) => {
    const keys = vps.map((v) => memberKey(def, { [DOMAIN]: d.id, [VP]: v.id }));
    const sum = sumOf(ctx, DOM_SHARE, keys);
    const memo = d.id === OUT_OF_SCOPE_MEMO_DOMAIN;
    if (near(sum, memo ? 0 : 1)) return [];
    const label = memberLabel(ctx, DOMAIN, d.id);
    const message = memo
      ? `${label} belongs to no VP, but its VP shares sum to ${formatShare(sum)}; set them to 0%.`
      : `${label} ownership sums to ${formatShare(sum)}; its VP shares must add up to 100%.`;
    return [
      ruleEntry(
        'VR01',
        keys.map((k) => toCellKey(DOM_SHARE, k)),
        message,
      ),
    ];
  });
}

// ------------------------------------------------------------------------------------------ VR02

const CHARGEBACK_ON: VarId = 'g.chargeback_on';
const SS_FLAG: VarId = 'org.ss_flag';

/** VR02: when `g.chargeback_on` = 1, exactly one vp has `org.ss_flag` = 1. */
export function vr02SharedServicesOwner(state: ValidationState): ValidationEntry[] {
  const ctx = contextOf(state);
  const def = ctx.variables.get(SS_FLAG);
  if (!def || ctx.value(CHARGEBACK_ON, SCALAR_MEMBER_KEY) !== 1) return [];
  const vps = ctx.members(VP).map((v) => ({ id: v.id, key: memberKey(def, { [VP]: v.id }) }));
  const flagged = vps.filter((v) => ctx.value(SS_FLAG, v.key) === 1);
  if (flagged.length === 1) return [];
  const cells = [
    toCellKey(CHARGEBACK_ON),
    ...(flagged.length === 0 ? vps : flagged).map((v) => toCellKey(SS_FLAG, v.key)),
  ];
  const labels = flagged.map((v) => memberLabel(ctx, VP, v.id));
  const message =
    flagged.length === 0
      ? 'Chargeback is on but no VP is marked as the shared-services owner; mark exactly one.'
      : `Chargeback is on but ${flagged.length} VPs are marked as the shared-services owner (${formatList(labels)}); mark exactly one.`;
  return [ruleEntry('VR02', cells, message)];
}

// ------------------------------------------------------------------------------------------ VR03

const USAGE_OVERRIDE_ON: VarId = 'org.usage_override_on';
const USAGE_OVERRIDE: VarId = 'org.usage_override';

/** VR03: when `org.usage_override_on` = 1, `org.usage_override` sums to 1 over vp. */
export function vr03UsageKeys(state: ValidationState): ValidationEntry[] {
  const ctx = contextOf(state);
  const def = ctx.variables.get(USAGE_OVERRIDE);
  if (!def || ctx.value(USAGE_OVERRIDE_ON, SCALAR_MEMBER_KEY) !== 1) return [];
  const keys = ctx.members(VP).map((v) => memberKey(def, { [VP]: v.id }));
  const sum = sumOf(ctx, USAGE_OVERRIDE, keys);
  if (near(sum, 1)) return [];
  return [
    ruleEntry(
      'VR03',
      [toCellKey(USAGE_OVERRIDE_ON), ...keys.map((k) => toCellKey(USAGE_OVERRIDE, k))],
      `Metered usage keys sum to ${formatShare(sum)}; with the usage override on they must add up to 100%.`,
    ),
  ];
}

// ------------------------------------------------------------------------------------------ VR04

/** How far past a bound float noise may go: the rule tolerance, relative for large bounds. */
const slack = (bound: number): number => RULE_TOLERANCE * Math.max(1, Math.abs(bound));

/**
 * VR04: every resolved value lies within its variable_def `min`/`max` (a null bound is open).
 * One warning per cell outside, in the order of `state.values`. The UI clamps; import flags.
 */
export function vr04RegistryBounds(state: ValidationState): ValidationEntry[] {
  const ctx = contextOf(state);
  return state.values.flatMap((r) => {
    const def = ctx.variables.get(r.var_key);
    if (!def) return [];
    const { min, max } = def;
    const below = min !== null && r.value < min - slack(min);
    const above = max !== null && r.value > max + slack(max);
    if (!below && !above) return [];
    const where = memberKeyLabel(ctx, def.dims, r.member_key);
    const subject = `${variableLabel(ctx, r.var_key)}${where === '' ? '' : ` (${where})`}`;
    const breach = below
      ? `below the minimum ${formatNumber(min)}`
      : `above the maximum ${formatNumber(max!)}`;
    const range =
      min !== null && max !== null
        ? `keep it within ${formatNumber(min)} to ${formatNumber(max)}`
        : below
          ? `keep it at ${formatNumber(min)} or more`
          : `keep it at ${formatNumber(max!)} or less`;
    return [
      ruleEntry(
        'VR04',
        [toCellKey(r.var_key, r.member_key)],
        `${subject} is ${formatNumber(r.value)}, ${breach}; ${range}.`,
      ),
    ];
  });
}

// ------------------------------------------------------------------------------------------ VR06

const SPLIT_SW: VarId = 'lev.L09.split_sw';
const SPLIT_CLOUD: VarId = 'lev.L09.split_cloud';

/** VR06: `lev.L09.split_sw` + `lev.L09.split_cloud` <= 1 (the rest lands in DC and hardware). */
export function vr06RetirementSplit(state: ValidationState): ValidationEntry[] {
  const ctx = contextOf(state);
  const sw = ctx.value(SPLIT_SW, SCALAR_MEMBER_KEY);
  const cloud = ctx.value(SPLIT_CLOUD, SCALAR_MEMBER_KEY);
  if (sw === undefined && cloud === undefined) return [];
  const sum = (sw ?? 0) + (cloud ?? 0);
  if (sum <= 1 + RULE_TOLERANCE) return [];
  return [
    ruleEntry(
      'VR06',
      [toCellKey(SPLIT_SW), toCellKey(SPLIT_CLOUD)],
      `App-retirement savings land ${formatShare(sw ?? 0)} in software and ${formatShare(cloud ?? 0)} in cloud, ${formatShare(sum)} in all; keep the two within 100%.`,
    ),
  ];
}

// ------------------------------------------------------------------------------------------ VR07

const APPS_RETIRED: VarId = 'lev.L09.n';
const PORTFOLIO_APPS: VarId = 'portfolio.apps';

/** VR07: `lev.L09.n` <= `portfolio.apps`. */
export function vr07RetiredApps(state: ValidationState): ValidationEntry[] {
  const ctx = contextOf(state);
  const n = ctx.value(APPS_RETIRED, SCALAR_MEMBER_KEY);
  const apps = ctx.value(PORTFOLIO_APPS, SCALAR_MEMBER_KEY);
  if (n === undefined || apps === undefined || n - apps <= RULE_TOLERANCE) return [];
  return [
    ruleEntry(
      'VR07',
      [toCellKey(APPS_RETIRED), toCellKey(PORTFOLIO_APPS)],
      `${formatNumber(n)} applications retired exceed the ${formatNumber(apps)} in the portfolio; retire at most ${formatNumber(apps)}.`,
    ),
  ];
}

// ------------------------------------------------------------------------------------------ VR09

/**
 * The foreign keys of line_item (schema.json tables.line_item) that VR09 checks, the line member
 * attribute v_dimension_members exposes each one as (tier3-data/migrations/0003_views.sql, and
 * `memberOfRow`), and the dimension it must name. A line in line_item column shape gives the key
 * under the column name instead.
 *
 * `seedText` marks the one attribute whose name seed files use for something else: a seed line's
 * `vendor` is the vendor's name as free text (line_item.vendor_text, e.g. 'Various'), and its key, if
 * any, is `vendor_key` (as in tools/testkit/seed/zz). Loaded through the seed, such a line has
 * `vendor` = its `vendor_key` or null, like every other line read from the database.
 */
export const LINE_ITEM_KEYS = [
  {
    column: 'pool_id',
    attribute: 'pool',
    dim: 'pool',
    noun: 'canonical pool',
    nullable: false,
    seedText: false,
  },
  {
    column: 'domain_key',
    attribute: 'domain',
    dim: 'domain',
    noun: 'domain',
    nullable: false,
    seedText: false,
  },
  {
    column: 'vendor_key',
    attribute: 'vendor',
    dim: 'vendor',
    noun: 'vendor',
    nullable: true,
    seedText: true,
  },
] as const;

/**
 * Attributes only a line of a seed file carries (docs/spec/seed/aa, tools/testkit/seed/zz): the seed's
 * names of the line_item text columns tenant_l1_label, driver_text and lever_hook_text, which
 * v_dimension_members does not expose. A line with any of them is a seed-file line.
 */
export const SEED_LINE_ATTRIBUTES = ['l1_label', 'driver_text', 'lever_hook'] as const;

const absent = (v: AttrValue | undefined): boolean => v === undefined || v === null || v === '';

/**
 * The value of a line_item key on a line member:
 * - the attribute, else the column name (pool, domain);
 * - for the vendor: `vendor_key` when the line carries it (line_item column shape, seed files with a
 *   key); else nothing for a seed-file line, whose `vendor` is free text; else `vendor`, which
 *   v_dimension_members and `memberOfRow` set to line_item.vendor_key.
 */
function lineKey(line: Member, k: (typeof LINE_ITEM_KEYS)[number]): AttrValue | undefined {
  if (!k.seedText) return absent(line[k.attribute]) ? line[k.column] : line[k.attribute];
  if (line[k.column] !== undefined) return line[k.column];
  if (SEED_LINE_ATTRIBUTES.some((a) => line[a] !== undefined)) return undefined;
  return line[k.attribute];
}

/**
 * VR09: every line's pool is a canonical pool, its domain is a domain member and its vendor key, when
 * set, is a vendor member (`lineKey` reads each). One entry per line and key, pointing at the line
 * (`line[it_001]`).
 */
export function vr09LineItemKeys(state: ValidationState): ValidationEntry[] {
  const ctx = contextOf(state);
  return ctx.members(LINE_ITEM_DIM).flatMap((line) =>
    LINE_ITEM_KEYS.flatMap((k) => {
      const raw = lineKey(line, k);
      if (absent(raw)) {
        if (k.nullable) return [];
        return [
          ruleEntry(
            'VR09',
            [toCellKey(LINE_ITEM_DIM, line.id)],
            `Line ${line.id} has no ${k.noun}; assign an existing ${k.noun}.`,
          ),
        ];
      }
      if (typeof raw === 'string' && ctx.member(k.dim, raw)) return [];
      return [
        ruleEntry(
          'VR09',
          [toCellKey(LINE_ITEM_DIM, line.id)],
          `Line ${line.id} names ${k.noun} '${String(raw)}', which does not exist; pick an existing ${k.noun}.`,
        ),
      ];
    }),
  );
}
