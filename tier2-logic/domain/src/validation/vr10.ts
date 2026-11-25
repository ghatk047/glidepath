/**
 * VR10: corp inputs present for every year an expression uses.
 *
 * Each node is expanded over its dims (or its `members` subset) as the engine does, the case that
 * applies to each cell is chosen, and the corporate inputs the cell's expression reads are resolved
 * statically, as `deps` in docs/spec/reference/engine.py: explicit indexes (`corp.gdp[year.in]`,
 * `corp.debt_chg['fy25']`, `corp.lab_hc_g[lgroup, year.in]`), implicit indexing, and aggregates
 * filtered by their `where`. Both branches of an `IF` count. An input cell a cell reads but no level
 * sets is a violation: `corp.asm_g` needs fy26 and fy27 (fy25 is the base-year case), not fy25.
 */
import type { AttrValue, DimId, MemberId, NodeDef, NodeId, VarId } from '@glidepath/spec';
import type { MemberKey } from '../member-key';
import { ruleEntry, type ValidationEntry } from './catalog';
import { parseExpression, referencedNames, type Ast } from './expr';
import {
  contextOf,
  formatList,
  memberKeyLabel,
  toCellKey,
  variableLabel,
  type RuleContext,
  type ValidationState,
} from './state';

/** The layer of the corporate model's inputs (formula_graph.json `layers`): the `corp.` variables. */
export const CORPORATE_LAYER = 'corporate';

/** A bound variable: a node dim (named after its dim) or an aggregate's variable. Innermost last. */
interface Binding {
  readonly name: string;
  readonly dim: DimId;
  readonly member: MemberId;
}
type Env = readonly Binding[];

/** A reference whose cell cannot be determined statically (a model or member-attribute problem). */
class Unresolvable extends Error {}

const lookup = (env: Env, name: string): Binding | undefined =>
  env.findLast((b) => b.name === name);

/** The expression a node uses for one cell: the first case whose `when` matches, else `expr`. */
function pickExpression(
  node: NodeDef,
  bind: Readonly<Record<DimId, MemberId>>,
): string | undefined {
  for (const c of node.cases ?? []) {
    if (c.when === null || Object.entries(c.when).every(([d, ms]) => ms.includes(bind[d] ?? ''))) {
      return c.expr;
    }
  }
  return node.expr;
}

/** The member bindings of a node's cells, in member order (engine.py `combos`). */
function cellsOf(ctx: RuleContext, node: NodeDef): Record<DimId, MemberId>[] {
  let out: Record<DimId, MemberId>[] = [{}];
  for (const d of node.dims) {
    const subset = node.members?.[d];
    const ids = subset && subset.length > 0 ? subset : ctx.members(d).map((m) => m.id);
    out = out.flatMap((b) => ids.map((id) => ({ ...b, [d]: id })));
  }
  return out;
}

const truthy = (v: AttrValue | undefined): boolean =>
  Array.isArray(v) ? v.length > 0 : Boolean(v);
const asNumber = (v: AttrValue | undefined): number =>
  typeof v === 'boolean' ? Number(v) : (v as number);
const same = (a: AttrValue | undefined, b: AttrValue | undefined): boolean => {
  const x = typeof a === 'boolean' ? Number(a) : a;
  const y = typeof b === 'boolean' ? Number(b) : b;
  if (typeof x === 'object' || typeof y === 'object')
    return JSON.stringify(x) === JSON.stringify(y);
  return x === y;
};

interface Usage {
  /** Input cells read, by corp variable: member key -> the nodes that read it. */
  readonly needed: Map<VarId, Map<MemberKey, Set<NodeId>>>;
  /** References that cannot be resolved, by corp variable: the cells and the first reason. */
  readonly unresolved: Map<VarId, { readonly cells: Set<string>; readonly reason: string }>;
}

class CorpReader {
  readonly usage: Usage = { needed: new Map(), unresolved: new Map() };
  private readonly symbols: ReadonlySet<string>;
  private readonly dimsOf: ReadonlyMap<VarId, readonly DimId[]>;

  constructor(
    private readonly ctx: RuleContext,
    private readonly corp: ReadonlySet<VarId>,
  ) {
    const { variables, nodes } = ctx.state.bundle;
    this.symbols = new Set([...variables.map((v) => v.id), ...nodes.map((n) => n.id)]);
    this.dimsOf = new Map(variables.map((v) => [v.id, v.dims]));
  }

  mentionsCorp(ast: Ast): boolean {
    for (const name of referencedNames(ast)) if (this.corp.has(name)) return true;
    return false;
  }

