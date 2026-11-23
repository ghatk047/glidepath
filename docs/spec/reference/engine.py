"""Reference calculation engine for the unified IT-savings model.

Reads ONLY the JSON spec (formula_graph.json, variables.json) plus a tenant seed
(dimension members, variable values, scenarios). Contains no airline-specific
logic or numbers. It exists to prove the spec is complete and executable, and to
give the app team golden results to test against. It is not the app.

Expression language (see 03_formula_graph.md):
  numbers, 'strings', + - * / ^, comparisons (== != < <= > >=),
  IF(c,a,b) (lazy), MIN, MAX, ABS, AND, OR, NOT, SAFEDIV(a,b[,alt]),
  SUM(x in dim [where cond], expr), COUNT(x in dim [where cond]), MAXOVER/MINOVER(...)
  refs: symbol | symbol[idx,...] ; bare dim variable = member id ; var.attr = member attribute
  implicit indexing: a dimensioned symbol referenced without [] is indexed by the
  innermost bound variable of each of its dimensions.
"""
import json, re, math, os
from collections import defaultdict, deque

# ----------------------------------------------------------------------------- parser
TOK = re.compile(r"\s*(?:(\d+\.\d*(?:[eE][-+]?\d+)?|\d*\.\d+(?:[eE][-+]?\d+)?|\d+(?:[eE][-+]?\d+)?)|('(?:[^'])*')|([A-Za-z_][A-Za-z0-9_.]*)|(==|!=|<=|>=|[-+*/^()\[\],<>]))")
AGG = {"SUM", "COUNT", "MAXOVER", "MINOVER"}


def tokenize(s):
    pos, out = 0, []
    s = s.strip()
    while pos < len(s):
        m = TOK.match(s, pos)
        if not m or m.end() == pos:
            raise SyntaxError(f"bad token at {pos}: {s[pos:pos+20]!r} in {s!r}")
        num, st, ident, op = m.groups()
        if num is not None: out.append(("num", float(num)))
        elif st is not None: out.append(("str", st[1:-1]))
        elif ident is not None: out.append(("id", ident))
        else: out.append(("op", op))
        pos = m.end()
    out.append(("end", None))
    return out


class Parser:
    BP = {"==": 10, "!=": 10, "<": 10, "<=": 10, ">": 10, ">=": 10, "+": 20, "-": 20, "*": 30, "/": 30, "^": 50}

    def __init__(self, s):
        self.t = tokenize(s); self.i = 0; self.src = s

    def peek(self): return self.t[self.i]
    def nxt(self):
        tok = self.t[self.i]; self.i += 1; return tok
    def expect(self, kind, val=None):
        tok = self.nxt()
        if tok[0] != kind or (val is not None and tok[1] != val):
            raise SyntaxError(f"expected {val or kind}, got {tok} in {self.src!r}")
        return tok

    def parse(self):
        e = self.expr(0); self.expect("end"); return e

    def expr(self, rbp):
        left = self.nud(self.nxt())
        while True:
            tok = self.peek()
            if tok[0] != "op" or tok[1] not in self.BP: break
            bp = self.BP[tok[1]]
            if bp <= rbp: break
            self.nxt()
            right = self.expr(bp - 1 if tok[1] == "^" else bp)
            left = ("bin", tok[1], left, right)
        return left

    def nud(self, tok):
        k, v = tok
        if k == "num": return ("num", v)
        if k == "str": return ("str", v)
        if k == "op" and v == "-": return ("neg", self.expr(40))
        if k == "op" and v == "+": return self.expr(40)
        if k == "op" and v == "(":
            e = self.expr(0); self.expect("op", ")"); return e
        if k == "id":
            if self.peek() == ("op", "("):
                self.nxt()
                if v in AGG:
                    var = self.expect("id")[1]; kw = self.expect("id")
                    if kw[1] != "in": raise SyntaxError("expected 'in'")
                    dim = self.expect("id")[1]; where = None
                    if self.peek() == ("id", "where"):
                        self.nxt(); where = self.expr(0)
                    body = None
                    if self.peek() == ("op", ","):
                        self.nxt(); body = self.expr(0)
                    self.expect("op", ")")
                    return ("agg", v, var, dim, where, body)
                args = []
                if self.peek() != ("op", ")"):
                    args.append(self.expr(0))
                    while self.peek() == ("op", ","):
                        self.nxt(); args.append(self.expr(0))
                self.expect("op", ")")
                return ("call", v, args)
            idx = None
            if self.peek() == ("op", "["):
                self.nxt(); idx = [self.expr(0)]
                while self.peek() == ("op", ","):
                    self.nxt(); idx.append(self.expr(0))
                self.expect("op", "]")
            return ("ref", v, idx)
        raise SyntaxError(f"unexpected {tok} in {self.src!r}")


_AST = {}
def parse(s):
    if s not in _AST: _AST[s] = Parser(s).parse()
    return _AST[s]


