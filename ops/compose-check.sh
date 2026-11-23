#!/usr/bin/env bash
# ops/compose-check.sh (OPS-05): the compose stack starts from clean volumes in under 3 minutes
# (G14) and the web container cannot reach the data tier (G13 network test).
#
#   ops/compose-check.sh [options]
#
#   --dry-run          print the plan and the exact commands; touch nothing (no docker needed)
#   --no-build         use the glidepath/logic and glidepath/web images already present
#   --extra-ca PATH    PEM bundle handed to the image builds as BuildKit secret `extra-ca`
#                      (TLS-inspecting proxy; env COMPOSE_CHECK_EXTRA_CA)
#   --env-file PATH    Compose env file (default .env; env COMPOSE_CHECK_ENV_FILE)
#   --project NAME     Compose project (default glidepath-check, so the check never wipes the
#                      volumes of a developer's own `glidepath` stack; env COMPOSE_CHECK_PROJECT)
#   --budget SECONDS   start-up budget (default 180, the G14 figure; env COMPOSE_CHECK_BUDGET)
#   --settle SECONDS   how long services without a healthcheck must stay up (default 5)
#   --strict           a stubbed service is a FAIL, not PENDING (env COMPOSE_CHECK_STRICT=1; also
#                      implied when ops/docker/logic/Dockerfile defaults STRICT_ENTRYPOINTS=1)
#   --keep             leave the stack running afterwards (default: `down -v`)
#   -h, --help         this text
#
# What it does: build the two images (unless --no-build; build time is not in the budget),
# `down -v` the project (clean volumes), `up -d`, poll every second until every service is
# healthy / completed, print a per-service timing table, then run the network test inside the
# web container: `getent hosts db` and `getent hosts objects` must exit 2 (name not found),
# while a control lookup (`logic`, else `web`) must resolve, so a missing getent cannot pass.
#
# Exit codes (the contract). The LAST line is always "compose-check: <STATUS>: <one-line reason>"
# (stdout for PASS, stderr otherwise).
#   0  PASS      every service healthy or completed within the budget, web cannot reach db/objects
#   1  FAIL      a service failed or is unhealthy, up failed, or web can resolve a data-tier host
#   2  USAGE     bad option, missing docker / daemon / env file / secrets (nothing was started)
#   3  BUDGET    nothing failed but the stack was not healthy within the budget
#   4  PENDING   a service is an unbuilt stub (exit 78 plus the stub message, OPS-02) or blocked by
#                one: the stack is incomplete, so it is reported (never counted as green) but is
#                not an error. CI turns it into a ::notice. Any other exit 78 is a plain FAIL, and
#                with --strict (or once the logic Dockerfile defaults STRICT_ENTRYPOINTS=1) a
#                stub is a FAIL too.
# Precedence when several apply: 1, then 4, then 3. 130 = interrupted.
#
# Written for bash 3.2 (macOS) and GNU bash; no jq, timeout or GNU date needed.

set -u -o pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STUB_EXIT=78 # EX_CONFIG, written by ops/docker/logic/collect-dist.sh
STUB_MARKER='is a stub'
SECRETS="POSTGRES_PASSWORD OWNER_DB_PASSWORD APP_DB_PASSWORD AUTH_SECRET"

DRY_RUN=0
BUILD=1
KEEP=0
STRICT="${COMPOSE_CHECK_STRICT:-0}"
EXTRA_CA="${COMPOSE_CHECK_EXTRA_CA:-}"
ENV_FILE="${COMPOSE_CHECK_ENV_FILE:-.env}"
PROJECT="${COMPOSE_CHECK_PROJECT:-glidepath-check}"
BUDGET="${COMPOSE_CHECK_BUDGET:-180}"
SETTLE=5

usage() { sed -n '2,/^# Written for/p' "${BASH_SOURCE[0]}" | sed '$d' | sed 's/^# \{0,1\}//'; }

die_usage() {
  echo "compose-check: USAGE: $1" >&2
  exit 2
}

