# 02 · Input variable registry

Generated from `variables.json` by `reference/build_docs.py`. Do not edit by hand.

**194 input variables** (72 of them are families over a dimension, e.g. one value per lever or per line). Every number in the model is one of these, or a calculated node that can be pinned (see 03). Defaults shown are AA's (tenant `aa`); scenario-varying inputs also carry values for the five preset scenarios in `seed/aa/scenarios.json`.

Columns: **kind** = decision (management choice, a solver may move it), estimate (fact or assumption, solvers hold it), fact_or_estimate (non-lever inputs), simulation. **role** = driver (shown), calibration (hidden by default, reproduces history), simulation (Monte Carlo only). **conf** = H/M/L. **source** = user (confirmed by the user), baseline / levers / corporate (existing models), filing, market, calibrated, benchmark, assumption, spec (new in the unified model).

## Target & governance (7)

| id | label | unit | dims | AA default | C / D (if scenario-varying) | min | max | kind | role | source | conf | note |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `g.target_mode` | Target expressed as: 1 = $ amount, 2 = % of CY26 base | enum |  | 1 |  | 1 | 2 | fact_or_estimate | driver | spec | H | Lets another airline set '10% of base' instead of a dollar figure. |
| `g.target_net` | Net cut in CY27 IT outlay vs CY26 (CIO target) | $M |  | 100 |  | 50 | 150 | fact_or_estimate | driver | user | H | User 2026-11-22: $100M = 4 VPs x $25M (~10% of ~$1B). |
| `g.target_pct` | Net cut as % of CY26 base (used if target mode = 2) | % |  | 0.1 |  | 0.02 | 0.2 | fact_or_estimate | driver | user | H |  |
| `g.absorb_growth` | Absorb CY27 cost growth inside the target (1 = yes) | 0/1 |  | 1 |  | 0 | 1 | fact_or_estimate | driver | user | H | User: CY27 spend must be below CY26 after COLA/merit, so the gross bar = target + growth. |
| `g.head_start` | Head start: months of lever work done before Jan 2027 | months |  | 1 | 1 / 1 | 0 | 3 | fact_or_estimate | driver | levers | M | Moves every lever's start month earlier (floor = January). |
| `g.ot_in_year` | Share of one-time costs incurred in CY27 (rest pre-funded in CY26) | % |  | 1 |  | 0 | 1 | fact_or_estimate | driver | levers | M | Reinterpreted from v0.3 'share expensed in 2027': the non-CY27 share is treated as incurred in CY26, outside both tests. |
| `g.ot_out_share` | Share of CY27 one-time costs funded outside the IT budget | % |  | 0.5 |  | 0 | 1 | fact_or_estimate | driver | user | M | User: some can be funded outside IT. 50% is an assumption. Still hits AA's P&L. |

## P&L hand-off (3)

| id | label | unit | dims | AA default | C / D (if scenario-varying) | min | max | kind | role | source | conf | note |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `g.it_dep_life` | Useful life of IT capex (D&A relief from capex saved) | years |  | 5 |  | 2 | 10 | fact_or_estimate | driver | levers | M | Merges levers dep_life and corporate it_life (both 5). |
| `g.da_first_year_factor` | D&A convention in the year capex is saved (0.5 = half-year) | x |  | 0.5 |  | 0 | 1 | fact_or_estimate | driver | levers | H |  |
| `pool.swb_flag` | Pool is employee cost (lands in salaries, wages & benefits) | 0/1 | pool | 11 values (per member) |  | 0 | 1 | fact_or_estimate | driver | spec | H | Replaces the corporate model's flat 30% it_swb assumption. |

## Org map & chargeback (9)

| id | label | unit | dims | AA default | C / D (if scenario-varying) | min | max | kind | role | source | conf | note |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `g.vp_target_method` | VP target method: 1 = proportional to addressable, 2 = equal, 3 = manual | enum |  | 1 |  | 1 | 3 | fact_or_estimate | driver | user | H | User decision 2026-11-22: proportional. |
| `g.chargeback_on` | Credit shared-infrastructure savings and growth to consuming VPs (1 = on) | 0/1 |  | 1 |  | 0 | 1 | fact_or_estimate | driver | user | H | User: shared infra savings credited back to VPs by usage. |
| `g.vp_alloc_method` | Lever-to-VP allocation: 1 = one key per lever (v0.3), 2 = by pool effects | enum |  | 1 |  | 1 | 2 | fact_or_estimate | driver | spec | M | Method 2 allocates each pool a lever touches (e.g. GCC cost added by relocation) by that pool's ownership. |
| `pool.shared` | Pool is a shared service (chargeback applies) | 0/1 | pool | 11 values (per member) |  | 0 | 1 | fact_or_estimate | driver | levers | M |  |
| `org.dom_share` | Share of each IT domain owned by each VP | % | domain,vp | 60 values (per member) |  | 0 | 1 | fact_or_estimate | driver | user | H | Each domain row must sum to 1 (memo domain to 0). User confirmed Infra owns shared platforms, EUC, telco, cyber; Corporate owns HR/Finance systems; CIO office a |
| `org.ss_flag` | VP is the shared-services owner whose shared slice is re-credited | 0/1 | vp | vp_commercial: 0; vp_operations: 0; vp_corporate: 0; vp_infra: 1 |  | 0 | 1 | fact_or_estimate | driver | levers | M | Exactly one VP should be 1. |
| `org.usage_override_on` | Use metered usage keys instead of the default proxy (1 = yes) | 0/1 |  | 0 |  | 0 | 1 | fact_or_estimate | driver | levers | M |  |
| `org.usage_override` | Metered usage key by VP (used if override on) | % | vp | vp_commercial: 0.25; vp_operations: 0.25; vp_corporate: 0.25; vp_infra: 0.25 |  | 0 | 1 | fact_or_estimate | driver | assumption | L | Should sum to 1. |
| `org.manual_target` | Manual VP net target (method 3) | $M | vp | vp_commercial: 25; vp_operations: 25; vp_corporate: 25; vp_infra: 25 |  | 0 | 100 | fact_or_estimate | driver | user | H | Original CIO split: $25M each. |

## Workforce & rates (14)

