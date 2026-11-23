# SOL · Solvers

Goal seek, breakeven, blend, min-risk, VP-feasible, Monte Carlo, tornado, stress; Pareto and Sobol post-demo. Acceptance numbers from `solver_demo_results.json` (G5).

11 items. Fields and status values: see [README](README.md). Rubric: `docs/architecture/10_backlog_conventions.md` §2.

| id | title | ms | model/effort | size | depends on |
|---|---|---|---|---|---|
| SOL-01 | Solver framework: results, decision sets, abort and progress | M3 | opus/xhigh | M | ENG-07, ENG-08 |
| SOL-02 | Goal seek and breakeven table | M3 | opus/xhigh | M | SOL-01 |
| SOL-03 | Scenario blend C → D | M3 | opus/xhigh | S | SOL-02 |
| SOL-04 | Minimum-risk lever mix (total bar) | M3 | opus/xhigh | M | SOL-01 |
| SOL-05 | Constraints, VP-feasible plan, binding constraints | M3 | opus/xhigh | M | SOL-04 |
| SOL-06 | Monte Carlo on the batch engine | M3 | opus/xhigh | M | SOL-01 |
| SOL-07 | Tornado sensitivity | M3 | opus/xhigh | S | SOL-01 |
| SOL-08 | Stress presets | M3 | sonnet/high | S | SOL-01 |
| SOL-09 | Pareto frontier (job only) | POST | opus/xhigh | M | SOL-05 |
| SOL-10 | Sobol indices (job only) | POST | opus/xhigh | M | SOL-06 |
| SOL-11 | Solver acceptance gate runner (G5) | M3 | sonnet/medium | S | SOL-03, SOL-05, SOL-06, SOL-07 |

## SOL-01 · Solver framework: results, decision sets, abort and progress

```yaml
id: SOL-01
title: "Solver framework: results, decision sets, abort and progress"
epic: SOL
milestone: M3
priority: must
status: done
stream: A
model: opus
effort: xhigh
depends_on: [ENG-07, ENG-08]
tier: 2
package: "tier2-logic/solvers"
contract: "SolverResult, decisionSet(), runSolver(model, params, {signal, progress})"
inputs:
  - "docs/architecture/03_engine_and_solvers.md#3. Package `tier2-logic/solvers`"
  - "docs/spec/solvers.json (decision_variable_sets, problems)"
  - "docs/spec/04_solvers_simulation.md#1. Decision variables vs estimates"
  - "docs/spec/reference/solvers_demo.py (DEC, lo, hi, NEG)"
acceptance:
  - "SolverResult, Change and per-problem params types as in 03 §3 for every problem id in solvers.json (test: type fixtures)"
  - "lever_intensity set = scalar, scenario-varying, kind=decision lev.L* inputs; bounds [registry min, min(registry max, max(C, D))]; estimates never move (test: AA set equals solvers_demo.py DEC)"
  - "AbortSignal stops at the next batch with status cancelled; progress(fraction, note) throttled to ≥ 250 ms (test with fake clock)"
  - "ranked-move helper (cell, from, to, impact) shared by all solvers (test)"
gates: [G1, G2]
size: M
notes: "Starts after the parity gate (needs ENG-07/08)."
merged_at: "2026-11-23"
```

Shared plumbing so each solver is only its method.

## SOL-02 · Goal seek and breakeven table

```yaml
id: SOL-02
title: "Goal seek and breakeven table"
epic: SOL
milestone: M3
priority: must
status: todo
stream: A
model: opus
effort: xhigh
depends_on: [SOL-01]
tier: 2
package: "tier2-logic/solvers"
contract: "goalSeek(), breakeven()"
inputs:
  - "docs/spec/solvers.json (problems.goal_seek, problems.breakeven)"
  - "docs/spec/04_solvers_simulation.md#2. Problem catalogue"
  - "docs/architecture/03_engine_and_solvers.md#3. Package `tier2-logic/solvers`"
acceptance:
  - "goal seek: 11-point monotonicity scan then Brent; non-monotone or out-of-range → status unreachable with the closest value (tests on synthetic functions)"
  - "AA C: goal seek of one lever-intensity input on res.gap = 0 agrees with a bisection oracle within the input's registry step (test)"
  - "breakeven: one row per lever-intensity input with current, needed, feasible? (test: rows = decision set size)"
  - "goal seek < 1 s, breakeven < 2 s on AA (bench)"
gates: [G1, G2, G5, G8]
size: M
notes: ""
```

The 'what value closes the gap' answers.

## SOL-03 · Scenario blend C → D