is_uint() { case "$1" in '' | *[!0-9]*) return 1 ;; *) return 0 ;; esac; }

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --no-build) BUILD=0 ;;
    --keep) KEEP=1 ;;
    --strict) STRICT=1 ;;
    --extra-ca | --env-file | --project | --budget | --settle)
      [ $# -ge 2 ] || die_usage "$1 needs a value"
      case "$1" in
        --extra-ca) EXTRA_CA="$2" ;;
        --env-file) ENV_FILE="$2" ;;
        --project) PROJECT="$2" ;;
        --budget) BUDGET="$2" ;;
        --settle) SETTLE="$2" ;;
      esac
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *) die_usage "unknown option $1 (see --help)" ;;
  esac
  shift
done

{ is_uint "$BUDGET" && [ "$BUDGET" -gt 0 ]; } || die_usage "--budget must be a positive whole number of seconds"
is_uint "$SETTLE" || die_usage "--settle must be a whole number of seconds"
case "$PROJECT" in '' | *[!a-z0-9_-]* | [-_]*) die_usage "--project must be lowercase letters, digits, - or _" ;; esac
[ -z "$EXTRA_CA" ] || [ "$DRY_RUN" = 1 ] || [ -f "$EXTRA_CA" ] || die_usage "--extra-ca file not found: $EXTRA_CA"

cd "$ROOT" || die_usage "cannot enter $ROOT"

env_val() { # env_val NAME: last NAME=value in the env file (no quote handling, as .env.example)
  [ -f "$ENV_FILE" ] || return 0
  grep -E "^$1=" "$ENV_FILE" | tail -n 1 | cut -d= -f2-
}
TAG="$(env_val TAG)"
TAG="${TAG:-dev}"
# Once the image build is strict by default no stub can exist; one that shows up is a bug.
if [ "$(sed -n 's/^ARG STRICT_ENTRYPOINTS=//p' ops/docker/logic/Dockerfile 2>/dev/null | head -n 1)" = 1 ]; then STRICT=1; fi

dc() { docker compose -p "$PROJECT" --env-file "$ENV_FILE" -f "$ROOT/docker-compose.yml" "$@"; }

# M0 checks (INT-01): migrations the migrate service must have applied, the tenant its
# `--seed <id>` argument loads, and the token stylesheet tier 1 must serve.
MIGRATIONS_DIR=tier3-data/migrations
TOKENS_CSS=tier1-presentation/ui/src/tokens/tokens.css
SEED="$(sed -n 's/.*"--seed", *"\([a-z0-9_-]*\)".*/\1/p' docker-compose.yml | head -n 1)"

# image:Dockerfile; ops/test/compose-check.spec.ts keeps this in step with docker-compose.yml
IMAGES="glidepath/logic:ops/docker/logic/Dockerfile glidepath/web:ops/docker/web/Dockerfile"

# ------------------------------------------------------------------ dry run
if [ "$DRY_RUN" = 1 ]; then
  echo "compose-check: dry run, nothing is started (project $PROJECT, budget ${BUDGET}s, tag $TAG)"
  echo "plan:"
  echo "  1. preflight: docker CLI, compose plugin, daemon (docker info), env file $ENV_FILE, secrets set: $SECRETS"
  if [ "$BUILD" = 1 ]; then
    for pair in $IMAGES; do
      echo "  2. build (not counted in the budget): docker build -q -f ${pair#*:} -t ${pair%%:*}:$TAG${EXTRA_CA:+ --secret id=extra-ca,src=$EXTRA_CA} ."
    done
  else
    echo "  2. build skipped (--no-build): images glidepath/logic:$TAG and glidepath/web:$TAG must exist"
  fi
  echo "  3. clean volumes: docker compose -p $PROJECT --env-file $ENV_FILE down -v --remove-orphans"
  echo "  4. start: docker compose -p $PROJECT --env-file $ENV_FILE up -d  (poll every 1s, budget ${BUDGET}s, per-service timings)"
  echo "  5. settle ${SETTLE}s: services without a healthcheck must still be running, no restarts"
  echo "  6. network test (G13) in the web container:"
  echo "       docker compose -p $PROJECT exec -T web getent hosts db       -> must exit 2 (not found)"
  echo "       docker compose -p $PROJECT exec -T web getent hosts objects  -> must exit 2 (not found)"
  echo "       docker compose -p $PROJECT exec -T web getent hosts logic    -> control, must resolve"
  echo "       docker inspect web: not attached to the data network"
  echo "  7. data tier (M0, INT-01), once migrate has completed, in the db container (psql as postgres):"
  echo "       every tier3-data/migrations/{,manual/}*.sql recorded in schema_migration"
  echo "       every tenant table (tenant, or a tenant_id column) has relrowsecurity and relforcerowsecurity"
  echo "       every CREATE VIEW of the migrations present in pg_views"
  echo "       the tenant of the migrate command's --seed (${SEED:-none}) has a row in tenant"
  echo "  8. design tokens (M0, INT-01): every custom property of tier1-presentation/ui/src/tokens/tokens.css"
  echo "       appears in the CSS that web serves from /srv"
  if [ "$KEEP" = 1 ]; then
    echo "  9. teardown skipped (--keep)"
  else
    echo "  9. teardown: docker compose -p $PROJECT down -v --remove-orphans"
  fi
  echo "exit codes: 0 PASS, 1 FAIL, 2 USAGE, 3 BUDGET, 4 PENDING = stubbed services (precedence 1, 4, 3)"
  echo "compose-check: DRY-RUN: plan printed, nothing started"
  exit 0
