# SPEC · Spec package

Load and validate the spec JSON, generate types, read tenant seeds.

3 items. Fields and status values: see [README](README.md). Rubric: `docs/architecture/10_backlog_conventions.md` §2.

| id | title | ms | model/effort | size | depends on |
|---|---|---|---|---|---|
| SPEC-01 | Generate zod types and id unions from spec JSON | M0 | haiku/low | S | FND-01 |
| SPEC-02 | Spec loader, ModelBundle and members hash | M0 | sonnet/high | M | SPEC-01 |
| SPEC-03 | Tenant seed reader and seed-to-inputs resolution | M0 | sonnet/high | S | SPEC-02 |

## SPEC-01 · Generate zod types and id unions from spec JSON

```yaml
id: SPEC-01
title: "Generate zod types and id unions from spec JSON"
epic: SPEC
milestone: M0
priority: must
status: todo
stream: A
model: haiku
effort: low
depends_on: [FND-01]
tier: 2
package: "tools/gen-types (writes tier2-logic/spec/src/generated)"
contract: "`pnpm gen:types`"
inputs:
  - "docs/spec/variables.json"
  - "docs/spec/formula_graph.json (dimensions, nodes)"
  - "docs/spec/solvers.json"
  - "docs/spec/excel_template.json"
  - "docs/spec/schema.json"
  - "docs/spec/seed/aa/*.json (shapes only)"
acceptance:
  - "emits zod schemas + TS types for variables.json, formula_graph.json, solvers.json, excel_template.json, schema.json and the seed files; output compiles (test: typecheck)"
  - "id unions VarId, NodeId, DimId, ProblemId, VRId are generated; their sizes equal the counts read from the JSON at test time (194 variables, 307 nodes) (test)"
  - "CI regenerate-and-diff is clean; generated files carry a do-not-edit header (test)"
gates: [G1, G2]
size: S
notes: ""
```

Mechanical: spec JSON in, types out.

## SPEC-02 · Spec loader, ModelBundle and members hash

```yaml
id: SPEC-02
title: "Spec loader, ModelBundle and members hash"
epic: SPEC
milestone: M0
priority: must
status: todo
stream: A
model: sonnet
effort: high
depends_on: [SPEC-01]
tier: 2
package: "tier2-logic/spec"
contract: "loadModelBundle(), membersHash()"
inputs:
  - "docs/architecture/03_engine_and_solvers.md#Public interface"
  - "docs/spec/03_formula_graph.md#2. Expression language"
  - "docs/spec/01_data_model.md#3. Dimensions"
  - "docs/spec/reference/engine.py (Model.__init__)"
acceptance:
  - "loadModelBundle(json) validates variables, dimensions, nodes (expr, cases, members) into the ModelBundle of 03 §1 (test: docs/spec loads with 194 variables, 307 nodes)"
  - "invalid fixtures (unknown dim, duplicate id, node with neither expr nor cases) fail with a JSON-path error (test)"
  - "membersHash(members) is SHA-256 over sorted dims, members and attrs; order-independent; any attr change changes it (test)"
  - "core is pure; a thin node adapter reads files (test: core imports no fs)"
gates: [G1, G2]
size: M
notes: ""
```

The typed entry point every tier-2 package uses to read the model.

## SPEC-03 · Tenant seed reader and seed-to-inputs resolution

```yaml
id: SPEC-03
title: "Tenant seed reader and seed-to-inputs resolution"
epic: SPEC
milestone: M0
priority: must
status: todo
stream: A
model: sonnet
effort: high
depends_on: [SPEC-02]
tier: 2
package: "tier2-logic/spec"
contract: "readTenantSeed(), seedToTenantData()"
inputs:
  - "docs/spec/01_data_model.md#7. What the AA seed contains"
  - "docs/spec/01_data_model.md#4. How a scenario resolves"
  - "docs/spec/reference/engine.py (Model.input_cells)"
  - "docs/spec/seed/aa/"
acceptance:
  - "readTenantSeed loads tenant.json, dimension_members.json, variable_values.json, scenarios.json, lever_library.json with zod validation (test on docs/spec/seed/aa)"
  - "seedToTenantData(seed, scenarioId?) reproduces Model.input_cells: tenant defaults, then scenario values, then overrides; per-member dicts keyed by comma-joined member_key (test: C has the same cell set and values as the JSON, 30 sampled cells checked, scalar given per-member value throws as in Python)"
  - "member attrs (line.pool, line.domain, …) preserved for where-filters (test)"
gates: [G1, G2]
size: S
notes: ""
```

Gives the engine and parity harness AA inputs straight from JSON, before the database exists.