  /** Record the corp cells `ast` reads in the cell `cell` of `node`. */
  read(ast: Ast, env: Env, node: NodeId, cell: string): void {
    switch (ast.k) {
      case 'num':
      case 'str':
        return;
      case 'neg':
        return this.read(ast.arg, env, node, cell);
      case 'bin':
        this.read(ast.left, env, node, cell);
        return this.read(ast.right, env, node, cell);
      case 'call':
        return ast.args.forEach((a) => this.read(a, env, node, cell));
      case 'agg': {
        const body = ast.body;
        if (body === null || !this.mentionsCorp(body)) return;
        for (const m of this.ctx.members(ast.dim)) {
          const inner = [...env, { name: ast.variable, dim: ast.dim, member: m.id }];
          if (ast.where !== null && !truthy(this.value(ast.where, inner))) continue;
          this.read(body, inner, node, cell);
        }
        return;
      }
      case 'ref': {
        if (ast.index === null && this.isBoundOrAttribute(ast.name, env)) return;
        if (!this.corp.has(ast.name)) return;
        try {
          const key = this.memberKeyOf(ast.name, ast.index, env);
          const byKey = this.usage.needed.get(ast.name) ?? new Map<MemberKey, Set<NodeId>>();
          this.usage.needed.set(ast.name, byKey.set(key, (byKey.get(key) ?? new Set()).add(node)));
        } catch (e) {
          if (!(e instanceof Unresolvable)) throw e;
          const u = this.usage.unresolved.get(ast.name) ?? { cells: new Set(), reason: e.message };
          this.usage.unresolved.set(ast.name, { ...u, cells: u.cells.add(cell) });
        }
        return;
      }
    }
  }

  private isBoundOrAttribute(name: string, env: Env): boolean {
    if (lookup(env, name)) return true;
    const dot = name.indexOf('.');
    return dot > 0 && !this.symbols.has(name) && lookup(env, name.slice(0, dot)) !== undefined;
  }

  /** A bound variable's member attribute (`year.in`), or undefined when `name` is not one. */
  private attribute(name: string, env: Env): { found: boolean; value: AttrValue | undefined } {
    const dot = name.indexOf('.');
    const b = dot > 0 && !this.symbols.has(name) ? lookup(env, name.slice(0, dot)) : undefined;
    if (!b) return { found: false, value: undefined };
    return { found: true, value: this.ctx.member(b.dim, b.member)?.[name.slice(dot + 1)] };
  }

  /** The member key of a corp reference in `env`; throws Unresolvable. */
  private memberKeyOf(name: VarId, index: readonly Ast[] | null, env: Env): MemberKey {
    const dims = this.dimsOf.get(name) ?? [];
    if (index === null) {
      return dims
        .map((d) => {
          const b = env.findLast((x) => x.dim === d);
          if (!b) throw new Unresolvable(`no ${d} is bound to index it`);
          return b.member;
        })
        .join(',');
    }
    if (index.length !== dims.length) {
      throw new Unresolvable(`it takes ${dims.length} index(es), not ${index.length}`);
    }
    return index.map((a) => this.indexMember(a, env)).join(',');
  }

  /** One index: a member literal, a bound variable or a bound variable's attribute. */
  private indexMember(a: Ast, env: Env): MemberId {
    if (a.k === 'str') return a.value;
    if (a.k === 'ref' && a.index === null) {
      const b = lookup(env, a.name);
      if (b) return b.member;
      const attr = this.attribute(a.name, env);
      if (attr.found) {
        if (attr.value === undefined || attr.value === null) {
          const dot = a.name.indexOf('.');
          const owner = lookup(env, a.name.slice(0, dot))!;
          throw new Unresolvable(
            `${owner.dim} '${owner.member}' has no attribute '${a.name.slice(dot + 1)}'`,
          );
        }
        return String(attr.value);
      }
    }
    throw new Unresolvable('an index must be a member, a bound variable or its attribute');
  }

  /** The static value of a `where` clause (engine.py `where_ok`): members, attributes, literals. */
  private value(a: Ast, env: Env): AttrValue | undefined {
    switch (a.k) {
      case 'num':
      case 'str':
        return a.value;
      case 'neg':
        return -asNumber(this.value(a.arg, env));
      case 'bin':
        return this.binary(a.op, this.value(a.left, env), this.value(a.right, env));
      case 'call':
        return this.call(a.fn, a.args, env);
      case 'agg': {
        const values: AttrValue[] = [];
        for (const m of this.ctx.members(a.dim)) {
          const inner = [...env, { name: a.variable, dim: a.dim, member: m.id }];
          if (a.where !== null && !truthy(this.value(a.where, inner))) continue;
          values.push(a.fn === 'COUNT' || a.body === null ? 1 : this.value(a.body, inner)!);
        }
        const nums = values.map(asNumber);
        if (a.fn === 'MAXOVER') return nums.length ? Math.max(...nums) : 0;
        if (a.fn === 'MINOVER') return nums.length ? Math.min(...nums) : 0;
        return nums.reduce((s, x) => s + x, 0);
      }
      case 'ref': {
        if (a.index === null) {
          const b = lookup(env, a.name);
          if (b) return b.member;
          const attr = this.attribute(a.name, env);
          if (attr.found) return attr.value ?? null;
        }
        throw new Error(
          `VR10: a where clause reads ${a.name}; it may only use dimension attributes and bound variables`,
        );
      }
    }
  }