```yaml
id: SOL-03
title: "Scenario blend C → D"
epic: SOL
milestone: M3
priority: must
status: todo
stream: A
model: opus
effort: xhigh
depends_on: [SOL-02]
tier: 2
package: "tier2-logic/solvers"
contract: "blend(A, B, target)"
inputs:
  - "docs/spec/solvers.json (problems.scenario_blend)"
  - "docs/spec/reference/solver_demo_results.json (goal_seek_blend_C_to_D)"
  - "docs/spec/reference/solvers_demo.py (blend)"
acceptance:
  - "solving λ for res.gap = 0 from C to D matches goal_seek_blend_C_to_D: λ 0.4936 ± 0.001, net 142.98, risk-adjusted 96.91, one-time IT 26.97, eps27 0.104, VP gaps within 0.01 (G5)"
  - "per-member inputs blend per member (test)"
  - "< 1 s (bench)"
gates: [G1, G2, G5]
size: S
notes: ""
```

Cockpit and Path 'Blend C → D'.

## SOL-04 · Minimum-risk lever mix (total bar)

```yaml
id: SOL-04
title: "Minimum-risk lever mix (total bar)"
epic: SOL
milestone: M3
priority: must
status: todo
stream: A
model: opus
effort: xhigh
depends_on: [SOL-01]
tier: 2
package: "tier2-logic/solvers"
contract: "minRiskMix(params)"
inputs:
  - "docs/spec/solvers.json (problems.min_risk_mix)"
  - "docs/spec/04_solvers_simulation.md#3. Demo results (AA, Balanced as starting point)"
  - "docs/spec/reference/solver_demo_results.json (min_risk_total_bar, min_risk_reference)"
  - "docs/spec/reference/solvers_demo.py (risk_exposure, optimise)"
  - "docs/architecture/03_engine_and_solvers.md#3. Package `tier2-logic/solvers`"
acceptance:
  - "objective Σ lev.iy·(1 − lev.conf); constraint res.net ≥ res.bar; from C reaches net ≥ bar with risk exposure 42.01 ± 0.5, one-time IT 20.0 ± 0.5, res.fte_us 2692 and people levers unchanged (G5 vs min_risk_total_bar)"
  - "the set of moved inputs equals min_risk_total_bar.inputs_moved_from_C; moves ranked in optimizer order (test)"
  - "alternative objectives max_risk_adjusted_net, min_one_time, min_people_impact, min_change each return feasible from C (test)"
  - "deterministic for a seed; < 10 s single process (bench solvers.min_risk)"
gates: [G1, G2, G5, G8]
size: M
notes: "Greedy marginal analysis as the explainable default; production method may refine but must keep the acceptance numbers."
```

'Show me a path' — the demo's headline solver.

## SOL-05 · Constraints, VP-feasible plan, binding constraints

```yaml
id: SOL-05
title: "Constraints, VP-feasible plan, binding constraints"
epic: SOL
milestone: M3
priority: must
status: todo
stream: A
model: opus
effort: xhigh
depends_on: [SOL-04]
tier: 2
package: "tier2-logic/solvers"
contract: "minRiskMix({constraints}), vpFeasible()"
inputs:
  - "docs/spec/solvers.json (problems.min_risk_mix.constraints, problems.vp_feasible)"
  - "docs/spec/reference/solver_demo_results.json (min_risk_total_and_vp_bars)"
  - "docs/spec/04_solvers_simulation.md#3. Demo results (AA, Balanced as starting point)"
acceptance:
  - "with every vp.net ≥ vp.bar: net 148.13 ± 0.5, all VP gaps ≥ 0, risk exposure 43.63 ± 0.5, Operations has the smallest slack (binding) (G5 vs min_risk_total_and_vp_bars)"
  - "optional constraints one_time_cap, rate_share, us_floor, gcc_hiring, eps floor each bind on a constructed case (one test each)"
  - "binding constraints with shadow prices reported (test)"
  - "infeasible → status infeasible with the plan that maximises min vp.coverage (test)"
gates: [G1, G2, G5]
size: M
notes: ""
```

Feeds VPs 'Every VP clears?' and Path constraints.

## SOL-06 · Monte Carlo on the batch engine

```yaml
id: SOL-06
title: "Monte Carlo on the batch engine"
epic: SOL
milestone: M3
priority: must
status: todo
stream: A
model: opus
effort: xhigh
depends_on: [SOL-01]
tier: 2
package: "tier2-logic/solvers"
contract: "monteCarlo(params, seed)"
inputs:
  - "docs/spec/04_solvers_simulation.md#4. Monte Carlo specification"
  - "docs/spec/solvers.json (problems.monte_carlo)"
  - "docs/spec/reference/solver_demo_results.json (monte_carlo_C, monte_carlo_D)"
  - "docs/spec/reference/solvers_demo.py (Monte Carlo section)"
acceptance:
  - "distributions: realisation 1.2·Beta(K·c/1.2, K·(1 − c/1.2)) with K = 4; start slip U{0,1,2}; pool growth Triangular(0.7g, g, 1.4g); variable_def.dist overrides; Gaussian copula ρ = 0.5 for L01–L08 and L09–L16 (tests on sample moments and rank correlation)"
  - "seeded 2,000 draws: P(clear bar) C 0% and D 4.5% within ±1.5 pp; net P10/P50/P90 within ±5% of monte_carlo_C/D (G5)"
  - "outputs P10/P50/P90 + histogram for net, bar, gap, EPS, price; P(clear target ignoring growth); P(clear) per VP; Spearman contribution by lever; seed stored (test)"
  - "2,000 draws < 10 s (bench solvers.mc.2000)"
gates: [G1, G2, G5, G8]
size: M
notes: "Percentile tolerance ±5% is this backlog's choice (different RNG than numpy); P(clear) tolerance is from 03 §3."
```

