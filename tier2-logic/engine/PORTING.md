# Engine port map

How `docs/spec/reference/engine.py` (344 lines, the oracle) becomes `tier2-logic/engine`. Written by ENG-01; ENG-02…ENG-11 port from it (ADR-005: port, do not re-derive; ADR-020: parity gate).

Rules for using this file:

- **engine.py wins.** If this file and engine.py disagree on a number, engine.py is right; fix this file in the same PR.
- **Checked, not prose.** `src/porting-map.spec.ts` fails if a def/class in engine.py is missing here or has moved (line numbers), `src/porting-semantics.spec.ts` checks §3, `src/porting-harness.spec.ts` checks §6 against `golden_results.json` and `parity_report.json`.
- **Measured** facts were measured with the unchanged engine.py on CPython 3.13.18 and the AA seed (`docs/spec/seed/aa`): 307 nodes, 194 variables, 3,370 cells, 17,843 dependency edges, 1,318 input cells, 381 distinct expressions.

| item | builds | read first |
|---|---|---|
| ENG-02 | `src/parse/*` | §2 rows `TOK`…`parse`; §3 S11, S12, S13, S28 |
| ENG-03 | `src/expand/*` | §2 rows `Model.__init__`…`Model.deps`, `Model._expand`; §3 S01, S05, S08–S10, S14, S19–S21, S26, S27 |
| ENG-04 | `src/compile/*` | §1 pipeline; §3 S02, S06, S22 |
| ENG-05 | `src/eval/*` (not rerun) | §3 S02–S04, S06, S07, S13, S15–S18, S20, S24, S25; §5 |
| ENG-06 | `tools/parity` golden + replay | §6 |
| ENG-07…ENG-11 | rerun, batch, explain, fuzz, bench | §3 S23; §6 Fuzz; 03 §1 Modes |

## 1. Module layout and pipeline

```
ModelBundle (@glidepath/spec) + TenantMembers
  └─ parse      src/parse     each distinct expression once → Ast                       ENG-02
  └─ expand     src/expand    cells (node × combos), case per cell, refs → cell keys,       ENG-03
                              where → member lists, constants folded, deps per cell
  └─ toposort   src/compile   Kahn FIFO order; cycle = compile error                        ENG-04
  └─ lower      src/compile   one Float64Array slot per input/node cell; flat program;      ENG-04
                              IF/SAFEDIV keep jumps; aggregates = member-ordered index lists
  └─ adjacency  src/compile   forward + reverse CSR (rerun, upstream, downstream)           ENG-04
  = CompiledModel
      evaluate(values, overrides?)   src/eval     Model.run + Model.ev                      ENG-05
      inputHash(values, overrides)   src/eval                                               ENG-05
      rerun(prev, changes)           src/eval     Model.rerun                               ENG-07
      evaluateBatch(base, vectors)   src/batch    SoA lanes                                 ENG-08
      upstream / downstream / explain src/explain views over the CSR                        ENG-09
```

| module | contents | item |
|---|---|---|
| `src/index.ts` | public API of 03 §1 (ENG-01: types + `compile` stub) | ENG-01 → ENG-04 |
| `src/types.ts`, `src/errors.ts` | `CompiledModel`, `TenantData`, `Evaluation`, `Change`, `BatchInput`, `BatchResult`, `Explanation`, `EngineError` | ENG-01 |
| `src/pending.ts` | `pendingModel()`: every method throws `not implemented` (skeleton, deleted by ENG-04) | ENG-01 |
| `src/parse/tokenize.ts` | `TOKEN_RE`, `Token { kind, value, pos }`, `tokenize()` | ENG-02 |
| `src/parse/ast.ts` | `Ast` union (below), `toPyTuple(ast)` for the AST parity fixture | ENG-02 |
| `src/parse/parser.ts` | `BINDING_POWER`, `AGGREGATES`, `class Parser` | ENG-02 |
| `src/parse/parse.ts` | `parse(src, cache?)`, `ParseCache` | ENG-02 |
| `src/expand/members.ts` | `MemberTable`: member ids per dim in tenant order, attribute lookup | ENG-03 |
| `src/expand/symbols.ts` | `symbolDims(bundle)`: id → dims for variables and nodes | ENG-03 |
| `src/expand/keys.ts` | `cellKey()`, `combos()` | ENG-03 |
| `src/expand/cases.ts` | `pickExpr()` | ENG-03 |
| `src/expand/resolve.ts` | `Env`, `resolveIndex()`, `resolveRef()`, `evalStatic()`, `whereOk()`, `resolveAst()` | ENG-03 |
| `src/expand/expand.ts` | `expand(bundle, members)`: cells in expansion order with chosen expression, resolved AST, deps, diagnostics | ENG-03 |
| `src/compile/toposort.ts`, `lower.ts`, `csr.ts`, `compile.ts` | `topoSort()`, `lower()`, `buildAdjacency()`, `compile()` | ENG-04 |
| `src/eval/pyops.ts` | `pyTruthy`, `pyMin`, `pyMax`, `pySum`, `pyDiv`, `pySafeDiv`, `pyPow`, `pyCompare` | ENG-05 |
| `src/eval/evaluate.ts`, `inputs.ts`, `input-hash.ts` | `evaluate()`, `evalNode()`, `resolveInputs()`, `inputHash()` | ENG-05 |
| `src/eval/rerun.ts` | `rerun()` | ENG-07 |
| `src/batch/`, `src/explain/` | `evaluateBatch()`; `upstream()`, `downstream()`, `explain()` | ENG-08, ENG-09 |

Tests sit next to the code as `src/**/<name>.spec.ts`; Python-generated fixtures go in `test/fixtures/` (ignored by ESLint, committed, regenerated when the spec changes; §6 Fixtures).

Recommended AST (ENG-02 may rename fields; `toPyTuple` must give back the Python tuple shape):