| id | label | unit | dims | AA default | C / D (if scenario-varying) | min | max | kind | role | source | conf | note |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `hc.us` | Internal US IT employees | FTE |  | 3000 |  | 2000 | 4000 | fact_or_estimate | driver | user | H | User confirmed 2026-11-22. |
| `hc.us_seed` | US headcount at which the baseline lines were sized | FTE |  | 3000 |  |  |  | fact_or_estimate | calibration | baseline | H | Calibration constant: US labour lines scale by hc.us / hc.us_seed. |
| `hc.gcc` | Offshore captive (India GCC) employees | FTE |  | 900 |  | 300 | 2500 | fact_or_estimate | driver | user | H | User confirmed ~900 (press May 2026 said ~400). |
| `hc.gcc_seed` | GCC headcount at which the baseline lines were sized | FTE |  | 900 |  |  |  | fact_or_estimate | calibration | baseline | H |  |
| `hc.ctr` | Contingent workers (badged contractors) | FTE |  | 800 |  | 500 | 1100 | fact_or_estimate | driver | user | H | User ~800. Scales long-tail SI and staff-aug lines; preferred SIs held at book. |
| `hc.ctr_seed` | Contractor headcount at which tail/staff-aug lines were sized | FTE |  | 800 |  |  |  | fact_or_estimate | calibration | baseline | H |  |
| `hc.ctr_on_share` | Share of contractors onshore / onsite | % |  | 0.35 |  | 0.1 | 0.7 | fact_or_estimate | driver | user | M | User OK'd 35% onshore. |
| `rate.ctr_on_hourly` | Onshore contractor blended rate | $/hr |  | 101.1 |  | 60 | 160 | fact_or_estimate | driver | levers | M | = v0.3 $0.19M/FTE at 1,880 hrs. |
| `rate.ctr_off_hourly` | Offshore SI blended rate | $/hr |  | 31.38 |  | 18 | 50 | fact_or_estimate | driver | levers | M | = v0.3 $0.059M/FTE at 1,880 hrs. |
| `rate.billable_hours` | Billable hours per contractor FTE-year | hours |  | 1880 |  | 1700 | 2000 | fact_or_estimate | driver | baseline | H | Reconciled: baseline 1,880 (H) vs levers 1,900. |
| `wf.prod_factor` | Offshore/GCC heads needed per onshore head | x |  | 1.2 |  | 1 | 1.5 | fact_or_estimate | driver | levers | M | Range 1.1-1.3. |
| `wf.us_attrition` | US IT voluntary attrition | %/yr |  | 0.09 |  | 0.04 | 0.15 | fact_or_estimate | driver | levers | M | Reconciled: levers 9% kept (drives lever 5); baseline said 8% but did not use it in any formula. |
| `wf.change_share` | Share of SI spend that is change/project work | % |  | 0.45 |  | 0.2 | 0.7 | fact_or_estimate | driver | levers | M |  |
| `vendor.book` | Preferred SI book of business | $M | vendor | dxc: 25; cognizant: 18; ibm: 15; si6: 12; coforge: 8; infosys: 5 |  | 0 | 60 | fact_or_estimate | driver | baseline | M | Reconciled to baseline Vendors tab (system of record). v0.3 levers had IBM 18 / Cognizant 15 / #6 14. DXC and Infosys are user figures. |

## Baseline & pools (9)

| id | label | unit | dims | AA default | C / D (if scenario-varying) | min | max | kind | role | source | conf | note |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `line.amount` | CY26 normalized outlay per line (opex + cash capex) | $M | line | seeded (see seed/aa/variable_values.json) |  | 0 |  | fact_or_estimate | driver | baseline | M | 415 lines from AA_IT_Cost_Baseline_v0.1 'Counted 2026 outlay'. Converted $ -> $M. |
| `line.capex_share` | Capex share of the line's outlay | % | line | seeded (see seed/aa/variable_values.json) |  | 0 | 1 | fact_or_estimate | driver | baseline | M |  |
| `addr.share` | Share of spend movable within 12 months, by addressability tag | % | addr_tag | locked: 0; partly: 0.35; addressable: 0.75 |  | 0 | 1 | fact_or_estimate | driver | baseline | M |  |
| `pool.growth` | CY27 status-quo cost growth by pool | %/yr | pool | 11 values (per member) |  | -0.05 | 0.2 | fact_or_estimate | driver | baseline | L | Advisor estimates (merit, COLA, renewal uplifts, consumption). Weighted ~4.3%. |
| `sub.sw_ms_share` | Microsoft share of software spend | % |  | 0.2226 |  | 0 | 0.5 | fact_or_estimate | driver | levers | M | v0.3: $35M of $157.2M. |
| `sub.dc_maint_share` | Hardware maintenance share of DC & hardware opex (rest = colo/facilities) | % |  | 0.5 |  | 0 | 1 | fact_or_estimate | driver | levers | L | v0.3: $6M maint + $6M colo. |
| `portfolio.apps` | Applications in portfolio | # |  | 1800 |  | 500 | 3000 | fact_or_estimate | driver | user | M | Upper bound for lever 9. |
| `portfolio.app_cost` | Average annual run cost of a retirement-candidate app | $M |  | 0.09 |  | 0.02 | 0.4 | fact_or_estimate | driver | levers | L |  |
| `portfolio.app_lab` | Labour share of app run cost (excluded from lever 9) | % |  | 0.35 |  | 0 | 0.7 | fact_or_estimate | driver | levers | L |  |

## Levers (61)