fi

# ------------------------------------------------------------------ state
TMP="$(mktemp -d "${TMPDIR:-/tmp}/compose-check.XXXXXX")" || die_usage "cannot create a temp dir"
UP_PID=""
STARTED=0
FAILS="" # "; "-joined reasons, exit 1
STUBS="" # comma-joined service names, exit 4
SLOW=""  # reason, exit 3

add_fail() { FAILS="${FAILS:+$FAILS; }$1"; }

teardown() {
  if [ -n "$UP_PID" ] && kill -0 "$UP_PID" 2>/dev/null; then kill "$UP_PID" 2>/dev/null; fi
  if [ "$STARTED" = 1 ] && [ "$KEEP" = 0 ]; then
    dc down -v --remove-orphans >/dev/null 2>&1
  fi
  rm -rf "$TMP"
}

finish() { # finish CODE STATUS REASON
  teardown
  if [ "$1" = 0 ]; then
    echo "compose-check: $2: $3"
  else
    echo "compose-check: $2: $3" >&2
  fi
  exit "$1"
}

# shellcheck disable=SC2329 # invoked by trap
on_signal() { finish 130 INTERRUPTED "interrupted by signal"; }
trap on_signal INT TERM

# ------------------------------------------------------------------ preflight
echo "compose-check: project $PROJECT, budget ${BUDGET}s, tag $TAG"
command -v docker >/dev/null 2>&1 || finish 2 USAGE "docker CLI not found (use --dry-run without a daemon)"
docker compose version >/dev/null 2>&1 || finish 2 USAGE "docker compose plugin not found"
docker info >/dev/null 2>&1 || finish 2 USAGE "cannot reach the Docker daemon (is it running?)"
[ -f "$ENV_FILE" ] || finish 2 USAGE "env file $ENV_FILE not found (cp .env.example .env and fill the secrets)"
for s in $SECRETS; do
  [ -n "$(env_val "$s")" ] || finish 2 USAGE "$s is empty in $ENV_FILE (fill the secrets; CI generates them)"
done
SERVICES="$(dc config --services 2>"$TMP/config.err")" || finish 2 USAGE "docker compose config failed: $(tail -n 1 "$TMP/config.err")"
[ -n "$SERVICES" ] || finish 2 USAGE "docker compose config lists no services"
TOTAL="$(echo "$SERVICES" | wc -w | tr -d ' ')"

# ------------------------------------------------------------------ build
if [ "$BUILD" = 1 ]; then
  for pair in $IMAGES; do
    img="${pair%%:*}"
    df="${pair#*:}"
    t0=$SECONDS
    echo "build: $img:$TAG"
    if [ -n "$EXTRA_CA" ]; then
      docker build -q -f "$df" -t "$img:$TAG" --secret "id=extra-ca,src=$EXTRA_CA" . >"$TMP/build.log" 2>&1
    else
      docker build -q -f "$df" -t "$img:$TAG" . >"$TMP/build.log" 2>&1
    fi || {
      tail -n 15 "$TMP/build.log" >&2
      finish 1 FAIL "image build failed: $img ($df)"
    }
    echo "build: $img:$TAG done in $((SECONDS - t0))s (not counted in the budget)"
  done
else
  for pair in $IMAGES; do
    docker image inspect "${pair%%:*}:$TAG" >/dev/null 2>&1 || finish 2 USAGE "--no-build but image ${pair%%:*}:$TAG is missing"
  done