The 'odds' — target is hard.

## SOL-07 · Tornado sensitivity

```yaml
id: SOL-07
title: "Tornado sensitivity"
epic: SOL
milestone: M3
priority: must
status: todo
stream: A
model: opus
effort: xhigh
depends_on: [SOL-01]
tier: 2
package: "tier2-logic/solvers"
contract: "tornado(output, options)"
inputs:
  - "docs/spec/04_solvers_simulation.md#5. Sensitivity specification"
  - "docs/spec/solvers.json (problems.sensitivity)"
  - "docs/spec/reference/solver_demo_results.json (tornado_net_top15)"
acceptance:
  - "one-at-a-time to registry min/max on res.net, sorted by swing: top entry g.ot_out_share with swing 39.1 ± 0.1 and the top-15 ids equal tornado_net_top15 (order may differ only between swings within 0.1) (G5)"
  - "each item carries a category (policy, timing, lever) from the registry group so the UI can colour it (test)"
  - "elasticity option (test); < 2 s (bench)"
gates: [G1, G2, G5]
size: S
notes: ""
```

Path 'What moves net most'.

## SOL-08 · Stress presets

```yaml
id: SOL-08
title: "Stress presets"
epic: SOL
milestone: M3
priority: must
status: todo
stream: A
model: sonnet
effort: high
depends_on: [SOL-01]
tier: 2
package: "tier2-logic/solvers"
contract: "stressPresets()"
inputs:
  - "docs/spec/solvers.json (problems.stress_presets)"
  - "docs/spec/04_solvers_simulation.md#2. Problem catalogue"
acceptance:
  - "each named shock in solvers.json stress_presets is applied as changes and evaluated, returning net/gap/EPS deltas (one test per example)"
  - "presets are read from solvers.json, never coded (test: an extra fixture example appears)"
  - "< 1 s (bench)"
gates: [G1, G2]
size: S
notes: "Rubric deviation: sonnet/high — simple application of named change sets."
```

Market and Q&A 'what if' shocks.

## SOL-09 · Pareto frontier (job only)

```yaml
id: SOL-09
title: "Pareto frontier (job only)"
epic: SOL
milestone: POST
priority: should
status: todo
stream: A
model: opus
effort: xhigh
depends_on: [SOL-05]
tier: 2
package: "tier2-logic/solvers"
contract: "pareto(params)"
inputs:
  - "docs/spec/solvers.json (problems.pareto)"
  - "docs/architecture/03_engine_and_solvers.md#3. Package `tier2-logic/solvers`"
acceptance:
  - "ε-constraint sweep over bar levels from solvers.json (100..200 step 5) returns points + scenario per point; risk non-decreasing in savings (test)"
  - "< 30 s (bench)"
gates: [G1, G2]
size: M
notes: "Post-demo per 09 §3 (Pareto panel); the Path scatter shows C/Path/All VPs/D points without it."
```

Frontier for after the demo.

## SOL-10 · Sobol indices (job only)

```yaml
id: SOL-10
title: "Sobol indices (job only)"
epic: SOL
milestone: POST
priority: should
status: todo
stream: A
model: opus
effort: xhigh
depends_on: [SOL-06]
tier: 2
package: "tier2-logic/solvers"
contract: "sobol(params)"
inputs:
  - "docs/spec/04_solvers_simulation.md#5. Sensitivity specification"
  - "docs/spec/solvers.json (problems.sensitivity.methods)"
acceptance:
  - "Saltelli first- and total-order indices; Ishigami test function within 0.02 of analytic values (test)"
  - "< 60 s on AA (bench)"
gates: [G1, G2]
size: M
notes: "Post-demo per 09 §3."
```

Variance decomposition for later.

## SOL-11 · Solver acceptance gate runner (G5)

```yaml
id: SOL-11
title: "Solver acceptance gate runner (G5)"
epic: SOL
milestone: M3
priority: must
status: todo
stream: A
model: sonnet
effort: medium
depends_on: [SOL-03, SOL-05, SOL-06, SOL-07]
tier: 2
package: "tools/parity (solvers suite)"
contract: "`pnpm test:solvers` (G5)"
inputs:
  - "docs/architecture/08_quality_and_testing.md#1. Gates (G5)"
  - "docs/spec/reference/solver_demo_results.json"
acceptance:
  - "`pnpm test:solvers` runs the G5 cases of SOL-03..07 against the AA seed and writes tools/parity/out/solver-report.json (test)"
  - "CI job solvers enabled for solver PRs and nightly (test: job no longer skipped)"
gates: [G5]
size: S
notes: ""
```

One command for the solver gate.