```ts
type Ast =
  | { kind: 'num'; value: number; pos: number }
  | { kind: 'str'; value: string; pos: number }
  | { kind: 'neg'; arg: Ast; pos: number }
  | { kind: 'bin'; op: '==' | '!=' | '<' | '<=' | '>' | '>=' | '+' | '-' | '*' | '/' | '^'; left: Ast; right: Ast; pos: number }
  | { kind: 'call'; fn: string; args: Ast[]; pos: number }
  | { kind: 'agg'; fn: 'SUM' | 'COUNT' | 'MAXOVER' | 'MINOVER'; var: string; dim: string; where: Ast | null; body: Ast | null; pos: number }
  | { kind: 'ref'; name: string; idx: Ast[] | null; pos: number };
```

The expander's resolved AST replaces `ref` by `{ kind: 'cell', key }` (node cell, input cell or dangling key, S20), bound variables and attributes by `{ kind: 'const', value }` (S26), and `agg` by `{ kind: 'agg', fn, terms }` with one resolved body per member that passed `where`, in member order (`COUNT`: the count).

## 2. Port map

One row per def, class and constant in engine.py, at its line. Python `get=None` calls of `ev` (static `where`) are `evalStatic`; the runtime path is `evalNode`.

| engine.py | line | TS module | TS function | item | notes |
|---|---|---|---|---|---|
| `TOK` | 20 | `src/parse/tokenize.ts` | `TOKEN_RE` | ENG-02 | Same pattern, sticky flag `y`; ordered alternation as in Python (S28). |
| `AGG` | 21 | `src/parse/parser.ts` | `AGGREGATES` | ENG-02 | `SUM`, `COUNT`, `MAXOVER`, `MINOVER`; upper case, only when followed by `(`. |
| `tokenize` | 24 | `src/parse/tokenize.ts` | `tokenize(src): Token[]` | ENG-02 | Strips first; every number is a float64; string value without quotes; ends with an `end` token. `SYNTAX` error with position and source. |
| `Parser` | 41 | `src/parse/parser.ts` | `class Parser` | ENG-02 | Pratt parser over the token list. |
| `Parser.BP` | 42 | `src/parse/parser.ts` | `BINDING_POWER` | ENG-02 | Comparisons 10, `+ -` 20, `* /` 30, unary minus 40 (in `nud`), `^` 50. |
| `Parser.__init__` | 44 | `src/parse/parser.ts` | `constructor(src)` | ENG-02 | Tokenizes; keeps `src` for messages. |
| `Parser.peek` | 47 | `src/parse/parser.ts` | `Parser.peek()` | ENG-02 | Compares kind and value (`('op', '(')`). |
| `Parser.nxt` | 48 | `src/parse/parser.ts` | `Parser.next()` | ENG-02 | |
| `Parser.expect` | 50 | `src/parse/parser.ts` | `Parser.expect(kind, value?)` | ENG-02 | Message `expected <value or kind>, got <token>` plus position. |
| `Parser.parse` | 56 | `src/parse/parser.ts` | `Parser.parse(): Ast` | ENG-02 | `expr(0)` then `end`. |
| `Parser.expr` | 59 | `src/parse/parser.ts` | `Parser.expr(rbp)` | ENG-02 | Loop while next is a binary operator with `bp > rbp`; right side `expr(bp)`, `expr(49)` for `^` (S11). |
| `Parser.nud` | 71 | `src/parse/parser.ts` | `Parser.nud(tok)` | ENG-02 | num, str, `-` → `neg(expr(40))`, `+` → operand, `( … )` (no node), call, aggregate `fn(var in dim [where e] [, body])`, ref with optional `[i, …]` (S12). |
| `_AST` | 110 | `src/parse/parse.ts` | `ParseCache` | ENG-02 | Python caches globally by source text; TS caches per compile (D6). |
| `parse` | 111 | `src/parse/parse.ts` | `parse(src, cache?)` | ENG-02 | Each distinct expression parsed once (381 in AA). |
| `Model` | 117 | `src/compile/compile.ts` | `compile()` → `CompiledModel` | ENG-04 | The compiled program replaces the Python object; immutable and shared (ModelCache). |
| `Model.__init__` | 118 | `src/compile/compile.ts` | `compile(bundle, members)` | ENG-04 | JSON loading is `@glidepath/spec` `loadModelBundle`; `members`/`attrs` → `MemberTable` (ENG-03); `values`/`scenarios` → `TenantData.values` from data-access, or `resolveInputs` in tests; `dims_of` → `symbolDims` (ENG-03). |
| `Model.key` | 133 | `src/expand/keys.ts` | `cellKey(name, members)` | ENG-03 | `id` or `id[m1,m2]` (S19). |
| `Model.combos` | 136 | `src/expand/keys.ts` | `combos(dims, table, subset?)` | ENG-03 | First dim outermost; subset order and empty-list fallback (S09). |
| `Model.pick_expr` | 144 | `src/expand/cases.ts` | `pickExpr(node, bind)` | ENG-03 | First matching case, then `expr`, else NO_CASE (S08). |
| `Model._idx` | 153 | `src/expand/resolve.ts` | `resolveIndex(ast, env)` | ENG-03 | String literal, bound var, or attribute via `str()` (S14, S21). |
| `Model.resolve` | 165 | `src/expand/resolve.ts` | `resolveRef(name, idx, env)` | ENG-03 | UNKNOWN_SYMBOL; explicit index count; implicit innermost binding (S01). |
| `Model.where_ok` | 180 | `src/expand/resolve.ts` | `whereOk(ast, env)` | ENG-03 | `pyTruthy(evalStatic(...))`; any symbol → WHERE_NOT_STATIC (S05). |
| `Model.deps` | 183 | `src/expand/resolve.ts` | `resolveAst(ast, env, deps)` | ENG-03 | One walk builds the resolved AST and the dep set; both IF branches count; aggregates only over members passing `where`. Compare as sets with Python `cdeps`. |
| `Model.ev` | 205 | `src/eval/evaluate.ts` | `evalNode(node, slots)` | ENG-05 | Runtime semantics in `src/eval/pyops.ts` (S02–S04, S06, S07, S13, S16–S18, S24); static path `evalStatic` (ENG-03). |
| `Model._expand` | 264 | `src/expand/expand.ts` | `expand(bundle, members)` | ENG-03 | Cells in expansion order (S19) with deps; the topological half (L276-293) is `topoSort()` in `src/compile/toposort.ts`, ENG-04 (S22). |
| `Model.input_cells` | 296 | `src/eval/inputs.ts` | `resolveInputs(bundle, tenantValues, scenario?, extra?)` | ENG-05 | Pure mirror for tests and `tools/parity`; production gets `v_inputs_resolved` (S25). |
| `Model.input_cells.put` | 298 | `src/eval/inputs.ts` | `putValue(cells, variable, value)` | ENG-05 | Per-cell write; scalar for a dimensioned variable → BAD_INPUT. |
| `Model.run` | 317 | `src/eval/evaluate.ts` | `evaluate(values, overrides?)` | ENG-05 | Program in topological order; overrides skip evaluation (S15); MISSING names the cell being computed (S20). |
| `Model.rerun` | 330 | `src/eval/rerun.ts` | `rerun(prev, changes)` | ENG-07 | Dirty closure over the reverse CSR in topological order, early stop (S23, D3). |

