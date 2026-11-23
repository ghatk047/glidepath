# 07 · Multi-tenancy and AI reconfiguration (UA, AS, ...)

Goal: "ask AI to redo the app for United or Alaska and it reconfigures itself." Because formulas, inputs and dimensions are all data, a new airline is a new tenant plus a seed, with no code change.

## 1. What is global and what is per airline

| Global (shared by all tenants) | Per tenant (airline data) |
|---|---|
| Formula graph, variable definitions, dimension definitions (per model version) | Line items (the IT cost baseline) |
| 11 canonical cost pools | Pool labels, growth rates, shared/SWB flags |
| Lever library L01–L17 (formulas, text) | Which levers are on, every lever input, scenarios |
| Addressability tags | Addressability shares |
| Expression language, engine, solvers | Org units (VPs), domains, domain ownership |
| Excel template structure | Vendors, headcount, rates |
| | Corporate drivers: capacity, yield, fuel, labor groups, fleet, debt, shares, multiples |
| | Market snapshot (price, Brent, crack), sources |

Nothing AA-specific is in the global column. AA facts (Sabre lock-in, DXC, the Hyderabad GCC, four VPs, $1B budget) live only in the `aa` seed.

## 2. Tenant onboarding checklist (what the AI must produce)

1. **Tenant record:** name, currency, base and target year, ticker, fiscal calendar.
2. **Baseline lines:** each mapped to a canonical pool, a domain, an addressability tag, a scale driver; amount and capex share. If no bottom-up data exists, generate an outside-in baseline the way the AA baseline was built (benchmarks × headcount × footprint), every line with source and confidence.
3. **Org:** VPs and domain ownership (sums to 100%), shared-services owner.
4. **Workforce:** internal, captive, contractor headcount and the headcounts the lines were sized at.
5. **Vendors:** preferred panel and book of business.
6. **Corporate drivers:** last reported year (calibration targets from the 10-K: revenue, fuel, SWB, opex, EBIT, interest, net income, OCF, FCF, cash, net debt), plus forecasts for the next two years. Labor groups follow the airline's unions (UA: ALPA, AFA, IAM, Teamsters; AS: ALPA, AFA, AMFA, IAM).
7. **Target:** dollar amount or % of base, growth absorption, one-time funding share.
8. **Scenarios:** copy the five global presets; lever inputs stay the library defaults until tuned.
9. **Sources:** every value carries source and confidence.

## 3. How the AI reconfiguration job works

`ai_reconfig_job`: prompt ("set up Alaska Airlines") → plan (members, values, sources, open questions) → validation (all VR rules, calibration check: the FY-last rebuild must tie to the 10-K within 1%) → **one reviewable changeset** → apply. Nothing is written until the user accepts the changeset, and it can be reverted.

The AI also proposes tenant-specific lever tuning (e.g. AS has no Hyderabad-scale GCC, so lever 3–5 intensities start low; UA's PSS is in-house, so platform addressability differs) as a separate changeset.

## 4. Model upgrades

A new `model_version` (e.g. adding lever 18) is published globally. Tenants stay pinned until they opt in. The upgrade path runs golden tests for that tenant before and after and shows the deltas, like section 4 of 03.

## 5. AA as the test bed

The AA tenant is the reference: `reference/run_tests.py` proves the generic engine reproduces AA's three source models, and `golden_results.json` is the regression suite. A second tenant passes when its calibration ties and its invariants (pool effects, VP sums, base vs IT revenue) hold.