fi

# ------------------------------------------------------------------ helpers over container state
# snapshot: one line per container: "service status health exitcode restarts id"
snapshot() {
  : >"$TMP/snap"
  local ids
  ids="$(dc ps -a -q 2>/dev/null)"
  [ -n "$ids" ] || return 0
  # shellcheck disable=SC2086 # ids are hex words
  docker inspect -f '{{index .Config.Labels "com.docker.compose.service"}} {{.State.Status}} {{if index .State "Health"}}{{(index .State "Health").Status}}{{else}}-{{end}} {{.State.ExitCode}} {{.RestartCount}} {{.Id}}' $ids >"$TMP/snap" 2>"$TMP/snap.err" ||
    finish 1 FAIL "docker inspect failed, cannot read container state: $(tail -n 1 "$TMP/snap.err")"
}

snap_field() { # snap_field SERVICE N  (1 service 2 status 3 health 4 exit 5 restarts 6 id)
  awk -v s="$1" -v n="$2" '$1 == s { print $n; exit }' "$TMP/snap"
}

is_stub() { # is_stub ID: the stub message (collect-dist.sh) is in the container log
  docker logs --tail 20 "$1" 2>&1 | grep -q "$STUB_MARKER"
}

# classify SERVICE -> ready | completed | stub | failed | pending (starting) | waiting (not started) | absent
classify() {
  local svc="$1" status health code restarts id
  status="$(snap_field "$svc" 2)"
  [ -n "$status" ] || { echo absent; return; }
  health="$(snap_field "$svc" 3)"
  code="$(snap_field "$svc" 4)"
  restarts="$(snap_field "$svc" 5)"
  id="$(snap_field "$svc" 6)"
  case "$status" in
    running)
      case "$health" in
        healthy) echo ready ;;
        starting) echo pending ;;
        unhealthy) echo failed ;;
        *)
          if [ "$restarts" -gt 0 ]; then
            if is_stub "$id"; then echo stub; else echo failed; fi
          else
            echo ready
          fi
          ;;
      esac
      ;;
    exited | restarting)
      if [ "$status" = exited ] && [ "$code" = 0 ]; then
        echo completed
      elif is_stub "$id"; then
        echo stub
      else
        echo failed
      fi
      ;;
    created) echo waiting ;;
    *) echo failed ;;
  esac
}

tier_of() {
  case "$1" in
    web) echo "1" ;;
    logic | worker | migrate) echo "2" ;;
    db) echo "3" ;;
    *) echo "dev" ;;
  esac
}

log_tail() { # log_tail SERVICE: last log lines of a service, to stderr
  local id
  id="$(snap_field "$1" 6)"
  [ -n "$id" ] || return 0
  echo "--- last log lines of $1" >&2
  docker logs --tail 12 "$id" >&2 2>&1
}

# ------------------------------------------------------------------ clean start
echo "clean: docker compose down -v (project $PROJECT)"
dc down -v --remove-orphans >"$TMP/down.log" 2>&1 || finish 1 FAIL "docker compose down -v failed: $(tail -n 1 "$TMP/down.log")"
STARTED=1

echo "start: docker compose up -d (budget ${BUDGET}s)"
T0=$SECONDS
dc up -d >"$TMP/up.log" 2>&1 &
UP_PID=$!
UP_DONE=0
UP_RC=0
DEADLINE=$((T0 + BUDGET))
ALL_DONE=0

while :; do
  snapshot
  elapsed=$((SECONDS - T0))
  ok=0
  terminal=0
  for svc in $SERVICES; do
    c="$(classify "$svc")"
    case "$c" in
      ready | completed)
        [ -f "$TMP/t.$svc" ] || echo "$elapsed" >"$TMP/t.$svc"
        echo "$c" >"$TMP/r.$svc"
        ok=$((ok + 1))
        ;;
      failed | stub)
        [ -f "$TMP/t.$svc" ] || echo "$elapsed" >"$TMP/t.$svc"
        echo "$c" >"$TMP/r.$svc"
        terminal=$((terminal + 1))
        ;;
    esac
  done
  if [ "$UP_DONE" = 0 ] && ! kill -0 "$UP_PID" 2>/dev/null; then
    wait "$UP_PID"
    UP_RC=$?
    UP_PID=""
    UP_DONE=1
  fi
  if [ "$ok" = "$TOTAL" ]; then
    ALL_DONE=1
    break
  fi
  # a failed or stubbed service stops everything behind it; once up has returned nothing more will change
  if [ "$UP_DONE" = 1 ] && [ "$terminal" -gt 0 ]; then break; fi
  # up failed without any service failing (port in use, pull error): give state 5s to appear, then stop
  if [ "$UP_DONE" = 1 ] && [ "$UP_RC" != 0 ] && [ "$elapsed" -ge 5 ]; then break; fi
  if [ "$SECONDS" -ge "$DEADLINE" ]; then break; fi
  sleep 1
