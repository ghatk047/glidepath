# 04 · Solvers, optimizers and simulators

Machine-readable version: `solvers.json`. Working demos on the reference engine: `reference/solvers_demo.py`; results in `reference/solver_demo_results.json` (AA, unified defaults).

Every tool below is a wrapper around one pure function, `evaluate(inputs, overrides) → all nodes`, plus its incremental and batched forms. None of them needs its own copy of the math.

## 1. Decision variables vs estimates

The registry tags every lever input with `kind`:
- **decision** (35): management choices a solver may move, such as portfolio cut %, % of roles relocated, % of COLA refused, start months, lever on/off.
- **estimate** (25): facts or assumptions a solver must hold, such as transition cost per role, productivity factors, vendor leakage, share of software renewing, confidence.

This matters. In a first run without the tag, the optimizer "found" savings by lowering transition costs and severance. Bounds for decisions are `[registry min, stretch cap]`, where the stretch cap defaults to the higher of the C and D presets (no lever pushed past full stretch). The user can widen it.

## 2. Problem catalogue

| Problem | Question it answers | Formulation | Method |
|---|---|---|---|
| **Goal seek** | What value of this one input closes the gap? | Solve `x` such that `output(x) = target`, `x ∈ [lo, hi]` | 11-point monotonicity scan, then Brent. Report "not reachable in range" with the best value. |
| **Breakeven table** | What would each lever have to deliver alone? | Goal seek every decision input on `res.gap = 0` | Batch goal seeks |
| **Scenario blend** | How far from C toward D do we need to go? | `x = C + λ(D − C)`, solve `λ` for `res.gap = 0` | Bisection |
| **Minimum-risk mix** | Cheapest-risk way to hit $143M (or every VP bar) | min `Σ iy_l (1 − conf_l)` s.t. `res.net ≥ res.bar`, optional `vp.net[v] ≥ vp.bar[v]`, one-time cap, rate-share cap, US headcount floor, GCC hiring capacity, EPS floor, bounds | Greedy marginal analysis for the explainable UI answer; SLSQP / IPOPT with finite-difference gradients and multi-start for production; CMA-ES fallback |
| **Pareto frontier** | Savings vs risk (or vs one-time cost) | ε-constraint sweep of min-risk mix over bar = 100…200 | Batch |
| **VP-feasible plan** | Can every VP clear its own bar? | Min-risk mix with per-VP constraints; if infeasible, maximise the minimum VP coverage | As above |
| **Monte Carlo** | How likely are we to hit it? | Sample uncertain inputs, evaluate in batch | Vectorised engine, Gaussian copula |
| **Sensitivity** | Which numbers matter? | Tornado (min/max), elasticities, Sobol indices, spider | Batch |
| **Stress presets** | What if the GCC can't hire, vendors win COLA, we start in Q2? | Named sets of input changes | One evaluation each |

Alternative objectives for the mix (user picks): maximise risk-adjusted net, minimise one-time cost, minimise people impact, or minimise change from the current plan (`Σ ((x − x0) / range)²`).

Every solver result is saved as a **scenario** (kind = solver) with the ranked list of moves, binding constraints and shadow prices, so the user can open it, tweak it and compare.

## 3. Demo results (AA, Balanced as starting point)

**Scenario blend.** The bar is cleared at λ = 0.49, about halfway from C to D: net $143.0M, risk-adjusted $96.9M, one-time on IT $27.0M, EPS +$0.104. Operations and Infra are still about $1M short of their own bars.

**Minimum-risk mix, total bar only** (64 greedy steps, 1,634 evaluations, ~10 s in Python):
net $143.0M, risk-adjusted $101.0M, risk exposure $42.0M (C: $37.3M, D: $54.8M), one-time on IT $20.0M, US headcount unchanged from C (2,692), EPS +$0.113.
It gets there without touching the people levers. Moves from C, in the order the optimizer valued them: refuse all vendor COLA (70% → 100%), avoid more software uplifts (50% → 80%) and cloud growth (50% → 70%), deeper demand cuts (25% → 35% change, 18% → 30% run release), consulting 40% → 50%, rate-card coverage 75% → 90%, end-user 15% → 25%, cloud 30% → 35%, plus small software, TPM, tail-SI and invoice-audit moves.

**Minimum-risk mix, total and every VP bar** (95 steps): net $148.1M, all four VPs clear (Operations by $0.01M, the binding constraint), risk exposure $43.6M. Adds deeper software renewals, DC refresh deferral and colo, platform contract work and a rate cut 5% → 7%.

**Monte Carlo** (2,000 runs each, seed fixed; realisation per lever ~ Beta with mean = lever confidence, families correlated at 0.5, 0–2 month start slips, growth ±30–40%):

| | Net P10 / P50 / P90 | Bar P50 | P(net ≥ bar) | P(net ≥ $100M) | EPS 2027 P50 |
|---|---|---|---|---|---|
| C Balanced | 49.5 / 74.5 / 97.4 | 144.4 | 0% | 7% | +$0.048 |
| D Full stretch | 62.8 / 102.0 / 135.6 | 144.4 | 4.5% | 53% | +$0.056 |

Read this as "if every lever delivers only its confidence-weighted share and some start late, even full stretch rarely clears the bar". That is the message the partner persona wants: the target is hard, so AA has to build its own path. The result leans on treating confidence as expected delivery. A softer setting (Beta mean = 1 on in-flight levers) is one slider away.

**Tornado on net (top of list, C):** one-time funding share outside IT (±$39M swing over 0–100%), share of one-time incurred in CY27 ($20M), head start ($17M), software renewal share / shelfware / renewal cut ($14–16M each), app run cost ($14M), contractor headcount ($13M), US non-backfill ($13M), US headcount ($12M). The top three are policy and timing choices, not savings levers, which is a useful demo point.

## 4. Monte Carlo specification

- **Distributions** (defaults; `variable_def.dist` overrides per input): realisation `1.2 × Beta(K·c/1.2, K·(1 − c/1.2))` with K = 4 and c = lever confidence; start slip U{0,1,2}; pool growth Triangular(0.7g, g, 1.4g). Users can set Triangular, PERT, Normal, Lognormal or discrete on any input.
- **Correlation:** Gaussian copula. Default groups: labour levers L01–L08, technology levers L09–L16, ρ = 0.5. Groups and ρ are editable.
- **Outputs:** P10/P50/P90 and histograms for net, bar, gap, EPS and share price; P(clear bar), P(clear target ignoring growth); P(clear) per VP; variance contribution by lever (Spearman rank correlation of realisation vs net).
- **Reproducibility:** seed stored with the run; 2,000 iterations by default.
- **Performance:** run in a worker with the vectorised engine (all iterations as arrays). Target < 10 s for 2,000 iterations. The Python demo takes ~30 s scalar.

## 5. Sensitivity specification

- Tornado: one at a time to registry min and max, or ±x%, on any output (net, gap, VP gap, EPS, price). Sorted by swing.
- Elasticity: ∂output/∂input × input/output at the current point (finite differences on the batched engine).
- Sobol: Saltelli sampling, N = 1,024, on the top 20 inputs from the tornado; first-order and total-effect indices.
- Spider: output vs input from −50% to +50%.

## 6. Engine requirements these imply

| Requirement | Target |
|---|---|
| Full evaluation | < 50 ms |
| Incremental (slider) | < 10 ms |
| Goal seek | < 1 s |
| Minimum-risk mix | < 10 s |
| Monte Carlo, 2,000 runs | < 10 s |
| Sobol | < 60 s |

Solvers run as jobs (`solver_run` table) with progress, cancel and a saved result scenario.
