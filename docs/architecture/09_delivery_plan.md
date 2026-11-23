# 09 · Delivery plan to the Dec 4 demo

Today is Sun 22 Nov 2026. Demo is Fri 4 Dec 2026 (UX storyline, 20 minutes). That is nine working days plus two weekends. The plan front-loads the risky parts (engine parity, write path) and keeps the demo path (Cockpit → Baseline → Levers → VPs → Path → Market → Excel → Airlines) usable from day 4 onward, so each later day adds polish rather than risk.

## 1. Milestones

| Milestone | Date (end of day, US Central) | Exit criteria |
|---|---|---|
| M0 Foundations | Tue 24 Nov | Repo, CI (G1–G2, G13), three-tier folders and compose stack up on the Mac (G14), tokens → CSS, `spec` types generated, DB schema generated + RLS + AA seed loaded |
| M1 Engine | Thu 26 Nov | Engine passes G3 golden parity and G8 budgets; what-if sessions over WS; `applyChangeset` with VR rules; API scenarios/changesets/inputs |
| M2 Walking skeleton | Fri 27 Nov | Tier 1 global layer (rail, scenario bar, flight strip, edit popover, trace drawer, ⌘K) + Cockpit bound to tier 2 through the session; edits persist; G9 green |
| M3 Modules | Tue 1 Dec | Baseline, Levers, VPs, Market bound to tier 2; Path with goal seek, blend (session) and min-risk + Monte Carlo jobs; Excel export + import review + apply (G6 green) |
| M4 Airlines + hardening | Wed 2 Dec | AI reconfig pipeline runs for UA, result cached for demo; demo profile with pinned images and `demo-check.sh`; G10 demo storyline green; visual pass vs `ux/screens/` |
| M5 Freeze | Thu 3 Dec | Market refresh (share price, EIA December STEO), backup, dress rehearsal on the Mac with Wi-Fi off, tag `demo-2026-12-04`, no merges after 18:00 |
| Demo | Fri 4 Dec | — |

## 2. Workstreams (parallel subagents)

| Stream | M0 | M1 | M2 | M3 | M4 |
|---|---|---|---|---|---|
| A Tier 2 engine + solvers | spec types | engine port, parity, benches | what-if sessions | solvers + jobs | perf, cached results |
| B Tier 2/3 data + API + ops | compose, schema gen, RLS, seed | domain write path, API | WS, history/undo | Excel package + routes | AI pipeline, demo profile |
| C Tier 1 UI | tokens, glass primitives | inputs/outputs components | global layer + Cockpit | 7 modules | visual polish, a11y |
| D Quality | CI, testkit | golden + fuzz parity | e2e smoke | storyline e2e | visual baselines, rehearsal |

Max parallel builders: 4 (one per stream), plus one reviewer. The orchestrator serialises merges.

## 3. Demo cut (must) vs post-demo (should / could)

| Must for Dec 4 | Post-demo |
|---|---|
| AA tenant, five presets, custom scenarios, undo | SSO (SAML/OIDC), roles beyond owner/editor/viewer |
| All 194 inputs editable (popover + ⌘K), all 8 modules | Model-version upgrade UI |
| Engine parity, goal seek, blend, breakeven, min-risk, Monte Carlo, tornado | Pareto panel, Sobol panel, VP-feasible UI (jobs exist) |
| Excel export, import review with conflicts, apply | Excel add-in, scheduled exports |
| AI reconfig for UA as a reviewed draft (cached) | Applying UA/AS tenants for real; lever tuning per tenant |
| Local Docker demo stack (no internet needed) | Cloud deployment, live market feeds |

## 4. Risks and responses

| Risk | Likelihood | Response |
|---|---|---|
| Engine port subtle mismatches | Medium | Fuzz parity from day 2; port line by line from `engine.py`; Opus at xhigh effort on the engine items |
| Glass performance on the demo laptop/projector | Medium | Blur budget (07 §5); test on the actual device by Wed 2 Dec; low-blur fallback switch |
| Slider feel with logic in tier 2 | Low (local Docker) | WS previews with coalescing; bench from M1; number-roll animation hides jitter |
| Docker resources on the Mac | Low | 4 CPU / 8 GB to Docker; `demo-check.sh`; close other apps on the day |
| Min-risk solver quality or speed | Medium | Cache results per input hash; seeded deterministic runs; fall back to the reference solver's saved result for presets |
| Venue network | Low | Whole stack runs locally on the Mac; only AI needs internet and its UA result is cached |
| AI research gives wrong UA facts | Medium | Draft-only, sources shown, calibration check; cached rehearsed run |
| Scope creep before freeze | High | Demo-cut table above; orchestrator rejects non-must items after M3 |

## 5. What the person needs to provide (one-time)

1. A GitHub repository for the build (suggested name `glidepath`), attached to the build session.
2. Docker Desktop on the Mac (4 CPU / 8 GB for Docker), and an Anthropic API key for the AI job, stored only in the local `.env`.
3. Which Mac runs the demo, so the build can be rehearsed on it by Wed 2 Dec.
4. Where long test runs go (asked once by the build thread, per project rules).
Everything else uses the assumptions in this folder.