done

if [ "$UP_DONE" = 0 ] && [ -n "$UP_PID" ]; then
  kill "$UP_PID" 2>/dev/null
  wait "$UP_PID" 2>/dev/null
  UP_PID=""
fi
START_ELAPSED=$((SECONDS - T0))

# Settle: a service without a healthcheck (worker) is "running" the instant it starts.
if [ "$ALL_DONE" = 1 ] && [ "$SETTLE" -gt 0 ]; then
  sleep "$SETTLE"
  snapshot
  for svc in $SERVICES; do
    c="$(classify "$svc")"
    case "$c" in
      ready | completed) ;;
      *)
        echo "$c" >"$TMP/r.$svc"
        ALL_DONE=0
        ;;
    esac
  done
fi

# ------------------------------------------------------------------ per-service results
echo
echo "Per-service timings (seconds after docker compose up):"
printf '  %-10s %-5s %-12s %s\n' SERVICE TIER RESULT SECONDS
BLOCKED=""
for svc in $SERVICES; do
  r="$(cat "$TMP/r.$svc" 2>/dev/null)"
  if [ -z "$r" ]; then
    r="$(classify "$svc")"
    case "$r" in
      absent | waiting) r=blocked ;;
    esac
    BLOCKED="${BLOCKED:+$BLOCKED,}$svc"
  fi
  t="$(cat "$TMP/t.$svc" 2>/dev/null)"
  case "$r" in
    ready) label="healthy" ;;
    stub) label="STUB($STUB_EXIT)" ;;
    failed) label="FAILED" ;;
    blocked) label="NOT STARTED" ;;
    pending) label="NOT HEALTHY" ;;
    *) label="$r" ;;
  esac
  printf '  %-10s %-5s %-12s %s\n' "$svc" "$(tier_of "$svc")" "$label" "${t:--}"
  case "$r" in
    stub) STUBS="${STUBS:+$STUBS,}$svc" ;;
    failed) add_fail "$svc failed or unhealthy" ;;
  esac
done
echo "  stack start: ${START_ELAPSED}s (budget ${BUDGET}s)"

UP_SAID=""
if [ "$UP_DONE" = 1 ] && [ "$UP_RC" != 0 ]; then
  UP_SAID="$(grep -v '^[[:space:]]*$' "$TMP/up.log" | tail -n 1)"
  echo "  docker compose up exited $UP_RC: $UP_SAID"
fi
if [ -n "$STUBS" ]; then
  echo
  echo "STUBBED services (exit $STUB_EXIT: the entry was not built into the image, OPS-02): $STUBS"
  if [ "$STRICT" = 1 ]; then
    add_fail "stubbed services in strict mode (entries must be built): $STUBS"
    STUBS=""
  fi
  [ -z "$BLOCKED" ] || echo "Not started or not ready because of it: $BLOCKED"
fi
if [ -n "$FAILS" ]; then
  for svc in $SERVICES; do
    [ "$(cat "$TMP/r.$svc" 2>/dev/null)" = failed ] && log_tail "$svc"
  done
fi
if [ -z "$FAILS" ] && [ -z "$STUBS" ]; then
  if [ -n "$UP_SAID" ]; then
    add_fail "docker compose up failed: $UP_SAID"
  elif [ -n "$BLOCKED" ]; then
    SLOW="not healthy within ${BUDGET}s: $BLOCKED"
  elif [ "$START_ELAPSED" -gt "$BUDGET" ]; then
    SLOW="healthy after ${START_ELAPSED}s, over the ${BUDGET}s budget"
  fi
fi

