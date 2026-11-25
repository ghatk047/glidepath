# Glidepath build backlog

The backlog for building Glidepath from M0 (Tue 24 Nov 2026) to the demo freeze (Thu 3 Dec 2026, 18:00 US Central). Written by prompt 10 (`docs/architecture/prompts/10_backlog_writer.md`) with prompt 00 folded in: the ADRs and `docs/architecture/PLANNING_NOTES.md` are items FND-05 and FND-06, and the engine port plan is ENG-01.

141 items in 17 epics: 137 `must`, 4 `should` (2 of them `POST`). Every item is S or M.

## Files

| File | What it is |
|---|---|
| `FND.md`, `OPS.md`, `CON.md`, `SPEC.md`, `ENG.md`, `DATA.md`, `DOM.md`, `API.md`, `JOB.md`, `SOL.md`, `XL.md`, `AI.md`, `UI.md`, `WEB.md`, `MOD.md`, `QA.md`, `INT.md` | One file per epic: a short header, a summary table, then each item as a fenced `yaml` block followed by one or two lines of prose. **These files are the source of truth.** |
| `items.json` | All items, all fields, as a JSON array in file order. Generated; never edit by hand. |
| `plan.md` | Items per milestone and stream, critical path, parallelism per day, model/effort totals, simulated schedule. |
| `coverage.md` | Schema tables, views, validation rules, solvers, Excel tests and sheets, UX modules and components, gates, demo cut and product-owner decisions mapped to items; gaps; uncovered list. |
| `../../tools/backlog/extract.py` | Parses the yaml blocks (stdlib only), validates them and writes `items.json`. |

## How the orchestrator reads it

1. Run `python3 tools/backlog/extract.py` (writes `items.json`) or `--check` (validate only, and fail if `items.json` is stale). It fails on: duplicate ids, missing or empty fields, unknown fields, bad enum values, `L` size, a `depends_on` that does not exist, a dependency cycle, a dependency in a later milestone, a `must` item depending on a `should` item, or `status: blocked` without `blocked_reason`.
2. Load `items.json`. An item is **ready** when every `depends_on` item has `status: done`.
3. Pick ready items `must` first, then by earliest latest-start (the critical path in `plan.md`), at most 4 builders in flight, and never two items whose `package` scopes overlap (see Package scope).
4. Dispatch the builder with the item's `model` and `effort` (prompt `docs/architecture/prompts/21_builder.md`, filled with the yaml block and its `inputs`). Branch `bl/<id>-<slug>`.
5. Reviewer per `prompts/30_reviewer.md`: opus/high, xhigh for ENG, SOL, DOM, DATA (RLS), XL-05 and the session manager (API-06/07).
6. On merge set `status: done` and add `pr:` and `merged_at:` in the epic file's yaml block, then rerun `extract.py` in the same commit.
7. On a second failed review, escalate one step (model or effort, 10 §2) and record it in `escalated_to:`.

### The hard gate (ADR-020)

**ENG-06** (golden 760/760 and parity replay 245/245) is the first hard gate after foundations. No DOM, SOL or API item that consumes engine numbers can become ready before it: the dependency graph enforces this (DOM-05, DOM-06, every SOL item, API-05/06/07/08/09 and everything after them descend from ENG-06). Items that only move input values or structure (DOM-01..04, API-01/02/04, the pure Excel and AI parsing steps, tier-1 modules built against the mock session) may run before it.

## Item fields

| Field | Values | Meaning |
|---|---|---|
| `id` | `EPIC-NN` | Stable id; used in branch names and commit messages. |
| `title` | text | One line. |
| `epic` | FND OPS CON SPEC ENG DATA DOM API JOB SOL XL AI UI WEB MOD QA INT | Must match the id prefix and the file. |
| `milestone` | M0 M1 M2 M3 M4 M5 POST | Done-by milestone (09 §1). POST = after the demo; not scheduled. |
| `priority` | must should could | `must` = demo cut (09 §3). After M3 only `must` items and bug fixes are accepted. |
| `status` | todo in_progress review done blocked | See Status values. |
| `stream` | A B C D | Status-reporting label from 09 §2 (A engine/solvers/domain, B data/API/ops/Excel/AI, C UI, D quality/foundations/integration). Not a builder assignment. |
| `model` | opus sonnet haiku | Claude Code subagent model (rubric 10 §2). |
| `effort` | low medium high xhigh max | Subagent effort (rubric 10 §2). Deviations are explained in `notes`. |
| `depends_on` | list of ids | Must be `done` before the item starts. |
| `tier` | 1 2 3 contract ops | 1 presentation, 2 logic, 3 data, contract = `contract/api-contract`, ops = repo/infra/tests/integration. An item never mixes tiers. |
| `package` | path | The one package or folder the item changes (plus its tests and the generated files it names). |
| `contract` | text | Interface the item implements or consumes. |
| `inputs` | list | Files the builder reads first, with the section (`file#heading`) or symbol (`file (Symbol)`). |
| `acceptance` | list | Testable statements; each maps to one named test, bench or gate. |
| `gates` | G1…G14 | Gates from `08_quality_and_testing.md` that must be green to merge. |
| `size` | S M | S < 2 h agent time, M 2–5 h. No L. |
| `notes` | text | Deviations, risks, owner actions. |
| `pr`, `merged_at`, `blocked_reason`, `escalated_to` | optional | Added by the orchestrator while building. |