| id | label | unit | dims | AA default | C / D (if scenario-varying) | min | max | kind | role | source | conf | note |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `lev.L01.cut` | Cut to change/project portfolio delivered by SIs | % |  | 0.25 | 0.25 / 0.35 | 0 | 0.3 | decision | driver | levers | H | Benchmark 10-20% of discretionary change spend is low-value or duplicative. Internal capacity freed is redeployed, not cut. |
| `lev.L01.rel` | Release of run-side contingent / managed capacity (no replacement) | % |  | 0.18 | 0.18 / 0.3 | 0 | 0.25 | decision | driver | levers | H | Contractor freeze, end of over-staffed T&M teams, ticket-volume-based AMS sizing. Fastest, near-zero one-time cost. |
| `lev.L02.cut` | Reduction in consulting / advisory spend | % |  | 0.4 | 0.4 / 0.5 | 0 | 0.5 | decision | driver | levers | H | CFO sign-off above threshold, re-scope, use GCC for analysis. Benchmark 15-30%. |
| `lev.L03.pct` | Share of remaining onshore contractor roles relocated | % |  | 0.5 | 0.5 / 0.8 | 0 | 0.7 | decision | driver | levers | M | Keep onshore only roles needing physical presence (airport, ops centre, exec-facing). Benchmark: mature captives run 70-80% offshore. |
| `lev.L03.tc` | Transition cost per relocated role (KT overlap + hiring) | $M |  | 0.055 | 0.055 / 0.055 | 0.02 | 0.1 | estimate | driver | levers | M | ~3 months double-running of an onshore contractor + GCC recruiting. |
| `lev.L04.pct` | Share of SI offshore staff converted to GCC | % |  | 0.15 | 0.15 / 0.3 | 0 | 0.6 | decision | driver | levers | M | Arbitrage is thin (~15-20%): the prize is control and knowledge, not cost. Watch non-solicit clauses. |
| `lev.L04.tc` | Conversion cost per head (hiring, buy-out fee) | $M |  | 0.012 | 0.012 / 0.012 | 0 | 0.03 | estimate | driver | levers | M |  |
| `lev.L04.pf` | GCC productivity factor vs SI offshore | x |  | 1.05 | 1.05 / 1.05 | 0.9 | 1.3 | estimate | driver | levers | M |  |
| `lev.L05.nb` | Share of US leavers NOT backfilled onshore | % |  | 0.75 | 0.75 / 1 | 0 | 1 | decision | driver | levers | M | The core GCC hypothesis: GCC grew additively, US base never shrank. Fix: default backfill location = Hyderabad. |
| `lev.L05.bf` | Of those, share backfilled in GCC (rest absorbed by productivity) | % |  | 0.8 | 0.8 / 0.7 | 0 | 1 | decision | driver | levers | M |  |
| `lev.L05.sl` | Spans & layers: reduction in US labour cost | % |  | 0.02 | 0.02 / 0.04 | 0 | 0.06 | decision | driver | levers | M | Move to 1:8+ spans. Involves severance; HR/legal sensitive. |
| `lev.L05.rel` | Targeted US role relocation to GCC beyond attrition | % of US FTE |  | 0.015 | 0.015 / 0.06 | 0 | 0.08 | decision | driver | levers | M | Planned role moves with severance; reputational and retention risk in DFW/PHX. |
| `lev.L05.vac` | Vacancy harvest: budgeted-but-unfilled US roles removed from budget | % of US cost |  | 0.03 | 0.03 / 0.035 | 0 | 0.04 | decision | driver | levers | M | Large IT budgets typically carry 3-6% vacancy. Immediate, no one-time cost, but only real if the budget line is actually cut. |
| `lev.L05.sev` | Severance + hiring cost as multiple of spans & layers saving | x |  | 0.6 | 0.6 / 0.6 | 0.3 | 1 | estimate | driver | levers | M |  |
| `lev.L06.gain` | Productivity gain on SI / managed work (code, test, AMS tickets) | % |  | 0.2 | 0.2 / 0.3 | 0 | 0.35 | decision | driver | levers | L | Published GenAI gains: 20-45% on coding tasks, 10-25% at team level. |
| `lev.L06.cap` | Share of gain captured in price (contract pass-through) | % |  | 0.75 | 0.75 / 0.8 | 0 | 1 | decision | driver | levers | L | Without an 'AI dividend' clause vendors keep the gain as margin. |
| `lev.L06.tool` | AI tooling run cost (recurring, netted off) | $M |  | 2.5 | 2.5 / 3 | 0 | 5 | estimate | driver | levers | L | ~$20-40/user/month for coding assistants. |
| `lev.L07.pct` | Share of tail SI spend moved to preferred vendors | % |  | 0.6 | 0.6 / 0.8 | 0 | 0.8 | decision | driver | levers | M | Tail typically 30-45% of SI spend; consolidate to 6-8 strategic + niche specialists. |
| `lev.L07.diff` | Rate advantage of preferred panel vs tail | % |  | 0.12 | 0.12 / 0.15 | 0 | 0.2 | decision | driver | levers | M | Volume tiers, rebates, fewer markups. Benchmark 8-15%. |
| `lev.L08.cov` | Share of remaining SI spend reopened / renewing in 2027 | % |  | 0.75 | 0.75 / 0.9 | 0 | 1 | decision | driver | levers | M | Contracts that can be reopened before renewal; leverage = volume consolidation. |
| `lev.L08.cut` | Headline rate reduction | % |  | 0.05 | 0.05 / 0.07 | 0 | 0.15 | decision | driver | levers | M | Benchmark 3-8% achievable; >10% triggers quality/attrition issues. |
| `lev.L08.leak` | Leakage (vendor recovers via pyramid/mix, scope creep) | % |  | 0.2 | 0.2 / 0.2 | 0 | 0.5 | estimate | driver | levers | M | Vendors protect margin by shifting seniority mix and change orders. |
| `lev.L09.n` | Applications retired / consolidated in 2027 | # |  | 170 | 170 / 300 | 0 | 300 | decision | driver | levers | L | Typical first-wave: 5-10% of portfolio. Duplicates from US Airways merger heritage are likely candidates. |
| `lev.L09.dc` | Decommission cost per app (archive, migrate, test) | $M |  | 0.06 | 0.06 / 0.06 | 0.02 | 0.15 | estimate | driver | levers | L |  |
| `lev.L10.shelf` | Shelfware harvested (unused / under-used licences) | % |  | 0.1 | 0.1 / 0.12 | 0 | 0.15 | decision | driver | levers | M | Typical 10-30% of licences unused; harvest 3-8% of spend. |
| `lev.L10.ms` | Microsoft optimisation (E5/E3 mix, Azure commits, EA terms) | % |  | 0.18 | 0.18 / 0.2 | 0 | 0.2 | decision | driver | levers | M |  |
| `lev.L10.ren` | Share of other software renewing / negotiable in 2027 | % |  | 0.6 | 0.6 / 0.8 | 0 | 1 | estimate | driver | levers | M |  |
| `lev.L10.rcut` | Saving on renewing contracts | % |  | 0.2 | 0.2 / 0.3 | 0 | 0.3 | decision | driver | levers | M | Benchmark 10-20% with competitive tension; airline ops software is stickier. |
| `lev.L11.pct` | Cloud cost reduction (rightsizing, commitments, waste) | % |  | 0.3 | 0.3 / 0.35 | 0 | 0.35 | decision | driver | levers | H | FinOps Foundation / vendor benchmarks: 20-30% waste is common in first 2 years. |
| `lev.L12.tpm` | Hardware maintenance moved to third-party (TPM) | % |  | 0.6 | 0.6 / 0.8 | 0 | 0.8 | decision | driver | levers | M | TPM saves 30-50% vs OEM on out-of-warranty kit. |
| `lev.L12.life` | Capex purchases deferred by extending refresh cycles (4 to 5 yrs) and reusing kit | % |  | 0.15 | 0.15 / 0.3 | 0 | 0.3 | decision | driver | levers | M | Cuts cash outlay in the year it is decided; a 4-to-5-year cycle cuts annual purchases ~20%. |
| `lev.L12.colo` | Colo / facilities consolidation | % |  | 0.15 | 0.15 / 0.25 | 0 | 0.3 | decision | driver | levers | M |  |
| `lev.L13.pct` | Network cost reduction (SD-WAN, carrier re-bid, mobile audit) | % |  | 0.22 | 0.22 / 0.25 | 0 | 0.25 | decision | driver | levers | M | Benchmark 10-20%; airport circuits constrained by SITA/airport authority. |
| `lev.L14.pct` | End-user cost reduction (refresh cycle, device standards, peripherals) | % |  | 0.15 | 0.15 / 0.25 | 0 | 0.25 | decision | driver | levers | H |  |
| `lev.L15.pct` | Reduction (volume tiers, message optimisation, contract benchmarking) | % |  | 0.1 | 0.1 / 0.15 | 0 | 0.08 | decision | driver | levers | L | PSS per-pax hosting, SITA/ARINC, nav data: few alternatives, multi-year contracts. Show as mostly locked. |
| `lev.L16.pct` | Recovery / avoidance as % of third-party spend | % |  | 0.015 | 0.015 / 0.02 | 0 | 0.02 | decision | driver | levers | H | Recovery audits typically find 0.5-1.5% of spend; contingency-fee based. |
| `lev.L17.cola` | Share of vendor COLA requests refused | % |  | 0.7 | 0.7 / 1 | 0 | 1 | decision | driver | levers | M | Under AA's definition (2027 outlay vs 2026), an avoided increase counts as much as a cut. |
| `lev.L17.sw` | Share of software renewal uplifts avoided | % |  | 0.5 | 0.5 / 0.8 | 0 | 1 | decision | driver | levers | M | Multi-year price holds, competitive tension, walk-away options. |
| `lev.L17.cl` | Share of cloud consumption growth contained | % |  | 0.5 | 0.5 / 0.7 | 0 | 1 | decision | driver | levers | M | Demand gates and unit-cost targets for new workloads. |
| `lev.L01.ot_pct` | One-time cost as % of run-rate (PMO, governance) | % |  | 0.05 |  | 0 | 0.3 | estimate | driver | levers | L | Was a constant inside the v0.3 formula; promoted to an input. |
| `lev.L02.ot_pct` | One-time cost as % of run-rate | % |  | 0 |  | 0 | 0.3 | estimate | driver | levers | L | Was a constant inside the v0.3 formula; promoted to an input. |
| `lev.L05.reloc_sev` | Severance per relocated US role, as multiple of loaded cost | x |  | 0.5 |  | 0 | 1.5 | estimate | driver | levers | L | Was a constant inside the v0.3 formula; promoted to an input. |
| `lev.L05.hire_cost` | Hiring cost per GCC backfill / relocated role | $M |  | 0.01 |  | 0 | 0.05 | estimate | driver | levers | L | Was a constant inside the v0.3 formula; promoted to an input. |
| `lev.L06.setup` | AI enablement one-time cost (if lever active) | $M |  | 1 |  | 0 | 5 | estimate | driver | levers | L | Was a constant inside the v0.3 formula; promoted to an input. |
| `lev.L07.ot_pct` | One-time cost as % of run-rate (transition, KT) | % |  | 0.25 |  | 0 | 0.6 | estimate | driver | levers | L | Was a constant inside the v0.3 formula; promoted to an input. |
| `lev.L08.ot_pct` | One-time cost as % of run-rate (advisors) | % |  | 0.05 |  | 0 | 0.3 | estimate | driver | levers | L | Was a constant inside the v0.3 formula; promoted to an input. |
| `lev.L09.split_sw` | Share of app-retirement saving landing in software | % |  | 0.5 |  | 0 | 1 | estimate | driver | levers | L | Was a constant inside the v0.3 formula; promoted to an input. |
| `lev.L09.split_cloud` | Share of app-retirement saving landing in cloud (rest DC & hardware) | % |  | 0.3 |  | 0 | 1 | estimate | driver | levers | L | Was a constant inside the v0.3 formula; promoted to an input. |
| `lev.L10.ot_pct` | One-time cost as % of run-rate (SAM tool, advisors) | % |  | 0.1 |  | 0 | 0.3 | estimate | driver | levers | L | Was a constant inside the v0.3 formula; promoted to an input. |
| `lev.L11.setup` | FinOps one-time cost (if lever active) | $M |  | 0.5 |  | 0 | 3 | estimate | driver | levers | L | Was a constant inside the v0.3 formula; promoted to an input. |
| `lev.L12.tpm_saving` | Saving on maintenance moved to third-party (TPM) | % |  | 0.4 |  | 0.2 | 0.6 | estimate | driver | levers | L | Was a constant inside the v0.3 formula; promoted to an input. |
| `lev.L12.ot_pct` | One-time cost as % of run-rate | % |  | 0.15 |  | 0 | 0.5 | estimate | driver | levers | L | Was a constant inside the v0.3 formula; promoted to an input. |
| `lev.L13.ot_pct` | One-time cost as % of run-rate (SD-WAN migration) | % |  | 0.4 |  | 0 | 1 | estimate | driver | levers | L | Was a constant inside the v0.3 formula; promoted to an input. |
| `lev.L14.ot_pct` | One-time cost as % of run-rate | % |  | 0.1 |  | 0 | 0.5 | estimate | driver | levers | L | Was a constant inside the v0.3 formula; promoted to an input. |
| `lev.L15.ot_pct` | One-time cost as % of run-rate | % |  | 0 |  | 0 | 0.5 | estimate | driver | levers | L | Was a constant inside the v0.3 formula; promoted to an input. |
| `lev.L16.ot_pct` | One-time cost as % of run-rate (contingency fee) | % |  | 0.25 |  | 0 | 0.5 | estimate | driver | levers | L | Was a constant inside the v0.3 formula; promoted to an input. |
| `lev.start` | Start month in 2027 (1 = Jan) | month | lever | 17 values (per member) | per lever | 1 | 12 | decision | driver | levers | M | Per lever. |
| `lev.ramp` | Ramp to full run-rate | months | lever | 17 values (per member) | per lever | 1 | 12 | decision | driver | levers | M | Per lever. |
| `lev.conf` | Confidence of realisation | % | lever | 17 values (per member) | per lever | 0 | 1 | estimate | driver | levers | M | Per lever. |
| `lev.realize` | Realisation multiplier on in-year saving (simulation only; 1 = as planned) | x | lever | 17 values (per member) |  | 0 | 1.5 | simulation | simulation | spec | H | Set by Monte Carlo draws; users normally leave at 1. |
| `lev.on` | Lever switched on (1) or off (0) | 0/1 | lever | 17 values (per member) |  | 0 | 1 | decision | driver | spec | H | New: lets solvers and users drop a lever without zeroing its inputs. |