# ------------------------------------------------------------------ G13 network test
echo
echo "Network test (G13): the web container must not reach the data tier"
snapshot
if [ "$(snap_field web 2)" != running ]; then
  echo "  web is not running (its dependencies did not come up); starting it alone: docker compose up -d --no-deps web"
  dc up -d --no-deps web >"$TMP/web.log" 2>&1 || add_fail "web could not be started for the network test: $(tail -n 1 "$TMP/web.log")"
  w=0
  while [ "$w" -lt 60 ]; do
    snapshot
    [ "$(snap_field web 2)" = running ] && break
    sleep 1
    w=$((w + 1))
  done
  snapshot
fi
if [ "$(snap_field web 2)" != running ]; then
  add_fail "web container is not running, network test not possible"
else
  for host in db objects; do
    dc exec -T web getent hosts "$host" >"$TMP/getent.out" 2>&1
    rc=$?
    case "$rc" in
      2) echo "  getent hosts $host: not found (exit 2)  ok" ;;
      0)
        echo "  getent hosts $host: RESOLVES ($(tr -s ' ' <"$TMP/getent.out" | head -n 1))  FAIL"
        add_fail "web resolves $host (tier separation broken)"
        ;;
      *)
        echo "  getent hosts $host: exit $rc, inconclusive  FAIL"
        add_fail "network test inconclusive: getent hosts $host exited $rc in web"
        ;;
    esac
  done
  control=logic
  [ "$(snap_field logic 2)" = running ] || control=web
  if dc exec -T web getent hosts "$control" >/dev/null 2>&1; then
    echo "  control: getent hosts $control resolves, so the not-found results above are real  ok"
  else
    echo "  control: getent hosts $control did NOT resolve  FAIL"
    add_fail "network test control failed: web cannot resolve $control, so the result proves nothing"
  fi
  nets="$(docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' "$(snap_field web 6)" 2>/dev/null)"
  echo "  web networks: ${nets:-none}"
  case " $nets " in
    *"_data "*) add_fail "web is attached to the data network ($nets)" ;;
  esac
fi

# ------------------------------------------------------------------ M0 data tier (INT-01)
echo
echo "Data tier (M0): schema, RLS and views applied by migrate, seed loaded"
DATA_CHECKED=0
mig_state="$(cat "$TMP/r.migrate" 2>/dev/null)"
has_db=0
has_migrate=0
for svc in $SERVICES; do
  [ "$svc" = db ] && has_db=1
  [ "$svc" = migrate ] && has_migrate=1
done
db_q() { # db_q SQL: one query as the bootstrap superuser of the local db container
  dc exec -T db psql -U postgres -d glidepath -At -v ON_ERROR_STOP=1 -c "$1" 2>"$TMP/psql.err"
}
if [ "$has_db" = 0 ] || [ "$has_migrate" = 0 ]; then
  echo "  data tier: not checked, no db and migrate services in this project"
elif [ "$mig_state" != completed ]; then
  echo "  data tier: not checked, migrate did not complete (${mig_state:-not started})"