The YAML is written in a flat style so the stdlib parser can read it: `key: value`, `key: "json-style string"`, `key: [A, B]`, or `key:` followed by `  - "item"` lines. Keep that style when editing.

## Status values

| Status | Meaning | Set by |
|---|---|---|
| `todo` | Not started. Every item starts here. | Backlog writer |
| `in_progress` | A builder is working on its branch. | Orchestrator on dispatch |
| `review` | Builder finished; gates and reviewer running. | Orchestrator |
| `done` | Merged to `main` with gates green. Add `pr` and `merged_at`. | Orchestrator on merge |
| `blocked` | Cannot proceed; `blocked_reason` names the one thing needed (often an owner action). | Orchestrator |

## Package scope

`package` may be a whole package (`tier2-logic/engine`) or a folder inside one (`tier1-presentation/web/src/modules/cockpit`, `tier2-logic/server/src/session`) so that tier-1 modules and server routes can be built in parallel (ADR-017). Two items conflict when one scope is a prefix of the other (text before ` (` or ` +` is the path); the orchestrator runs conflicting items one after the other.

## Product-owner decisions

Baked into the items (and recorded as ADRs by FND-05):

- **Strict three tiers**: tier 1 has no business logic; every number comes from tier 2 (MOD acceptance says so; G13 via FND-02, FND-03, OPS-05). The approved UX in `docs/ux/` is not changed.
- **Database**: local PostgreSQL 16 in Docker Compose now; the owner moves to Neon later. Connection is configuration only: `DATABASE_URL` (app role `glidepath_app`) and `DATABASE_URL_MIGRATE` (owner role `glidepath_owner`); TLS from the URL (`sslmode=require` must work); no superuser-only features at runtime or in migrations (roles are created outside migrations); tenant context with `SET LOCAL` inside transactions so a transaction pooler (Neon's pooler) works (ADR-015; DATA-01, DATA-02, DATA-04, OPS-01, OPS-07; verified by DATA-09 "Neon readiness", should, POST-safe).
- **Run path**: `docker compose up` on the owner's Mac (Docker Desktop).
- **Engine**: golden parity is the first hard gate after foundations; all ENG items are opus/xhigh.
- **Dates**: milestones as in 09 §1 (M0 Tue 24 Nov … freeze Thu 3 Dec 18:00 CT).

## Build environment

Builders run in a container with Node 22, pnpm 10, Python 3.13 and PostgreSQL 16 binaries in `/usr/lib/postgresql/16/bin`. They cannot reach the owner's Mac and may have no Docker daemon. Therefore:

- Every DB test uses `TEST_DATABASE_URL` if set, else a throwaway cluster from `tools/pg-local` (initdb/pg_ctl, FND-07), else Testcontainers only when `TESTCONTAINERS=1` and a daemon answers (ADR-016). `pnpm pg:local start --ssl` gives an `sslmode=require` URL.
- Compose-level checks (G14, the G13 network test) run in CI and on the Mac; in a daemon-less builder the item checks the YAML/scripts by test and the INT item runs the real check.
- E2E (QA-04) can run against `logic` + `web` started from source on any `DATABASE_URL` when there is no daemon.
- Steps only the owner can do are flagged in item notes: Excel-for-Mac fixture (XL-07), UA rehearsal if no API key is available to builders (AI-07), glass performance and Wi-Fi-off rehearsal on the demo Mac (QA-08, INT-06), market data for the freeze (INT-06).

## Regenerating

Edit the yaml in the epic file, then run `python3 tools/backlog/extract.py`. `plan.md` and `coverage.md` were generated with the backlog; when items change materially, update them in the same commit (the orchestrator re-plans from `items.json` statuses anyway).