# ----------------------------------------------------------------------------- model
class Model:
    def __init__(self, spec_dir, seed_dir):
        self.graph = json.load(open(os.path.join(spec_dir, "formula_graph.json")))
        self.vars = {v["id"]: v for v in json.load(open(os.path.join(spec_dir, "variables.json")))["variables"]}
        seed = lambda f: json.load(open(os.path.join(seed_dir, f)))
        dm = seed("dimension_members.json")
        self.members = {d: [m["id"] for m in ms] for d, ms in dm.items()}
        self.attrs = {d: {m["id"]: m for m in ms} for d, ms in dm.items()}
        self.values = seed("variable_values.json")          # tenant defaults: id -> scalar | {cellkey: v}
        self.scenarios = seed("scenarios.json")              # scenarios: [{id, values: {id: ...}, overrides: {...}}]
        self.nodes = {n["id"]: n for n in self.graph["nodes"]}
        self.dims_of = {**{k: v.get("dims", []) for k, v in self.vars.items()}, **{k: n.get("dims", []) for k, n in self.nodes.items()}}
        self._expand()

    # --- helpers
    @staticmethod
    def key(name, mem):
        return f"{name}[{','.join(mem)}]" if mem else name

    def combos(self, dims, subset=None):
        if not dims: return [()]
        out = [()]
        for d in dims:
            ms = (subset or {}).get(d) or self.members[d]
            out = [c + (m,) for c in out for m in ms]
        return out

    def pick_expr(self, node, bind):
        for case in node.get("cases", []):
            w = case.get("when")
            if w is None or all(bind[d] in ms for d, ms in w.items()):
                return case["expr"]
        if "expr" in node: return node["expr"]
        raise KeyError(f"no expression for {node['id']} at {bind}")

    # --- static resolution of references (for dependency graph)
    def _idx(self, ast, env):
        k = ast[0]
        if k == "str": return ast[1]
        if k == "ref" and ast[2] is None:
            nm = ast[1]
            if nm in env: return env[nm][1]
            if "." in nm and nm not in self.dims_of:
                v, a = nm.split(".", 1)
                if v in env:
                    d, m = env[v]; return str(self.attrs[d][m][a])
        raise ValueError(f"index must be a dim variable, attribute or string: {ast}")

    def resolve(self, name, idx, env):
        dims = self.dims_of.get(name)
        if dims is None: raise KeyError(f"unknown symbol {name}")
        if idx is not None:
            if len(idx) != len(dims): raise ValueError(f"{name} expects {len(dims)} indices")
            mem = tuple(self._idx(a, env) for a in idx)
        else:
            mem = []
            for d in dims:
                b = [m for (dd, m) in reversed(list(env.values())) if dd == d]
                if not b: raise ValueError(f"cannot implicitly index {name} on dim {d}; env={env}")
                mem.append(b[0])
            mem = tuple(mem)
        return self.key(name, mem)

    def where_ok(self, ast, env):
        return bool(self.ev(ast, env, None))

    def deps(self, ast, env, out):
        k = ast[0]
        if k in ("num", "str"): return
        if k == "neg": return self.deps(ast[1], env, out)
        if k == "bin":
            self.deps(ast[2], env, out); self.deps(ast[3], env, out); return
        if k == "call":
            for a in ast[2]: self.deps(a, env, out)
            return
        if k == "agg":
            _, fn, var, dim, where, body = ast
            for m in self.members[dim]:
                e2 = dict(env); e2[var] = (dim, m)
                if where is not None and not self.where_ok(where, e2): continue
                if body is not None: self.deps(body, e2, out)
            return
        if k == "ref":
            nm, idx = ast[1], ast[2]
            if idx is None and (nm in env or ("." in nm and nm.split(".", 1)[0] in env and nm not in self.dims_of)): return
            out.add(self.resolve(nm, idx, env))

    # --- evaluation
    def ev(self, ast, env, get):
        k = ast[0]
        if k == "num": return ast[1]
        if k == "str": return ast[1]
        if k == "neg": return -self.ev(ast[1], env, get)
        if k == "bin":
            op = ast[1]; a = self.ev(ast[2], env, get); b = self.ev(ast[3], env, get)
            if op == "+": return a + b
            if op == "-": return a - b
            if op == "*": return a * b
            if op == "/":
                if b == 0: raise ZeroDivisionError(f"division by zero in {ast}")
                return a / b
            if op == "^": return a ** b
            if op == "==": return 1.0 if a == b else 0.0
            if op == "!=": return 1.0 if a != b else 0.0
            if op == "<": return 1.0 if a < b else 0.0
            if op == "<=": return 1.0 if a <= b else 0.0
            if op == ">": return 1.0 if a > b else 0.0
            if op == ">=": return 1.0 if a >= b else 0.0
        if k == "call":
            fn, args = ast[1], ast[2]
            if fn == "IF":
                return self.ev(args[1], env, get) if self.ev(args[0], env, get) else self.ev(args[2], env, get)
            if fn == "SAFEDIV":
                b = self.ev(args[1], env, get)
                if b == 0: return self.ev(args[2], env, get) if len(args) > 2 else 0.0
                return self.ev(args[0], env, get) / b
            vals = [self.ev(a, env, get) for a in args]
            if fn == "MIN": return min(vals)
            if fn == "MAX": return max(vals)
            if fn == "ABS": return abs(vals[0])
            if fn == "AND": return 1.0 if all(vals) else 0.0
            if fn == "OR": return 1.0 if any(vals) else 0.0
            if fn == "NOT": return 0.0 if vals[0] else 1.0
            raise NameError(fn)
        if k == "agg":
            _, fn, var, dim, where, body = ast
            acc = []
            for m in self.members[dim]:
                e2 = dict(env); e2[var] = (dim, m)
                if where is not None and not self.ev(where, e2, get): continue
                acc.append(1.0 if fn == "COUNT" else self.ev(body, e2, get))
            if fn in ("SUM", "COUNT"): return float(sum(acc))
            if fn == "MAXOVER": return max(acc) if acc else 0.0
            if fn == "MINOVER": return min(acc) if acc else 0.0
        if k == "ref":
            nm, idx = ast[1], ast[2]
            if idx is None:
                if nm in env: return env[nm][1]
                if "." in nm and nm not in self.dims_of:
                    v, a = nm.split(".", 1)
                    if v in env:
                        d, m = env[v]; return self.attrs[d][m][a]
            if get is None: raise ValueError("cell reference not allowed in static context (where clause)")
            return get(self.resolve(nm, idx, env))
        raise ValueError(ast)

    # --- expansion into concrete cells
    def _expand(self):
        self.cells = {}     # key -> (ast, env)
        self.cdeps = {}
        for n in self.graph["nodes"]:
            dims = n.get("dims", [])
            for combo in self.combos(dims, n.get("members")):
                env = {d: (d, m) for d, m in zip(dims, combo)}
                bind = {d: m for d, m in zip(dims, combo)}
                ast = parse(self.pick_expr(n, bind))
                k = self.key(n["id"], combo)
                self.cells[k] = (ast, env)
                ds = set(); self.deps(ast, env, ds); self.cdeps[k] = ds
        # topo order
        indeg = {k: 0 for k in self.cells}
        users = defaultdict(list)
        for k, ds in self.cdeps.items():
            for d in ds:
                users[d].append(k)
                if d in self.cells:
                    indeg[k] += 1
        q = deque(k for k, v in indeg.items() if v == 0); order = []
        while q:
            k = q.popleft(); order.append(k)
            for u in users[k]:
                indeg[u] -= 1
                if indeg[u] == 0: q.append(u)
        if len(order) != len(self.cells):
            bad = [k for k, v in indeg.items() if v > 0][:10]
            raise RuntimeError(f"cycle in formula graph near {bad}")
        self.order = order; self.users = users

    # --- inputs
    def input_cells(self, scenario_id=None, extra=None):
        vals = {}
        def put(vid, v):
            dims = self.vars[vid].get("dims", [])
            if isinstance(v, dict):
                for ck, x in v.items():
                    vals[self.key(vid, tuple(ck.split(","))) if dims else vid] = x
            else:
                if dims: raise ValueError(f"{vid} needs per-member values")
                vals[vid] = v
        for vid, v in self.values.items(): put(vid, v)
        overrides = {}
        if scenario_id:
            sc = next(s for s in self.scenarios["scenarios"] if s["id"] == scenario_id)
            for vid, v in sc.get("values", {}).items(): put(vid, v)
            overrides.update(sc.get("overrides", {}))
        if extra:
            for vid, v in extra.get("values", {}).items(): put(vid, v)
            overrides.update(extra.get("overrides", {}))
        return vals, overrides

    def run(self, scenario_id=None, extra=None):
        vals, ov = self.input_cells(scenario_id, extra)
        res = dict(vals)
        get = res.__getitem__
        for k in self.order:
            if k in ov: res[k] = ov[k]; continue
            ast, env = self.cells[k]
            try:
                res[k] = self.ev(ast, env, get)
            except KeyError as e:
                raise KeyError(f"while computing {k}: missing {e}")
        return res

    def rerun(self, base_res, changes, overrides=None):
        """Incremental recalculation: only cells downstream of changed inputs."""
        res = dict(base_res); res.update(changes); overrides = overrides or {}
        dirty = set(changes) | set(overrides)
        q = deque(dirty); seen = set()
        while q:
            k = q.popleft()
            for u in self.users.get(k, []):
                if u not in seen: seen.add(u); q.append(u)
        get = res.__getitem__
        for k in self.order:
            if k in overrides: res[k] = overrides[k]; continue
            if k in seen:
                ast, env = self.cells[k]; res[k] = self.ev(ast, env, get)
        return res