else
  DATA_CHECKED=1
  # 1. every migration file recorded as applied
  if applied="$(db_q "SELECT id FROM schema_migration ORDER BY id")"; then
    expected=0
    missing=""
    for f in "$MIGRATIONS_DIR"/*.sql "$MIGRATIONS_DIR"/manual/*.sql; do
      [ -f "$f" ] || continue
      id="${f#"$MIGRATIONS_DIR"/}"
      expected=$((expected + 1))
      echo "$applied" | grep -Fxq "$id" || missing="${missing:+$missing, }$id"
    done
    if [ "$expected" = 0 ]; then
      add_fail "no migration files under $MIGRATIONS_DIR"
    elif [ -n "$missing" ]; then
      echo "  migrations NOT applied: $missing  FAIL"
      add_fail "migrations not applied by migrate: $missing"
    else
      echo "  migrations applied: $expected of $expected  ok"
    fi
  else
    add_fail "cannot read schema_migration (migrate applied nothing?): $(tail -n 1 "$TMP/psql.err")"
  fi
  # 2. RLS enabled and forced on every tenant table (the tenant table itself, or a tenant_id column)
  rls="$(db_q "SELECT count(*) || '|' || coalesce(string_agg(c.relname, ',' ORDER BY c.relname) FILTER (WHERE NOT (c.relrowsecurity AND c.relforcerowsecurity)), '') FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND (c.relname = 'tenant' OR EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped))")" ||
    rls="ERR"
  case "$rls" in
    ERR) add_fail "RLS catalog query failed: $(tail -n 1 "$TMP/psql.err")" ;;
    0\|*) add_fail "no tenant tables found after migrate" ;;
    *\|) echo "  RLS enabled and forced on all ${rls%|} tenant tables  ok" ;;
    *)
      echo "  RLS missing on: ${rls#*|}  FAIL"
      add_fail "RLS not enabled and forced on tenant tables: ${rls#*|}"
      ;;
  esac
  # 3. every view the migrations create
  want_views="$(grep -ohE 'CREATE (OR REPLACE )?VIEW [a-z_]+' "$MIGRATIONS_DIR"/*.sql "$MIGRATIONS_DIR"/manual/*.sql 2>/dev/null | awk '{print $NF}')"
  if have_views="$(db_q "SELECT viewname FROM pg_views WHERE schemaname = 'public'")"; then
    missing=""
    for v in $want_views; do
      echo "$have_views" | grep -Fxq "$v" || missing="${missing:+$missing, }$v"
    done
    if [ -n "$missing" ]; then
      echo "  views missing: $missing  FAIL"
      add_fail "views missing after migrate: $missing"
    else
      echo "  views present: $(echo "$want_views" | tr '\n' ' ' | sed 's/ *$//; s/ /, /g')  ok"
    fi
  else
    add_fail "pg_views query failed: $(tail -n 1 "$TMP/psql.err")"
  fi
  # 4. the seeded tenant (slug = the --seed argument of the migrate command)
  if [ -n "$SEED" ]; then
    n="$(db_q "SELECT count(*) FROM tenant WHERE slug = '$SEED'")" || n="ERR"
    case "$n" in
      ERR) add_fail "tenant query failed: $(tail -n 1 "$TMP/psql.err")" ;;
      0)
        echo "  seed tenant \"$SEED\" NOT loaded  FAIL"
        add_fail "seed tenant \"$SEED\" not loaded by migrate"
        ;;
      *) echo "  seed tenant \"$SEED\" loaded  ok" ;;
    esac
  fi
fi

# ------------------------------------------------------------------ M0 design tokens (INT-01)
echo
echo "Design tokens (M0): tokens.css custom properties in the CSS that web serves"
if [ ! -f "$TOKENS_CSS" ]; then
  add_fail "$TOKENS_CSS not found (UI-01 generates it)"
elif [ "$(snap_field web 2)" != running ]; then
  echo "  not checked, web is not running"
else
  # shellcheck disable=SC2016 # the globs expand inside the container
  dc exec -T web sh -c 'cat /srv/*.css /srv/assets/*.css 2>/dev/null; true' >"$TMP/served.css" 2>&1
  total=0
  absent=0
  first=""
  grep -o -- '--[A-Za-z0-9_-]*:' "$TOKENS_CSS" | sort -u >"$TMP/tokens.props"
  while IFS= read -r prop; do
    total=$((total + 1))
    if ! grep -Fq -- "$prop" "$TMP/served.css"; then
      absent=$((absent + 1))
      [ -n "$first" ] || first="${prop%:}"
    fi
  done <"$TMP/tokens.props"
  if [ "$total" = 0 ]; then
    add_fail "$TOKENS_CSS defines no custom properties"
  elif [ "$absent" -gt 0 ]; then
    echo "  design tokens in the served CSS: $((total - absent)) of $total (first missing $first)  FAIL"
    add_fail "web serves no design token CSS: $absent of $total custom properties missing (first $first)"
  else
    echo "  design tokens in the served CSS: $total of $total  ok"
  fi
fi

# ------------------------------------------------------------------ verdict
echo
if [ -n "$FAILS" ]; then
  finish 1 FAIL "$FAILS"
elif [ -n "$STUBS" ]; then
  data_note=""
  [ "$DATA_CHECKED" = 1 ] || data_note="; data tier not verified"
  finish 4 PENDING "stubbed (exit $STUB_EXIT, entry not built): $STUBS; stack incomplete${BLOCKED:+, not ready: $BLOCKED}; start-up time not verified$data_note"
elif [ -n "$SLOW" ]; then
  finish 3 BUDGET "$SLOW"
else
  finish 0 PASS "all $TOTAL services healthy or completed in ${START_ELAPSED}s (budget ${BUDGET}s), web cannot reach db or objects"
fi