## Corporate drivers (91)

| id | label | unit | dims | AA default | C / D (if scenario-varying) | min | max | kind | role | source | conf | note |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `corp.gdp` | US real GDP growth | % | iyear | fy25: 2; fy26: 2; fy27: 2 |  | -4 | 5 | fact_or_estimate | driver | assumption | M | Drives yield and load factor through the elasticities below. |
| `corp.gdp_ref` | Reference GDP growth embedded in yield and load-factor defaults | % | iyear | fy25: 2; fy26: 2; fy27: 2 |  | 0 | 4 | fact_or_estimate | driver | assumption | M | GDP above this lifts yield and load factor; below it cuts them. |
| `corp.yield_gdp` | Yield elasticity: % change in yield per 1 pt of GDP gap | x | iyear | fy25: 1.5; fy26: 1.5; fy27: 1.5 |  | 0 | 4 | fact_or_estimate | driver | assumption | L | Airline yields are pro-cyclical; 1-2x is a common rule of thumb. |
| `corp.lf_gdp` | Load factor change (pts) per 1 pt of GDP gap | pts | iyear | fy25: 0.5; fy26: 0.5; fy27: 0.5 |  | 0 | 2 | fact_or_estimate | driver | assumption | L |  |
| `corp.cpi` | US CPI inflation | % | iyear | fy25: 2.7; fy26: 2.7; fy27: 2.4 |  | 0 | 8 | fact_or_estimate | driver | assumption | M | Feeds 'Other' opex inflation. |
| `corp.fx_share` | Share of passenger revenue in foreign currency | % | iyear | fy25: 12; fy26: 12; fy27: 12 |  | 0 | 40 | fact_or_estimate | driver | assumption | L | International is ~1/3 of ASMs (S1 p.3); part is sold in USD. |
| `corp.usd` | USD strengthening vs basket (cuts foreign revenue in USD) | % | iyear | fy25: 0; fy26: 0; fy27: 0 |  | -20 | 20 | fact_or_estimate | driver | assumption | M |  |
| `corp.brent` | Brent crude | $/bbl | iyear | fy25: 69; fy26: 97.44; fy27: 85.78 |  | 40 | 160 | fact_or_estimate | driver | market | M | 2025 $69.04 actual; 2026 $97.44 and 2027 $85.78 = EIA STEO Nov 2026 (as of 10 Nov 2026). Spot ~ $92 on 11 Nov. |
| `corp.crack` | Jet fuel crack spread over Brent | $/bbl | iyear | fy25: 23.74; fy26: 53.76; fy27: 59.12 |  | 10 | 80 | fact_or_estimate | driver | calibrated | M | 2025 solved to the $2.39/gal reported (S1 p.2). 2026-27 implied by EIA wholesale jet ($3.60, $3.45/gal) less Brent (S6); EIA expects cracks to stay elevated. |
| `corp.fuel_tax` | Fuel taxes, into-plane and delivery | $/gal | iyear | fy25: 0.18; fy26: 0.18; fy27: 0.19 |  | 0 | 0.5 | fact_or_estimate | driver | assumption | L |  |
| `corp.fuel_mode` | Fuel price mode: 1 = build from Brent + crack, 0 = use direct jet price below | 0/1 | iyear | fy25: 1; fy26: 1; fy27: 1 |  | 0 | 1 | fact_or_estimate | driver | assumption | H |  |
| `corp.jet_direct` | Direct all-in jet fuel price (used only if mode = 0) | $/gal | iyear | fy25: 2.39; fy26: 3.78; fy27: 3.64 |  | 1.5 | 4.5 | fact_or_estimate | driver | filing | H | FY2025 actual $2.39/gal incl. taxes (S1 p.2). AA does not hedge fuel. |
| `corp.sofr` | SOFR (average) | % | iyear | fy25: 4.2; fy26: 3.6; fy27: 3.4 |  | 0 | 7 | fact_or_estimate | driver | assumption | M | Floating-rate debt and cash yield move with this. |
| `corp.asm25` | ASMs, FY2025 | m |  | 299411 |  |  |  | fact_or_estimate | calibration | filing | H | S1 p.2: 299,411m. |
| `corp.asm_g` | ASM (capacity) growth | % | iyear | fy26: 3; fy27: 1 |  | -15 | 10 | fact_or_estimate | driver | assumption | M | Q1 2026 guide was +3-5% (S2) before the fuel shock. AA says growth slows considerably in 2027 (S8). |
| `corp.lf` | Base passenger load factor | % | iyear | fy25: 83.6; fy26: 84; fy27: 84.2 |  | 75 | 90 | fact_or_estimate | driver | filing | H | FY2025 83.6% (S1 p.2). |
| `corp.yield25` | Passenger yield, FY2025 | cents/RPM |  | 19.83 |  |  |  | fact_or_estimate | calibration | calibrated | H | Reported 19.83 cents (S1 p.2); fine-tuned so passenger revenue = $49,643M. |
| `corp.yield_g` | Yield growth before macro effect | % | iyear | fy26: 12.04; fy27: 3 |  | -15 | 25 | fact_or_estimate | driver | calibrated | M | 2026 solved so FY2026E adj. EPS ~ -$0.75 (estimate from TTM EPS -$0.73 and Q4 loss guide, S7/S8): fares rose to pass on fuel. 2027: fares broadly hold while fue |
| `corp.cargo25` | Cargo revenue, FY2025 | $M |  | 839 |  |  |  | fact_or_estimate | calibration | filing | H |  |
| `corp.cargo_g` | Cargo revenue growth | % | iyear | fy26: 3; fy27: 3 |  | -20 | 20 | fact_or_estimate | driver | assumption | M |  |
| `corp.other25` | Other revenue (mostly AAdvantage), FY2025 | $M |  | 4151 |  |  |  | fact_or_estimate | calibration | filing | H |  |
| `corp.other_g` | Other revenue growth | % | iyear | fy26: 8; fy27: 6 |  | -10 | 20 | fact_or_estimate | driver | assumption | M | Loyalty/co-brand growth; new Citi co-brand deal from 2026. |
| `corp.gpa25` | Fuel burn, FY2025 (gallons per 1,000 ASM) | gal/k ASM |  | 14.99 |  |  |  | fact_or_estimate | calibration | filing | H | 4,488m gallons / 299,411m ASMs (S1 p.2). |
| `corp.fuel_eff` | Fuel efficiency gain (fleet renewal, gauge) | %/yr | iyear | fy26: 1; fy27: 1 |  | -2 | 4 | fact_or_estimate | driver | assumption | M |  |
| `corp.ben_load` | Benefits, pensions and payroll taxes, as % of pay | % | iyear | fy25: 12.27; fy26: 12.5; fy27: 12.7 |  | 0 | 30 | fact_or_estimate | driver | calibrated | M | 2025 solved so salaries, wages and benefits = $17,566M reported (S1 p.1). |
| `corp.ps_rate` | Employee profit sharing, % of pre-tax income (ex special items) | % | iyear | fy25: 5; fy26: 5; fy27: 5 |  | 0 | 20 | fact_or_estimate | driver | assumption | L | Simplified version of AA's plan. Any profit gain, including IT savings, leaks partly to employees through this. |
| `corp.ac25` | Mainline aircraft, year-end 2025 | # |  | 1013 |  |  |  | fact_or_estimate | calibration | filing | H | S1 p.2: 1,013 mainline. |
| `corp.ac_add` | Net mainline aircraft added | # | iyear | fy26: 25; fy27: 25 |  | -50 | 80 | fact_or_estimate | driver | assumption | M | Deliveries less retirements; placeholder. |
| `corp.lease_n` | Operating-leased mainline aircraft | # | iyear | fy25: 320; fy26: 320; fy27: 320 |  | 150 | 500 | fact_or_estimate | driver | assumption | L | Estimate. Aircraft rent $1,220M (S1 p.1) / leased count gives the implied rate. |
| `corp.lease_rate25` | Average monthly lease rate per aircraft, FY2025 | $k/month |  | 317.7 |  |  |  | fact_or_estimate | calibration | calibrated | M | Solved: $1,220M / leased aircraft / 12. |
| `corp.lease_g` | Change in average lease rate (renewals, new leases) | % | iyear | fy26: 3; fy27: 3 |  | -10 | 25 | fact_or_estimate | driver | assumption | M | Tight aircraft market keeps lease rates rising. |
| `corp.dpa25` | Depreciation per owned mainline aircraft, FY2025 | $M |  | 2.006 |  |  |  | fact_or_estimate | calibration | calibrated | L | Solved: ($1,890M mainline D&A less non-aircraft D&A) / owned aircraft. |
| `corp.dpa_g` | Change in depreciation per owned aircraft (newer, costlier fleet) | % | iyear | fy26: 2; fy27: 2 |  | -5 | 10 | fact_or_estimate | driver | assumption | M |  |
| `corp.oda25` | Non-aircraft D&A (ground, facilities, IT, software), FY2025 | $M |  | 500 |  |  |  | fact_or_estimate | calibration | assumption | L | Estimate. IT capex savings reduce this line over time. |
| `corp.oda_g` | Growth in non-aircraft D&A | % | iyear | fy26: 3; fy27: 3 |  | -10 | 15 | fact_or_estimate | driver | assumption | M |  |
| `corp.mxr25` | Maintenance cost per mainline aircraft, FY2025 | $M |  | 3.795 |  |  |  | fact_or_estimate | calibration | calibrated | H | $3,844M (S1 p.1) / 1,013 aircraft. |
| `corp.mx_infl` | Maintenance cost inflation per aircraft (engine shop visits, parts) | % | iyear | fy26: 4; fy27: 4 |  | -5 | 15 | fact_or_estimate | driver | assumption | M |  |
| `corp.dep25` | Mainline departures, FY2025 | k |  | 1175 |  |  |  | fact_or_estimate | calibration | filing | H | S1 p.2: 1,175k. |
| `corp.gauge_g` | Gauge growth (seats per departure) | % | iyear | fy26: 1; fy27: 1 |  | -5 | 5 | fact_or_estimate | driver | assumption | M | Departures grow with ASMs less gauge. |
| `corp.aptr25` | Airport rents and landing fees per departure, FY2025 | $ |  | 2958 |  |  |  | fact_or_estimate | calibration | calibrated | H | $3,476M (S1 p.1) / departures. |
| `corp.apt_infl` | Airport rate inflation (terminal rebuilds at DFW, ORD, LAX, JFK) | % | iyear | fy26: 5; fy27: 5 |  | -5 | 15 | fact_or_estimate | driver | assumption | M |  |
| `corp.sell_pct` | Selling expenses (distribution, cards, commissions), % of passenger revenue | % | iyear | fy25: 4.023; fy26: 4; fy27: 4 |  | 2 | 7 | fact_or_estimate | driver | calibrated | H | $1,997M / $49,643M (S1 p.1). |
| `corp.reg25` | Regional operating expenses (ex D&A), FY2025 | $M |  | 5119 |  |  |  | fact_or_estimate | calibration | filing | H | S1 p.1. |
| `corp.reg_da25` | Regional D&A, FY2025 | $M |  | 329 |  |  |  | fact_or_estimate | calibration | filing | H | S1 p.1. |
| `corp.reg_cap_g` | Regional capacity growth | % | iyear | fy26: 3; fy27: 2 |  | -15 | 15 | fact_or_estimate | driver | assumption | M |  |
| `corp.reg_infl` | Regional unit cost inflation (CPA rates, regional pilot pay) | % | iyear | fy26: 3; fy27: 3 |  | -5 | 15 | fact_or_estimate | driver | assumption | M |  |
| `corp.oth25` | Other operating expenses (incl. most CIO IT non-labor spend), FY2025 | $M |  | 6848 |  |  |  | fact_or_estimate | calibration | filing | H | S1 p.1. Catering, ground handling, crew hotels, IT, insurance, etc. |
| `corp.oth_vol` | Volume elasticity of other opex to ASMs | x | iyear | fy26: 0.6; fy27: 0.6 |  | 0 | 1.5 | fact_or_estimate | driver | assumption | L |  |
| `corp.oth_prem` | Other opex inflation premium over CPI | pts | iyear | fy26: 1; fy27: 1 |  | -3 | 5 | fact_or_estimate | driver | assumption | L |  |
| `corp.si` | Special items (operating), pre-tax | $M | iyear | fy25: 162; fy26: 0; fy27: 0 |  | -500 | 2000 | fact_or_estimate | driver | filing | H | FY2025: mainline $159M + regional $3M (S1 p.1). Projections assume none. |
| `corp.debt_open` | Debt and finance leases, year-end 2024 | $M |  | 30476 |  |  |  | fact_or_estimate | calibration | filing | H | Current $5,322M + noncurrent $25,154M (S1 p.9). |
| `corp.debt_chg` | Net debt issuance / (repayment) | $M | iyear | fy25: -1469; fy26: 0; fy27: -500 |  | -5000 | 3000 | fact_or_estimate | driver | filing | M | 2025 actual gives $29,007M at YE (S1 p.10). 2026-27: deleveraging assumed paused (refinance maturities) given negative FCF in the fuel shock. |
| `corp.fix_share` | Fixed-rate share of debt | % | iyear | fy25: 75; fy26: 75; fy27: 75 |  | 0 | 100 | fact_or_estimate | driver | assumption | L |  |
| `corp.fix_rate` | Average coupon on fixed-rate debt | % | iyear | fy25: 5.376; fy26: 5.3; fy27: 5.2 |  | 2 | 10 | fact_or_estimate | driver | calibrated | M | 2025 solved so interest expense = $1,716M (S1 p.1). |
| `corp.flt_spread` | Floating-rate debt spread over SOFR | % | iyear | fy25: 2.75; fy26: 2.75; fy27: 2.75 |  | 0 | 6 | fact_or_estimate | driver | assumption | L |  |
| `corp.cash_open` | Cash and short-term investments, year-end 2024 | $M |  | 6984 |  |  |  | fact_or_estimate | calibration | filing | H | $804M + $6,180M (S1 p.9). |
| `corp.cash_spread` | Yield on cash vs SOFR (earned on opening balance) | % | iyear | fy25: 0.912; fy26: 0.912; fy27: 0.912 |  | -3 | 3 | fact_or_estimate | driver | calibrated | L | 2025 solved so interest income = $357M (S1 p.1). |
| `corp.oth_inc` | Other nonoperating income, net (incl. pension) | $M | iyear | fy25: 82; fy26: 50; fy27: 50 |  | -500 | 500 | fact_or_estimate | driver | filing | M | 2026 guide: total adj. nonoperating expense ~ $1.25B (S2). |
| `corp.tax` | Book tax rate (applied to adjusted pre-tax income) | % | iyear | fy25: 32.67; fy26: 25; fy27: 25 |  | 0 | 40 | fact_or_estimate | driver | filing | H | FY2025 adj. effective rate 32.7% ($115M/$352M); 2026 guide 25% (S2). |
| `corp.cash_tax` | Cash tax rate (NOLs shield most cash tax) | % | iyear | fy25: 0; fy26: 5; fy27: 5 |  | 0 | 30 | fact_or_estimate | driver | assumption | L |  |
| `corp.shares` | Diluted shares (weighted average) | m | iyear | fy25: 661.1; fy26: 665; fy27: 668 |  | 600 | 750 | fact_or_estimate | driver | filing | H | FY2025 661.1m diluted (S1 p.1). Small creep from stock comp. |
| `corp.buyback` | Share buybacks | $M | iyear | fy25: 0; fy26: 0; fy27: 0 |  | 0 | 2000 | fact_or_estimate | driver | assumption | M | Shares retired = buyback / current share price. |
| `corp.capex` | Total capital expenditure (incl. ~$124M CIO IT capex) | $M | iyear | fy25: 3779; fy26: 4250; fy27: 4500 |  | 2000 | 7000 | fact_or_estimate | driver | filing | H | FY2025 $3,779M (S1 p.6). Jan 2026 guide: 2026 ~$4.0-4.5B, 2027+ ~$4.5B (S3); not updated for the fuel shock. |
| `corp.slb` | Sale-leaseback and asset sale proceeds | $M | iyear | fy25: 344; fy26: 300; fy27: 300 |  | 0 | 1500 | fact_or_estimate | driver | filing | M |  |
| `corp.wc` | Working capital and other operating cash items (air traffic liability growth, non-cash charges) | $M | iyear | fy26: 900; fy27: 900 |  | -2000 | 3000 | fact_or_estimate | calibration | calibrated | L | 2025 solved so operating cash flow = $3,099M (S1 p.6). 2026-27 assumption near the 2025 level. |
| `corp.oth_inv` | Other investing flows, net | $M | iyear | fy26: 0; fy27: 0 |  | -1000 | 1000 | fact_or_estimate | calibration | calibrated | L | 2025 solved so FCF = -$83M (S1 p.7). |
| `corp.oth_fin` | Other financing flows (fuel financing, other) | $M | iyear | fy26: 0; fy27: 0 |  | -2000 | 2000 | fact_or_estimate | calibration | calibrated | L | 2025 solved so cash and ST investments = $5,836M (S1 p.9). |
| `corp.oplease` | Operating lease liabilities, year-end | $M | iyear | fy25: 6963; fy26: 6900; fy27: 6900 |  | 3000 | 10000 | fact_or_estimate | driver | filing | H | S1 p.10. |
| `corp.pension` | Pension obligations, year-end | $M | iyear | fy25: 539; fy26: 500; fy27: 450 |  | 0 | 3000 | fact_or_estimate | driver | filing | H | S1 p.10. |
| `corp.price_now` | Current AAL share price (reference) | $ |  | 11.9 |  | 3 | 40 | fact_or_estimate | driver | assumption | L | Close on 20 Nov 2026 (S7). Refresh before the demo. |
| `corp.pe` | P/E multiple on adjusted EPS | x |  | 7 |  | 2 | 30 | fact_or_estimate | driver | assumption | M | Sector-normal ~7x (US network carriers ~5-10x). Off by default (weight 0) because FY2026-27 EPS is depressed by the fuel shock. |
| `corp.ev_mult` | EV / EBITDAR multiple (EV includes leases and pension) | x |  | 7.393 |  | 3 | 10 | fact_or_estimate | driver | calibrated | M | Default is market-implied: (current price x shares + FY2027E net debt) / FY2027E base EBITDAR, so the default case reproduces $11.90. Elevated vs a normal ~5-6x |
| `corp.w_pe` | Weight on P/E method in blended price | % |  | 0 |  | 0 | 100 | fact_or_estimate | driver | assumption | M | 0 = EV/EBITDAR only (default while earnings are near zero). P/E is ignored automatically when EPS is negative. |
| `corp.it_on` | Include IT program in the 'with IT' case (1 = yes) | 0/1 |  | 1 |  | 0 | 1 | fact_or_estimate | driver | assumption | H |  |
| `corp.it_risk` | Risk-adjust savings with the lever model's confidence weights (1 = yes) | 0/1 |  | 0 |  | 0 | 1 | fact_or_estimate | driver | levers | H | 1 scales gross savings so 2027 net matches the lever model's risk-adjusted net. |
| `corp.it_ot_si` | Report IT one-time costs as special items (1 = excluded from adjusted EPS) | 0/1 |  | 0 |  | 0 | 1 | fact_or_estimate | driver | assumption | M | 0 is conservative: transition costs reduce adjusted EPS in 2027. |
| `corp.it_swb` | Share of IT opex savings landing in salaries, wages and benefits | % |  | 30 |  | 0 | 100 | fact_or_estimate | driver | levers | M | Rest lands in 'Other' opex. Moves nothing at EBITDA level; changes the P&L line. |
| `corp.cust_opex` | Custom: 2027 IT opex savings (scenario 6) | $M |  | 100 |  | 0 | 400 | fact_or_estimate | driver | assumption | M |  |
| `corp.cust_capex` | Custom: 2027 IT capex savings (scenario 6) | $M |  | 10 |  | 0 | 100 | fact_or_estimate | driver | assumption | M |  |
| `corp.cust_ot` | Custom: 2027 one-time costs (scenario 6) | $M |  | 25 |  | 0 | 200 | fact_or_estimate | driver | assumption | M |  |
| `corp.cust_opex28` | Custom: 2028 run-rate IT opex savings (scenario 6) | $M |  | 150 |  | 0 | 500 | fact_or_estimate | driver | assumption | M |  |
| `corp.cust_capex28` | Custom: 2028 run-rate IT capex savings (scenario 6) | $M |  | 15 |  | 0 | 100 | fact_or_estimate | driver | assumption | M |  |
| `corp.lab_hc25` | Headcount FY2025 by labor group | FTE | lgroup | pilots: 16000; flight_attendants: 27000; mechanics: 30000; airport_frontline: 18000; management: 15000 |  |  |  | fact_or_estimate | driver | assumption | L | Labor split by group is an analyst estimate. |
| `corp.lab_rate25` | Average pay per FTE FY2025 (before benefits load) | $k | lgroup | pilots: 330; flight_attendants: 105; mechanics: 112; airport_frontline: 85; management: 175 |  |  |  | fact_or_estimate | driver | assumption | L | Labor split by group is an analyst estimate. |
| `corp.lab_hc_g` | Headcount growth by labor group | % | lgroup,iyear | 10 values (per member) |  | -15 | 15 | fact_or_estimate | driver | assumption | M | Labor split by group is an analyst estimate. |
| `corp.lab_wage_g` | Pay-rate increase by labor group | % | lgroup,iyear | 10 values (per member) |  | -5 | 15 | fact_or_estimate | driver | assumption | M | Labor split by group is an analyst estimate. |
| `corp.it_override` | Use custom IT program values instead of the live lever model (1 = yes) | 0/1 |  | 0 |  | 0 | 1 | fact_or_estimate | driver | spec | H | Replaces corporate it_scen = 6 'Custom'. Scenario choice now comes from the active scenario. |
| `corp.it_swb_mode` | IT labor share of opex savings: 1 = derived from lever pool effects, 0 = manual % | enum |  | 1 |  | 0 | 1 | fact_or_estimate | driver | spec | M | Only moves savings between P&L lines; EBITDA and EPS unaffected. |
| `corp.cal_ocf25` | FY2025 reported operating cash flow (calibration) | $M |  | 3099 |  |  |  | fact_or_estimate | calibration | filing | H | Solves the FY2025 working-capital / other investing / other financing plugs. |
| `corp.cal_fcf25` | FY2025 reported free cash flow (calibration) | $M |  | -83 |  |  |  | fact_or_estimate | calibration | filing | H | Solves the FY2025 working-capital / other investing / other financing plugs. |
| `corp.cal_cash25` | FY2025 reported year-end cash & ST investments (calibration) | $M |  | 5836 |  |  |  | fact_or_estimate | calibration | filing | H | Solves the FY2025 working-capital / other investing / other financing plugs. |