## 3. Semantics that are easy to get wrong

S01–S15 are the ones ENG-01 must list; S16–S29 were found while mapping and are just as binding. "Planned test" is `file › test name`; the owning item writes it.

| id | semantic | engine.py | TS rule | planned test | item |
|---|---|---|---|---|---|
| S01 | **implicit indexing (innermost bound var per dim)** | `resolve` L171-177; env copies L195, L245 | A dimensioned symbol written without `[]` gets, for each of its dims in order, the member of the *last-inserted* env binding whose dim matches (it matches on the binding's dim, not its name). Env = node dims (in `dims` order), then aggregate variables (outer to inner). Keep env as a `Map` and bind with `new Map(env).set(v, b)`: re-binding a name keeps its original position, exactly like the Python dict; never delete and re-insert. No binding for a dim → compile error IMPLICIT_INDEX. Indexing is all or nothing: `[…]` must give exactly `dims.length` indices (L169). AA: `vp.target` (dims `[vp]`) contains `SUM(u in vp, vp.growth[u])`; a bare `vp.growth` inside that SUM would read `[u]`, outside it the node's `vp` (same in `vp.usage_default`). | `expand.spec.ts` › implicit index takes the innermost binding of each dim | ENG-03 |
| S02 | **lazy IF** | `ev` L227-228 | Evaluate the condition (S16), then only the taken branch; an error in the untaken branch never raises. Dependencies still include both branches (static, L189-191). Scalar program: conditional jumps; batch: per-lane select with errors masked in untaken lanes (ENG-08). AA: `lev.ramp_factor` divides by `2 * lev.ramp` only in its taken branch. | `evaluate.spec.ts` › IF evaluates only the taken branch | ENG-05 |
| S03 | **SAFEDIV alt default 0** | `ev` L229-232 | Evaluate the divisor first. If it `== 0` (also −0): return the alt, evaluated only now, or 0 when there are two arguments; the numerator is never evaluated. Otherwise numerator / divisor (a NaN divisor gives NaN, not the alt). All 21 AA uses pass an explicit alt. | `evaluate.spec.ts` › SAFEDIV returns alt (default 0) on a zero divisor without evaluating the numerator | ENG-05 |
| S04 | **'/' by zero raises** | `ev` L211, L215-217 | Both operands are evaluated left to right, then a divisor `== 0` (±0) throws DIV_ZERO with the cell key (Python `ZeroDivisionError`). Never ±Infinity. NaN or ±Infinity divisors do not throw. | `evaluate.spec.ts` › '/' by zero throws DIV_ZERO naming the cell | ENG-05 |
| S05 | **static where-filters** | `where_ok` L180-181; `deps` L192-198; `ev` L246 | `where` sees only bound variables (outer ones too, e.g. `l.pool == pool`), attributes, literals, operators and functions. It is evaluated once per member at compile time with Python truthiness (S16) and becomes the aggregate's member list; members that fail it add nothing to deps or to the value. A symbol reference anywhere inside a `where` is a compile error WHERE_NOT_STATIC (Python fails only if that branch is evaluated). AA: 9 where-clauses, e.g. `AND(l.pool == 'airline_platforms', l.addr != 'locked')`, `p.third_party == 1` (attribute value is an integer). | `expand.spec.ts` › where-filters resolve at compile time and reject cell references | ENG-03 |
| S06 | **member order of sums** | `ev` L244, L248 | `SUM` runs over the tenant's full member list of its dim (`self.members[dim]`: never a node's `members` subset, never sorted) in `TenantData.members` order, skipping `where` failures, and adds with CPython `sum()`, which is **Neumaier-compensated since Python 3.12**. TS `pySum`: `f = 0 + x0`; for each next `x`: `t = f + x; c += abs(f) >= abs(x) ? (f - t) + x : (x - t) + f; f = t`; at the end `if (c !== 0 && Number.isFinite(c)) f += c`. Measured on the 5 presets (16,850 cell values): bitwise equal to CPython 3.13; naive left-to-right summation differs on 1,662 values (max 7.3e-12) and turns exact zeros non-zero (`lev.rr_check[L03]`, `vp.check`), which a later `SAFEDIV`, `IF` or `/` can blow up. Use `pySum` in every mode (scalar, rerun, batch per lane). | `pyops.spec.ts` › pySum adds in member order with Neumaier compensation, bitwise equal to CPython sum() | ENG-05 |
| S07 | **MAXOVER/MINOVER of empty = 0** | `ev` L247-250 | Over the members that pass `where`: `MAXOVER`/`MINOVER` fold with `pyMax`/`pyMin` (S18) in member order; no member gives 0. `COUNT` = number of members passing `where`, as a float. An empty `SUM` is 0. | `evaluate.spec.ts` › MAXOVER and MINOVER of an empty set are 0 | ENG-05 |
| S08 | **first matching case** | `pick_expr` L144-150 | Per cell, at compile time: walk `cases` in order; `when: null` (or `{}`) matches; otherwise every listed dim's bound member must be in its list. The first match wins (40 AA cells match more than one case); no match → the node's `expr`; neither → compile error NO_CASE. Each cell parses and depends only on its chosen expression. | `expand.spec.ts` › the first matching case wins, then expr | ENG-03 |
| S09 | **member subsets** | `combos` L136-142; `_expand` L269 | `members: {dim: […]}` expands only the listed members, in the *listed* order; dims not in the map use all tenant members; an empty list means all members (Python `or`); listed ids are not checked against the tenant. Unlisted members have no cell, so a reference to one is a dangling key (S20). Aggregates ignore subsets (S06). AA: 7 `val.*` nodes over `{year: ['fy27b', 'fy27it']}`. | `expand.spec.ts` › a members subset expands only the listed members in listed order | ENG-03 |
| S10 | **symbol ids win over attribute access** | `ev` L253-258; `deps` L201; `_idx` L159 | A bare name resolves in this order: (1) a bound variable → its member id (a string); (2) it contains `.`, is **not** a symbol id, and the part before the first `.` is bound → the attribute named by the rest (`l.pool`); (3) a symbol (node or input cell). So inside a node with dim `vp`, `vp.growth` is the node `vp.growth`, not attribute `growth` of the bound vp: 42 such references in AA (`vp.target`, `vp.eff_alloc`, `base.line_outlay` reading `line.amount`, …). | `expand.spec.ts` › a symbol id wins over attribute access on a bound variable | ENG-03 |
| S11 | **'^' right-assoc** | `Parser.expr` L67 | The right operand of `^` is parsed with bp 49, so `a^b^c` = `a^(b^c)`; every other binary operator is left-associative. Value semantics: S24. | `precedence.spec.ts` › '^' is right-associative | ENG-02 |
| S12 | **unary minus bp 40** | `Parser.nud` L75-76; `Parser.BP` L42 | Prefix `-` parses its operand with `expr(40)`: tighter than `* /` (30), looser than `^` (50): `-a^b` = `-(a^b)`, `-a*b` = `(-a)*b`, `2^-1` parses. Prefix `+` returns the operand itself (no AST node), so `+'x'` is a `str` node. | `precedence.spec.ts` › unary minus binds at 40 and unary plus adds no node | ENG-02 |
| S13 | **comparisons return 1/0** | `ev` L219-224; `Parser.BP` L42 | `== != < <= > >=` all have bp 10, are left-associative and do **not** chain like Python (`a < b < c` = `(a < b) < c`); each returns 1 or 0. Equality is strict: a string never equals a number (no JS `==` coercion); NaN compares false except `!=`. | `evaluate.spec.ts` › comparisons return 1 or 0 and do not chain | ENG-05 |
| S14 | **string literal indices** | `_idx` L155 | `pool.growth['software']` uses the literal verbatim as the member id at compile time; it is not checked against the members (a bad literal is a dangling key, S20). An index element may only be a string literal, a bound variable or a bound variable's attribute (S21); a number, symbol or expression is compile error BAD_INDEX. Explicit indices are positional: the member's dim is not checked. AA: 83 literal indices. | `expand.spec.ts` › a string literal index is used verbatim as the member id | ENG-03 |
| S15 | **node override replaces a cell** | `run` L322; `rerun` L341 | A pinned node cell takes the override value and its expression is **not evaluated** (its errors cannot raise); downstream cells read the pin. Only node cells can be pinned: an override on an input key or an unknown key is ignored, as in Python, and listed in the evaluation's diagnostics. (All 36 parity overrides are node cells.) | `evaluate.spec.ts` › an override replaces a node cell without evaluating it | ENG-05 |
| S16 | Python truthiness | `ev` L228, L237-239, L246 | `IF` conditions, `where`, `AND`/`OR`/`NOT` use Python `bool()`: a number is true iff `x != 0`, so **NaN is true** (JS: falsy); a string is true iff non-empty. Use `pyTruthy`, never `if (x)`. | `pyops.spec.ts` › pyTruthy treats NaN as true and only ±0 as false | ENG-05 |
| S17 | AND/OR/NOT are eager | `ev` L233, L237-239 | Every argument is evaluated, left to right, before the function runs, so an error in any argument raises even when the result is already known. Results are 1/0; `AND()` = 1, `OR()` = 0. Only `IF` and `SAFEDIV` are lazy. | `evaluate.spec.ts` › AND, OR and NOT evaluate every argument | ENG-05 |
| S18 | MIN/MAX are Python's | `ev` L234-235, L249-250 | `pyMin(xs)`: start with `xs[0]`, replace only when `x < r` (`pyMax`: `x > r`). Ties keep the first (`MIN(0, -0)` = 0), a leading NaN sticks, a later NaN is skipped. Not `Math.min`/`Math.max`, which differ on NaN and −0. | `pyops.spec.ts` › pyMin and pyMax keep the first of equal values and match Python on NaN | ENG-05 |
| S19 | cell keys and expansion order | `key` L133-134; `combos` L136-142; `_expand` L267-275 | Key = `id` for a scalar, else `id[m1,m2]` (comma, no spaces) = `variable_value.member_key`. Cells are created node by node in `formula_graph.json` order; combos are a cartesian product with the first dim outermost. This order seeds the topological sort (S22). | `keys.spec.ts` › cellKey and combos match Model.key and Model.combos | ENG-03 |
| S20 | dangling refs and missing inputs fail lazily | `deps` L202; `_expand` L282; `run` L324-327 | A resolved key that is neither a node cell nor a provided input (bad literal, subset gap, missing tenant value) is not a load error: Python raises `KeyError("while computing <cell>: missing …")` only when the read executes (so not inside an untaken IF branch). TS compiles such a read to a MISSING instruction and lists it in compile diagnostics; input slots carry a presence flag checked only on read. AA has no dangling key (measured). | `evaluate.spec.ts` › a missing input raises MISSING only when read, naming the cell being computed | ENG-05 |
| S21 | attribute values | `_idx` L160-162; `ev` L255-258 | As an index, an attribute goes through Python `str()`: strings verbatim, integers in decimal; any other type (fractional number, bool, null, list) is compile error BAD_INDEX (Python would give `'True'`, `'None'`, `"['L05']"`). As a value the raw JSON value is used. AA reads `drv`, `pool`, `addr`, `preferred`, `third_party`, `it` as values and `in`, `prev`, `domain`, `pool`, `addr`, `alloc_key` as indices (all strings, except the integer flags). A missing attribute in a value position raises MISSING only when evaluated; in a `where` or an index it is a compile error. | `expand.spec.ts` › an attribute index is stringified like Python str() | ENG-03 |
| S22 | topological order | `_expand` L276-293 | Kahn's algorithm with a FIFO queue: start with every zero-in-degree cell in expansion order; when a cell is done, visit its users in expansion order. In-degree counts *distinct* deps that are node cells (inputs and dangling keys do not count). The order is deterministic (no hash order), so TS can match `Model.order` exactly and fail on the same first cell. A cycle is compile error CYCLE naming up to 10 cells with in-degree > 0, in expansion order. | `toposort.spec.ts` › Kahn order equals Model.order | ENG-04 |
| S23 | rerun | `rerun` L330-344 | Dirty = changed inputs and every override key; recompute their full downstream closure in topological order, re-applying all overrides. TS does **not** copy two Python quirks (D3): an override left out of the call keeps its stale pin, and `changes` may name node cells. ENG-07 adds early stop when a recomputed value has the same float64 bit pattern as before (so −0 ≠ 0, and NaN = NaN only with the same payload); a `variable` change naming a node cell is BAD_INPUT, an `override` change on any other key is ignored and reported like evaluate's. | `rerun-equivalence.spec.ts` › rerun equals evaluate bitwise after random changes | ENG-07 |
| S24 | '^' numeric semantics | `ev` L218 | Python float `**`: `0 ** negative` raises (DIV_ZERO); a negative base with a non-integer exponent gives a complex number (TS throws COMPLEX, D5); a finite overflow raises (OVERFLOW; JS gives Infinity); `1 ** y` = 1 and `(-1) ** ±Infinity` = 1 even for NaN or infinite `y` (JS: NaN). `^` is not used in the AA graph but is part of the language. | `pyops.spec.ts` › pyPow follows Python float pow | ENG-05 |
| S25 | input precedence | `input_cells` L296-315 | Tenant values < scenario values < extra values, merged **per cell** (a scenario `{member: v}` dict replaces only its listed members); overrides: scenario < extra. Unknown variable or scenario → BAD_INPUT; a scalar for a dimensioned variable → BAD_INPUT; TS also rejects a dict for a scalar variable (Python keeps the last entry, D7). In production `v_inputs_resolved` does this merge; `resolveInputs` serves tests and `tools/parity`. | `inputs.spec.ts` › resolveInputs merges per cell like Model.input_cells | ENG-05 |
| S26 | strings stay in comparisons | `ev` L208, L212-214, L254 | Bound variables, attributes and string literals are compile-time constants per cell: fold them. A string may only be compared with another string or used as an index. A string that reaches arithmetic, a function argument other than a comparison, an IF result or a cell value is compile error TYPE (Python would concatenate or raise `TypeError` at run time). AA: none. | `expand.spec.ts` › a string outside a comparison or index is a compile error | ENG-03 |
| S27 | functions and aggregates are checked at compile time | `ev` L240, L247; `deps` L197; `Parser.nud` L82-92 | Known functions and arity: IF 3, SAFEDIV 2-3, MIN/MAX ≥ 1, ABS 1, AND/OR any, NOT 1; anything else is UNKNOWN_FUNCTION or ARITY at compile time (Python: `NameError`/`IndexError` only when evaluated, D1). `COUNT` with a body and `SUM`/`MAXOVER`/`MINOVER` without one are compile errors (Python adds a COUNT body to deps but never evaluates it; a missing body crashes at run time). AA uses only IF (56), SAFEDIV (21), AND (4), MAX (4) and SUM (44). | `expand.spec.ts` › unknown functions, wrong arity and malformed aggregates fail at compile time | ENG-03 |
| S28 | tokenizer edge cases | `TOK` L20; `tokenize` L24-38 | Numbers `1.`, `.5`, `1.e5`, `1e-3` (ordered alternation; the same regex in JS with the `y` flag); strings `'…'` have no escapes; identifiers may contain `.` after the first character (`lev.L01.rr`); only the listed operators (no `=`, `!`, `%`, `&&`). Python `\d`/`\s` are Unicode-aware and JS's are not: assert every spec expression is ASCII (all 381 AA expressions are). Whitespace is allowed before `(` and `[` (`f (x)` is a call). Python positions are offsets in the stripped string; TS reports positions in the original. | `tokenizer.spec.ts` › tokenizer matches engine.py TOK on edge cases | ENG-02 |
| S29 | golden values are rounded | `run_tests.py` L106-108 | `golden_results.json` stores `round(x, 6)`. Comparing raw TS values at 1e-6 relative fails 77 of 760 (e.g. `base.locked_share` 0.20791630729946292 vs 0.207916; measured with Python's own values). Round the TS value exactly like Python `round(x, 6)` (correct rounding of the exact binary value, ties to even) before comparing: 0 misses. `toFixed(6)` is not enough (`0.0078125` → `0.007813`, Python `0.007812`); use the exact expansion from `toFixed(100)` and round half to even. | `golden.spec.ts` › TS values rounded like Python round(x, 6) match all 760 golden values | ENG-06 |

## 4. Deliberate deviations from engine.py

None changes a number `Model.run` produces for a model it accepts and evaluates without error. D3 departs from `Model.rerun` only where Python's rerun disagrees with its own `run`.

| id | TS behaviour | Python behaviour | why |
|---|---|---|---|
| D1 | Compile errors for unknown functions, wrong arity, malformed aggregates (S27), strings outside comparisons (S26), symbols in `where` (S05), non-string non-integer attribute indices (S21) | Raised only if the expression is evaluated, or never | Catch spec bugs at load. None occurs in AA; ENG-03 asserts AA compiles. |
| D2 | Every error carries an `EngineErrorCode`, the cell key and the source position | Only `KeyError` is wrapped with the cell (L326-327) | Debuggable errors; codes map to Python exception classes (§5) for the fuzz harness. |
| D3 | `rerun`: removing an override recomputes that cell; changes target inputs (`variable`) or overrides only | Stale pin kept unless downstream of a change; any key accepted | ENG-07 acceptance; `Change` union (§5). |
| D4 | float64 only | JSON integers stay Python ints: exact and unbounded (`int ** int`, big products); CPython `sum()` adds an int term that follows a float term without the Neumaier compensation (`sum([1e16, 1, 1]) == 1e16`, where `pySum` gives `1e16 + 2`); unary minus of int 0 is int 0 (TS: −0) | Same doubles for the AA presets (S06 measurement). The fuzz oracle (`tools/parity/fuzz_ref.py`) casts every input to `float`: tenant values, preset values and overrides, drawn values. Residual, measured at ENG-10 on aa and zz: with the cast no int reaches a `SUM`, an operator, a function result or a node cell; only member attributes stay as written, and an integer attribute used as a value (none today) would bring both effects back. `fuzz-oracle.spec.ts` shows both effects on the uncast engine and their removal. |
| D5 | `^` with a complex result throws COMPLEX | Returns a complex number | No complex type in TS; the fuzz oracle reports a complex output as error `complex`. |
| D6 | Parse cache per compile | Module-global `_AST` | Memory is released with the CompiledModel. |
| D7 | `resolveInputs` rejects a dict value for a scalar variable | Keeps the last entry | Silent data loss otherwise. |

## 5. Public interface (03 §1)

`src/index.ts` exports these now; `compile` throws `EngineError` `NOT_IMPLEMENTED` until ENG-04.

| type | decision |
|---|---|
| `ModelBundle`, `VariableDef`, `NodeDef`, `DimensionDef`, `Member`, `DimId`, `TenantMembers` | Re-exported from `@glidepath/spec` (03 §1's ModelBundle plus additive metadata). Engine depends only on `spec` (02 §1). |
| `TenantData` | `members: TenantMembers` (readonly arrays; **array order is evaluation order**, S06), `values` and `overrides: Map<CellKey, number>` as in 03 §1. |
| `CellKey` | `string`: `id` or `id[m1,m2]` (S19). |
| `compile(bundle, members)` | Exactly 03 §1. |
| `evaluate(values, overrides?)`, `inputHash(values, overrides)` | 03 §1 leaves the parameter types open: `ReadonlyMap<CellKey, number>`. |
| `Evaluation` | `get(cell)`, `has(cell)`, `values`, `overrides`; ENG-05 may add read-only members (slots, diagnostics) but not remove these. |
| `Change` | Engine-level union `{ target: 'variable', cell, value: number } \| { target: 'override', cell, value: number \| null }` (null removes a pin). `domain` cannot be imported here (02 §1), so DOM maps its changeset `Change` onto this. |
| `BatchInput`, `BatchResult` | SoA: `size`, `values: ReadonlyMap<CellKey, Float64Array>` (varied inputs in; downstream closure out, pinned cells excluded), `failed: Uint8Array` per lane, `errors: ReadonlyMap<lane, EngineError>` (the error scalar `evaluate` of that lane throws) (ENG-08). |
| `explain(cell, at?)` | 03 §1 lists `explain(cell)`. Values and drivers need an evaluation, and a compiled model is shared across sessions (ModelCache), so the evaluation is an optional second argument; without it, `Explanation` has structure only. |
| `upstream`, `downstream` (ENG-09) | Read-only views over the CSR of `compile` (`src/compile/csr.ts`; no second graph). `upstream` is breadth first, first-reference order within a level; `downstream` is node cells in topological order. A well-formed variable cell no formula reads has neither (Python `users.get(k, [])`); any other key the CSR lacks is UNKNOWN_CELL (Python returns `[]` for anything). |
| `Explanation` (ENG-09) | `src/explain`. `inputs` = the cell's CSR deps (resolved keys) with values; `words` = the chosen expression with spec labels (generic over bound variables; literal indices name their member). `drivers` = provided inputs and pinned node cells the cell reads (the walk stops at a pin), each moved by `h = max(\|x\|, 1)·2^-26` (exact as `(x + h) - x`) and the cell recomputed by rerun over the reverse CSR within the cell's upstream cone, early stop on `Object.is`; `derivative` = Δy/h, `sensitivity` = derivative·x (ranks as 04 §5 elasticity, defined at y = 0), `elasticity` = sensitivity/y. Only non-zero sensitivities are kept, by \|sensitivity\| descending. A rerun that raises drops that driver. |
| `inputHash` | "SHA-256 of sorted cells + model version" via `sha256Hex` from `@glidepath/spec`. Recommended: cells sorted by key, each value as its float64 bit pattern (so a one-ulp change and −0 change the hash), the pins likewise, and a model digest computed once in `compile` from the bundle **and the members in order** (members change results; `membersHash` ignores order, see §7). |

Error codes and the Python exception each one corresponds to (fuzz: "raises in TS ⇔ raises in Python", same class):

| `EngineErrorCode` | Python | when |
|---|---|---|
| SYNTAX | `SyntaxError` | tokenize / parse |
| UNKNOWN_SYMBOL, UNKNOWN_DIMENSION, NO_CASE | `KeyError` at `Model()` | compile |
| BAD_INDEX, IMPLICIT_INDEX, WHERE_NOT_STATIC | `ValueError` at `Model()` | compile |
| UNKNOWN_FUNCTION, ARITY, TYPE | `NameError`, `IndexError`, `TypeError` at run time | compile (D1) |
| CYCLE | `RuntimeError` | compile |
| BAD_INPUT | `KeyError`, `ValueError`, `StopIteration` in `input_cells` | `resolveInputs` |
| DIV_ZERO | `ZeroDivisionError` | evaluate (`/`, `0 ** -n`) |
| MISSING | `KeyError` "while computing …" | evaluate (S20) |
| OVERFLOW | `OverflowError` | evaluate (`^`) |
| COMPLEX | complex result (no exception) | evaluate (`^`, D5) |
| UNKNOWN_CELL | `KeyError` on `r[key]` | `Evaluation.get` |

## 6. Parity harness design

Lives in `tools/parity` (ENG-06 golden + replay, ENG-10 fuzz), imports `@glidepath/engine` and `@glidepath/spec`, reads the seed JSON from `docs/spec/seed/aa` with members in file order, and builds inputs with `resolveInputs` (S25). Reports go to `tools/parity/out/` (git-ignored); any miss exits non-zero.

### Tolerance: 1e-6 relative / 1e-9 absolute

`close(ts, ref) = |ts − ref| ≤ max(1e-6 · |ref|, 1e-9)`: relative for ordinary values, absolute near zero (03 §1 Determinism; CLAUDE.md rule 6). Both non-finite: equal only if both NaN or the same infinity.

| comparison | TS side | reference side | rule |
|---|---|---|---|
| golden | `pyRound(v, 6)`, exactly Python `round(x, 6)` (S29) | `golden_results.json` (already rounded) | `close` |
| parity replay | raw `v` | `check.engine` (rounded to 6 dp) | absolute: `abs(v − ref) ≤ 1e-6`, as the ENG-06 acceptance states (a reference rounded to 6 dp cannot support 1e-6 relative) |
| fuzz | raw `v` | raw Python value (`repr` round-trips) | `close`; plus raises ⇔ raises |

With S06 and S18 implemented as specified, TS values are expected to be bitwise equal to Python's for AA, so these tolerances are slack, not a budget.

### Golden: 760 values

5 presets (`rates`, `A`, `B`, `C`, `D`) × 152 = 760: 44 scalar outputs, levers L01–L17 × `rr, iy, ot, cx` (68), and the 4 VPs × `outlay, eff_addr, growth, target, bar, savings, one_time, net, gap, gap_risk` (40). Key mapping: scalar keys are cell keys verbatim (`pl.eps[fy27b]`); `levers.Lnn.f` → `lev.f[Lnn]`; `vp.<vp>.f` → `vp.f[<vp>]`. Each preset is `evaluate(resolveInputs(seed, preset))` with no extra values and no overrides (`run_tests.py` L105). `unified_minus_v03` is informational and not counted. `pnpm parity:golden` writes `out/golden-report.json` with `{scenario, key, ts, rounded, golden, diff, pass}` per value and requires 760/760 (G3).

### Parity replay: 245 checks

Replays every check of `parity_report.json` without the source workbooks (GAP-05). Run configurations (`run_tests.py` L36, L48, L62, L70, L91):

- `PARITY(sid)`: preset `sid` with extra `{overrides: parity_report.parity_overrides, values: {corp.it_swb_mode: 0}}`. The overrides are 36 node cells (`lv.*`, `base.headwinds`, `lev.cx[Lnn]` except L12).
- `CB_OFF`: preset `C` with extra `{values: {g.chargeback_on: 0}}` and **no** overrides.
- `PLAIN(sid)`: preset `sid`, no extra.

Note for ENG-06: its acceptance line says all 245 replays use the parity overrides plus `corp.it_swb_mode: 0`. That holds for 212 checks; 18 use `CB_OFF` and 15 use `PLAIN`, exactly as below. The table below was validated with engine.py: it replays 245/245 within 1e-6 (11 distinct runs).

| placeholder | values |
|---|---|
| `{sid}` | rates, A, B, C, D |
| `{L}` | L01, L02, L03, L04, L05, L06, L07, L08, L09, L10, L11, L12, L13, L14, L15, L16, L17 |
| `{vp}` | vp_commercial, vp_operations, vp_corporate, vp_infra |
| `{feed}` | g27, o27, c27, ot27_it, e27, d27, ebit27, cash27, cash27_co, o28, c28, d28, ebit28, cash28 |
| `{corp}` | rev, ebitda, ebitdar, ni, eps, fcf, net_debt |
| `{Y}` | FY2025A, FY2026E, FY2027E_base |
| `{br27}` | ebitda, ni, eps, fcf |
| `{br28}` | ebitda, eps, px |

| rule | check name | run | TS value | count |
|---|---|---|---|---|
| R01 | `levers v0.3 {sid} {L} in-year` | `PARITY(sid)` | `lev.iy[{L}]` | 85 |
| R02 | `levers v0.3 {sid} pnl_feed.{feed}` | `PARITY(sid)` | `g27` → `res.tot_iy`, `ot27_it` → `res.tot_ot_it`, every other key `k` → `pnl.k` | 70 |
| R03 | `levers v0.3 {sid} risk-adjusted net` | `PARITY(sid)` | `res.risk` | 5 |
| R04 | `levers v0.3 {sid} bar` | `PARITY(sid)` | `res.bar` | 5 |
| R05 | `levers v0.3 {sid} end-state GCC FTE` | `PARITY(sid)` | `res.fte_gcc` | 5 |
| R06 | `levers v0.3 VP {vp} target` | `PARITY(C)` | `vp.target[{vp}]` | 4 |
| R07 | `levers v0.3 VP {vp} net C` | `PARITY(C)` | `vp.net[{vp}]` | 4 |
| R08 | `levers v0.3 VP {vp} gap C` | `PARITY(C)` | `vp.gap[{vp}]` | 4 |
| R09 | `baseline VP {vp} CY26 outlay` | `CB_OFF` | `vp.outlay[{vp}]` | 4 |
| R10 | `baseline VP {vp} CY27 growth` | `CB_OFF` | `vp.growth[{vp}]` | 4 |
| R11 | `baseline VP {vp} addressable` | `CB_OFF` | `vp.addressable[{vp}]` | 4 |
| R12 | `baseline VP {vp} net target` | `CB_OFF` | `vp.target[{vp}]` | 4 |
| R13 | `baseline total outlay` | `CB_OFF` | `base.total` | 1 |
| R14 | `baseline headwinds` | `CB_OFF` | `base.headwinds` | 1 |
| R15 | `corporate v0.1 {corp} {Y}` | `PARITY(C)` | `pl.{corp}[y]`, `y` = fy25, fy26, fy27b for FY2025A, FY2026E, FY2027E_base | 21 |
| R16 | `corporate v0.1 price FY2027 base` | `PARITY(C)` | `val.px[fy27b]` | 1 |
| R17 | `corporate v0.1 bridge {br27} FY2027 (C)` | `PARITY(C)` | `br.{br27}27` | 4 |
| R18 | `corporate v0.1 bridge price FY2027 (C)` | `PARITY(C)` | `br.px27` | 1 |
| R19 | `corporate v0.1 bridge {br28} FY2028 run-rate (C)` | `PARITY(C)` | `br.{br28}28` | 3 |
| R20 | `invariant {sid} pool effects sum to run-rate` | `PLAIN(sid)` | max over L01–L17 of `abs(lev.rr_check[L])` | 5 |
| R21 | `invariant {sid} VP nets sum to total net` | `PLAIN(sid)` | `vp.check` | 5 |
| R22 | `invariant {sid} only IT lines differ in FY2027 revenue` | `PLAIN(sid)` | `pl.rev[fy27it] − pl.rev[fy27b]` | 5 |

Compare with `check.engine` (not `source_model`, which is the workbook value with its own `tol`). `parity-replay.spec.ts` asserts 245/245.

### Fuzz: 200 vectors

`pnpm parity:fuzz` (ENG-10, G4):

1. **Vectors.** Per tenant: `aa` (`docs/spec/seed/aa`) and the synthetic `zz` (`tools/testkit/seed/zz`). Seeded PRNG in TS (mulberry32, seed recorded in the report). Vector `i` starts from preset `[rates, A, B, C, D][i mod 5]`. Variables with both `min` and `max` in the registry (168 of 194) are drawn uniform in `[min, max]`, every member cell independently; `int`, `bool` and `enum` are snapped to `min + k · step`. Vectors 0–99 are *local*: 1–8 random bounded variables re-drawn. Vectors 100–199 are *global*: every bounded variable re-drawn. Unbounded variables keep their resolved value. Within the bounds the reference does not raise (every variable used as a divisor has a positive lower bound; ENG-10: 0 of 200 uniform vectors raise on either tenant), so 100 more *edge* vectors per tenant, drawn the same way from seed + 1, put 20% of their values on `min`, `max` or 0 (0 even outside the bounds); those make engine.py raise `ZeroDivisionError` (ENG-10: 13 of 100 on aa, 15 on zz).
2. **Oracle.** `python3 -I tools/parity/fuzz_ref.py <spec_dir> <seed_dir> <vectors.json> <out.json>` imports the unchanged `docs/spec/reference/engine.py` (stdlib only), asserts CPython ≥ 3.12 (S06), and for each vector runs `Model.run(preset, {"values": vec})` with every input cast to `float`: tenant values, preset values and overrides, and the vector (D4). It writes `Model.order` once and, per vector, the value of each of its keys, or `{error: {type, message, cell}}` with the cell being computed (read through `Model.cells`; null when `input_cells` raised). A complex value in any cell is reported as error type `complex` (D5). Non-finite floats are written as the strings `"nan"`, `"inf"`, `"-inf"` (Python `json` would emit invalid `NaN` tokens).
3. **Compare.** Every node cell (3,370 for aa, 2,157 for zz), `close` as above; both engines must have the same node cells. A vector that raises in one engine must raise in the other with the matching code (§5; `KeyError`, `ValueError`, `StopIteration` before any cell is computed are BAD_INPUT) on the same cell. The report counts raising vectors per code. Measured at ENG-10: every compared value bitwise equal.
4. **Budget.** engine.py takes about 0.1 s to load and 0.06 s per run on AA (measured), so the oracle needs about 15 s; the whole job must stay under 5 min (ENG-10: about 30 s for both tenants, one oracle process each, in parallel). Output `out/fuzz-report.json` with the seed, per-vector status and the worst diffs; exit 1 on any miss or on a vector count other than requested.

### Fixtures

Python dump scripts in `tier2-logic/engine/test/fixtures/`, each run as `python3 -I <script> <repo>` against the unchanged engine.py, writing sorted JSON that is committed and regenerated when the spec changes:

| script | output | used by |
|---|---|---|
| `dump_ast.py` | every expression string → `parse()` tuple as nested arrays | ENG-02 `ast-parity.spec.ts` |
| `dump_deps.py` | every cell → sorted `cdeps`; `Model.order` | ENG-03 `deps-parity.spec.ts`, ENG-04 `toposort.spec.ts` |
| `dump_run_c.py` | every cell of `run('C')` with `repr` floats | ENG-05: find the first diverging cell in topological order |
| `dump_closure.py` | 50 sampled keys → `cdeps` levels and `users` closure (counts + SHA-256) | ENG-09 `queries.spec.ts` |
| `dump_explain.py` | `res.net`, `br.eps27` in C and PARITY(C) → every candidate driver's `Model.rerun` derivative (bit patterns) | ENG-09 `explain.spec.ts` |

## 7. Notes for items outside the engine

- **Member order is part of the model.** Sums run in `TenantData.members` order (S06), but `membersHash` ignores order (spec README). data-access must return members in seed order (`dimension_member.sort`, then file order for lines), and the ModelCache key `(tenant, model_version, members_hash)` must also cover order, or two orders share one compiled model. Whether `dimension_member.active = false` members are dropped before `compile` is a data-access decision; dropping one changes the cells.
- **ENG-06 acceptance wording** on the replay configurations: see §6 Parity replay.
- **Golden comparison** must round like Python (S29); a plain relative comparison fails 77 of 760.
