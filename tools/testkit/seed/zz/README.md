# Synthetic tenant `zz` (QA-02)

A fictional airline for multi-tenant tests (docs/architecture/08 section 2). It has no real airline, vendor or mark in it: `zz` is a made-up code, the name is "Zz Synthetic Test Airline", vendors are "Test Service Provider ...", and every line is generic.

Five files in the shape of a tenant seed (docs/spec/01 section 7):
`tenant.json`, `dimension_members.json`, `variable_values.json`, `scenarios.json`, `lever_library.json`. `readTenantSeed(zzSeedDir)` validates them and `zzTenantData(scenario)` resolves a scenario against the spec bundle (both in `index.ts`).

## What differs from the reference tenant

| | `zz` |
|---|---|
| VPs | 5 (`vp_digital`, `vp_flightops`, `vp_enterprise`, `vp_data`, `vp_platform`); `vp_platform` is the shared-services owner; domain shares include 70/30, 40/60 and a five-way split |
| Domains | 13, ids and labels of its own, plus `out_of_scope_memo` (four memo lines, amount 0, owned by no VP) |
| Labour groups | 4 (`flight_deck`, `cabin_crew`, `technical_operations`, `ground_operations`) |
| Vendors | 5 test providers, 4 on the panel and 1 not (`preferred` 0) |
| Baseline | 159 lines in all 11 pools, about $834M, outside-in (every line carries source and confidence) |
| Workforce | 2,200 home-region, 380 offshore, 640 contractors |
| Inputs | target as 12% of base (`g.target_mode` 2), growth not absorbed, VP usage override on and summing to 100%, 1,100 apps, GCC levers tuned low |
| Corporate | a mid-size carrier: about $33B revenue, 612M shares, every figure inside the registry bounds |
| Scenarios | the five global presets, copied; default `C` |
| Lever library | the global text with the reference tenant's company, place and contract references removed |

## Checks

`tools/testkit/src/zz-seed.test.ts`:

- structure and completeness: five VPs, other labour groups, lines in every pool, a value for every registry input and every member key;
- VR01-VR04, VR06, VR07, VR09, VR10 pass on the tenant defaults and on every scenario, and each rule fails when the seed is broken;
- the engine evaluates every scenario and the VR05 and VR08 invariants hold (skipped, with the reason in its title, until the engine can evaluate);
- lint: no airline name, code or mark in any file of this folder.

## Rebuilding

`build.py` generates the five files deterministically (fixed random seed): `python3 build.py <reference-seed-dir> <this-dir>`. The global dimensions (pools, levers, years, ...) and lever-input defaults are read from the reference seed because they belong to the global model; everything tenant-specific is in the script. The JSON is the artefact, so editing it by hand is fine when the test stays green.
