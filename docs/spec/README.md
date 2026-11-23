# Unified model spec v1.0 (AA IT savings → multi-airline app)

This is one app-ready specification that merges the three working models: the IT cost baseline v0.1, the lever model v0.3 and the corporate model v0.1. Every number in it is an editable input, every formula is data, and AA is the first tenant. The spec is the single source of truth for the UX, architecture and backlog steps that come next.

## Files

| File | What it is | Who uses it |
|---|---|---|
| `01_data_model.md` + **`schema.json`** | DB tables (tenant dimension, RLS), views, changesets, validation rules VR01–VR10 | Architecture, backend |
| `02_variable_registry.md` + **`variables.json`** | 194 inputs, each with default, min/max/step, unit, group, source, confidence, kind (decision/estimate), UI control | UX, backend, solvers |
| `03_formula_graph.md` + **`formula_graph.json`**, `03b_node_catalogue.md` | 307 formula nodes (~3,370 cells) as a DAG: inputs → baseline → levers → VP targets → P&L → EPS → share price; expression language; engine contract | Engine |
| `04_solvers_simulation.md` + **`solvers.json`** | Goal seek, scenario blend, minimum-risk mix (total and per-VP bars), Pareto, Monte Carlo, tornado and Sobol, with performance targets | Engine, UX |
| `05_excel_template.md` + **`excel_template.json`** | App-defined workbook, key-based three-way diff, import pipeline, delta report, round-trip tests | Backend |
| `06_reconciliation.md` + `reconciliation.json` | 28 inconsistencies between the three models and how each was resolved | Review |
| `07_multitenancy_reconfiguration.md` | Global vs per-airline data, onboarding checklist for UA or AS, AI reconfiguration job | Architecture |
| `seed/aa/` | AA tenant seed: 415 lines, org, vendors, every input default, five scenario presets, lever library | Backend |
| `reference/` | Python reference engine, builders, parity tests, solver demos, golden results | Engine build and regression |

## Proof that it works

- The generic engine reads only the JSON files and reproduces all three source models: **245 of 245 parity checks pass** (`reference/parity_report.json`).
- Unified defaults move the numbers only slightly against v0.3. In scenario C, net is +$0.1M and EPS −$0.003. Every difference is listed in 06.

## Headline numbers (AA, unified defaults)

Base $1,007.6M (capex $123.9M, 20.8% locked). Cost growth to absorb is $43.0M, so the gross bar is **$143.0M**.

| Scenario | Net | Risk-adjusted | Gap to bar | Run-rate | EPS 2027 | Share price |
|---|---|---|---|---|---|---|
| Rates only | 8.1 | 5.8 | −134.9 | 10.1 | | |
| A | 113.2 | 81.1 | −29.8 | 168.1 | +$0.094 | +$1.04 |
| B | 94.1 | 60.4 | −48.9 | 171.9 | +$0.062 | +$0.70 |
| **C Balanced** | 119.3 | 82.0 | −23.7 | 193.8 | +$0.091 | +$1.02 |
| D Full stretch | 166.9 | 112.1 | +23.9 | 283.7 | +$0.117 | +$1.31 |

All amounts in $M.

- **Solvers:** the minimum-risk optimizer reaches $143.0M with no change to people levers, $42M risk exposure and $20M one-time cost on IT. With every VP bar added it reaches $148.1M.
- **Monte Carlo:** with delivery weighted by confidence, P(clear bar) is 0% in C and 4.5% in D. This supports the demo message that the target is hard and AA needs to build its own path.

## Handoff to the next steps

**UX and moodboard (Opus, high effort).**
- Hero inputs: net target, one-time funding share outside IT, US, GCC and contractor headcount. Then lever cards, each with start, ramp, confidence and on/off.
- Hero outputs: net vs bar (gauge), gap, risk-adjusted net, VP gaps, EPS and share price.
- Every input carries `ui.control` (slider, toggle, segmented, number, table, matrix) and `ui.hero` in `variables.json`. Output nodes are flagged `output: true` in `formula_graph.json`.
- Solver results come back as scenarios with ranked moves, which suits a "show me a path" interaction.

**Architecture.** Use the engine contract in 03 §5 and the performance targets in 04 §6: full evaluation under 50 ms, slider update under 10 ms, Monte Carlo of 2,000 runs under 10 s. Port the evaluator to TypeScript or WASM and use `reference/golden_results.json` as the acceptance test.

**Backlog.** Each file maps to an epic: schema and tenancy, engine port with parity, solver jobs, Excel round trip, AI tenant onboarding, UI.

## Rebuild

From the `model-spec/` folder, run each script as `python3 reference/<script> .` (the argument is the spec folder):

1. `build_spec.py` writes the registry, formula graph and AA seed.
2. `run_tests.py` runs the parity checks and writes the golden results.
3. `solvers_demo.py` runs the solver demos.
4. `build_contracts.py` writes the schema, Excel and solver JSON and the reconciliation.
5. `build_docs.py` writes the generated markdown.

The scripts read the source models in `/mnt/project-files/baseline`, `levers` and `corporate`, and never change them.