  private binary(op: string, l: AttrValue | undefined, r: AttrValue | undefined): AttrValue {
    const x = asNumber(l);
    const y = asNumber(r);
    switch (op) {
      case '+':
        return x + y;
      case '-':
        return x - y;
      case '*':
        return x * y;
      case '/':
        return x / y;
      case '^':
        return x ** y;
      case '==':
        return Number(same(l, r));
      case '!=':
        return Number(!same(l, r));
      case '<':
        return Number((l as number) < (r as number));
      case '<=':
        return Number((l as number) <= (r as number));
      case '>':
        return Number((l as number) > (r as number));
      case '>=':
        return Number((l as number) >= (r as number));
    }
    throw new Error(`VR10: unknown operator ${op}`);
  }

  private call(fn: string, args: readonly Ast[], env: Env): AttrValue | undefined {
    const arg = (i: number): AttrValue | undefined => {
      const a = args[i];
      return a === undefined ? undefined : this.value(a, env);
    };
    switch (fn) {
      case 'IF':
        return truthy(arg(0)) ? arg(1) : arg(2);
      case 'SAFEDIV': {
        const d = asNumber(arg(1));
        return d === 0 ? (args.length > 2 ? arg(2) : 0) : asNumber(arg(0)) / d;
      }
    }
    const values = args.map((a) => this.value(a, env));
    const nums = values.map(asNumber);
    switch (fn) {
      case 'MIN':
        return Math.min(...nums);
      case 'MAX':
        return Math.max(...nums);
      case 'ABS':
        return Math.abs(nums[0]!);
      case 'AND':
        return Number(values.every(truthy));
      case 'OR':
        return Number(values.some(truthy));
      case 'NOT':
        return Number(!truthy(values[0]));
    }
    throw new Error(`VR10: unknown function ${fn}`);
  }
}

/** The nodes of a set, in model order, by id. */
function nodeList(order: ReadonlyMap<NodeId, number>, nodes: Iterable<NodeId>): string {
  const ids = [...new Set(nodes)].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
  return formatList(ids);
}

/**
 * VR10: every corporate input cell an expression reads has a value. One entry per corp variable with
 * missing cells (pointing at those cells), and one per corp variable some cell cannot index (pointing
 * at those node cells).
 */
export function vr10CorpInputYears(state: ValidationState): ValidationEntry[] {
  const ctx = contextOf(state);
  const corpDefs = state.bundle.variables.filter((v) => v.layer === CORPORATE_LAYER);
  if (corpDefs.length === 0) return [];
  const reader = new CorpReader(ctx, new Set(corpDefs.map((v) => v.id)));

  for (const node of state.bundle.nodes) {
    const sources = [node.expr, ...(node.cases ?? []).map((c) => c.expr)];
    if (!sources.some((s) => s !== undefined && reader.mentionsCorp(parseExpression(s)))) continue;
    for (const bind of cellsOf(ctx, node)) {
      const src = pickExpression(node, bind);
      if (src === undefined) continue;
      const ast = parseExpression(src);
      if (!reader.mentionsCorp(ast)) continue;
      const env: Env = node.dims.map((d) => ({ name: d, dim: d, member: bind[d]! }));
      const cell = toCellKey(node.id, node.dims.map((d) => bind[d]).join(','));
      reader.read(ast, env, node.id, cell);
    }
  }

  const order = new Map(state.bundle.nodes.map((n, i) => [n.id, i]));
  const { needed, unresolved } = reader.usage;
  return corpDefs.flatMap((def) => {
    const out: ValidationEntry[] = [];
    const label = variableLabel(ctx, def.id);
    const bad = unresolved.get(def.id);
    if (bad) {
      const cells = [...bad.cells];
      out.push(
        ruleEntry(
          'VR10',
          cells,
          `${formatList(cells)} cannot read ${label}: ${bad.reason}; fix the member attributes or the expression.`,
        ),
      );
    }
    const byKey = needed.get(def.id) ?? new Map<MemberKey, Set<NodeId>>();
    const missing = [...byKey.keys()]
      .filter((k) => ctx.value(def.id, k) === undefined)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    if (missing.length > 0) {
      const users = missing.flatMap((k) => [...byKey.get(k)!]);
      const verb = new Set(users).size === 1 ? 'needs' : 'need';
      const what =
        def.dims.length === 0
          ? `${label} has no value`
          : `${label} has no value for ${formatList(missing.map((k) => memberKeyLabel(ctx, def.dims, k)))}`;
      out.push(
        ruleEntry(
          'VR10',
          missing.map((k) => toCellKey(def.id, k)),
          `${what}; ${nodeList(order, users)} ${verb} it.`,
        ),
      );
    }
    return out;
  });
}
