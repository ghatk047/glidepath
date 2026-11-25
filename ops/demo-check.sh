#!/usr/bin/env bash
# ops/demo-check.sh (OPS-06): is the demo stack ready? Run it on the demo Mac before the demo (and as the last
# step of the freeze, docs/architecture/prompts/20_orchestrator.md) after
# `docker compose --profile demo up -d`.
#
#   ops/demo-check.sh [options]
#
#   --env-file PATH     Compose env file (default .env; env DEMO_CHECK_ENV_FILE)
#   --project NAME      Compose project of the stack (default: Compose's own, from COMPOSE_PROJECT_NAME or the
#                       folder; env DEMO_CHECK_PROJECT)
#   --web URL           where the web container answers (default https://localhost; loopback only)
#   --mail URL          the mail sink (default http://127.0.0.1:8025; loopback only)
#   --email ADDR        the demo user to sign in (default DEMO_USER_EMAIL of the env file)
#   --mail-timeout SEC  how long to wait for the sign-in mail (default 15)
#   --allow-unpinned    do not require every image to be pinned by digest (a dev stack)
#   --skip-containers   only the HTTP checks (the stack is not Compose, or a fixture)
#   --isolated          run the HTTP checks in a container on `--network none`: the two ports reach it as unix
#                       sockets from ops/demo-check-relay.mjs, so it cannot resolve or reach any host (Linux and
#                       Docker Engine; Docker Desktop for Mac cannot bind-mount host sockets)
#   --image IMAGE       image for --isolated; any image with node 22 (default the stack's glidepath/logic)
#   -h, --help          this text
#
# Checks, in order (each prints PASS or FAIL with its reason):
#   containers   every service of the demo profile is running and healthy (migrate exited 0), and every image is
#                pinned by digest (@sha256:...)
#   sign-in      requests a magic link for the demo user, reads it from the mail sink, opens it (GAP-09)
#   AA seed      tenant aa with scenarios C and D
#   calc C       GET /calc for C equals golden_results.json C: res.net, res.gap, res.risk, br.eps27, 1e-6 relative
#   caches       Monte Carlo for C and D and min-risk for C are cached; the min-risk result matches
#                solver_demo_results.json min_risk_total_bar within the G5 tolerances of @glidepath/parity
#                (a cache warmed before SOL-12 shows risk 42.5, not 42.0, and fails here)
#   parity       the Airlines tile's parity record is there and complete
#   UA draft     the rehearsed UA reconfiguration is cached, in review, with its drafts (AI-07); with AI_ENABLED=0
#                (environment, else the env file; .env.example's default) it prints "SKIP ...: skipped (AI off)"
#
# The checks talk to localhost only (127.0.0.1 by address, no DNS), so Wi-Fi can be off.
#
# Exit codes: 0 PASS, 1 FAIL (the last line is "demo-check: FAIL: <first reason>", on stderr), 2 USAGE.
# Written for bash 3.2 (macOS) and GNU bash; needs node 22 and pnpm (the repo's own tools), no jq.

set -u -o pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${DEMO_CHECK_ENV_FILE:-.env}"
PROJECT="${DEMO_CHECK_PROJECT:-}"
WEB=""
MAIL="http://127.0.0.1:8025"
EMAIL=""
PINNED=1
CONTAINERS=1
ISOLATED=0
IMAGE=""
MAIL_TIMEOUT=15

usage() { sed -n '2,/^# Written for/p' "${BASH_SOURCE[0]}" | sed '$d' | sed 's/^# \{0,1\}//'; }
die() {
  echo "demo-check: $1" >&2
  exit "${2:-2}"
}
fail() {
  echo "FAIL $1" >&2
  echo "demo-check: FAIL: $2" >&2
  exit 1
}

while [ $# -gt 0 ]; do
  case "$1" in
    --env-file | --project | --web | --mail | --email | --image | --mail-timeout)
      [ $# -ge 2 ] || die "$1 needs a value"
      case "$1" in
        --env-file) ENV_FILE="$2" ;;
        --project) PROJECT="$2" ;;
        --web) WEB="$2" ;;
        --mail) MAIL="$2" ;;
        --email) EMAIL="$2" ;;
        --image) IMAGE="$2" ;;
        --mail-timeout) MAIL_TIMEOUT="$2" ;;
      esac
      shift
      ;;
    --allow-unpinned) PINNED=0 ;;
    --skip-containers) CONTAINERS=0 ;;
    --isolated) ISOLATED=1 ;;
    -h | --help) usage; exit 0 ;;
    *) die "unknown option: $1 (see --help)" ;;
  esac
  shift
done

cd "$ROOT" || die "cannot enter $ROOT"
env_value() { [ -f "$ENV_FILE" ] && grep "^$1=" "$ENV_FILE" | tail -n 1 | cut -d= -f2-; }
[ -n "$EMAIL" ] || EMAIL="$(env_value DEMO_USER_EMAIL)"
[ -n "$EMAIL" ] || EMAIL="demo@example.com"
AI_ENABLED="${AI_ENABLED:-$(env_value AI_ENABLED)}"
AI_ARGS=""
[ -z "$AI_ENABLED" ] || AI_ARGS="--ai-enabled $AI_ENABLED"
if [ -z "$WEB" ]; then
  WEB="$(env_value PUBLIC_BASE_URL)"
  case "$WEB" in https://localhost* | http://localhost* | https://127.0.0.1* | http://127.0.0.1*) ;; *) WEB="https://localhost" ;; esac
fi

TMP="$(mktemp -d "${TMPDIR:-/tmp}/demo-check.XXXXXX")" || die "cannot make a temp dir"
chmod 0755 "$TMP"
RELAY_PID=""
# shellcheck disable=SC2329 # run by the EXIT trap
cleanup() {
  [ -z "$RELAY_PID" ] || kill "$RELAY_PID" 2>/dev/null
  rm -rf "$TMP"
}
trap cleanup EXIT

# ------------------------------------------------------------------ containers
compose() {
  if [ -f "$ENV_FILE" ]; then
    docker compose --env-file "$ENV_FILE" ${PROJECT:+-p "$PROJECT"} --profile demo "$@"
  else
    docker compose ${PROJECT:+-p "$PROJECT"} --profile demo "$@"
  fi
}

STACK_IMAGE=""
if [ "$CONTAINERS" = 1 ]; then
  command -v docker >/dev/null 2>&1 || die "docker not found (use --skip-containers for the HTTP checks alone)"
  services="$(compose config --services 2>"$TMP/err")" || fail "containers" "docker compose config failed: $(head -n 1 "$TMP/err")"
  ps="$(compose ps -a --format '{{.Service}}|{{.State}}|{{.Health}}|{{.ExitCode}}' 2>"$TMP/err")" || fail "containers" "docker compose ps failed: $(head -n 1 "$TMP/err")"
  for svc in $services; do
    row="$(printf '%s\n' "$ps" | grep "^${svc}|" | head -n 1)"
    [ -n "$row" ] || fail "containers" "service $svc is not created (docker compose --profile demo up -d)"
    IFS='|' read -r _ state health code <<<"$row"
    if [ "$svc" = migrate ]; then
      [ "$state" = exited ] && [ "$code" = 0 ] || fail "containers" "migrate is $state (exit ${code:-?}); see docker compose logs migrate"
    else
      [ "$state" = running ] || fail "containers" "service $svc is $state"
      case "$health" in "" | healthy) ;; *) fail "containers" "service $svc is $health" ;; esac
    fi
  done
  echo "PASS containers: $(printf '%s\n' "$services" | tr '\n' ' ')running, migrate completed"
  images="$(compose config --images 2>"$TMP/err")" || fail "containers" "docker compose config --images failed"
  if [ "$PINNED" = 1 ]; then
    for img in $images; do
      case "$img" in *@sha256:*) ;; *) fail "images" "image $img is not pinned by digest (run ops/demo-pin.sh)" ;; esac
    done
    echo "PASS images: all pinned by digest"
  fi
  STACK_IMAGE="$(printf '%s\n' "$images" | grep 'glidepath/logic' | head -n 1)"
fi

# ------------------------------------------------------------------ HTTP checks
command -v node >/dev/null 2>&1 || die "node not found"
command -v pnpm >/dev/null 2>&1 || die "pnpm not found"
BUNDLE="$TMP/demo-check.mjs"
(cd "$ROOT" && pnpm --filter @glidepath/ops exec esbuild src/demo-check-cli.ts --bundle --platform=node --target=node22 \
  --format=esm --log-level=warning \
  "--banner:js=import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" \
  "--outfile=$BUNDLE") >"$TMP/build.log" 2>&1 || {
  head -n 5 "$TMP/build.log" >&2
  fail "bundle" "cannot build the checker (run pnpm i)"
}

if [ "$ISOLATED" = 1 ]; then
  command -v docker >/dev/null 2>&1 || die "--isolated needs docker"
  IMAGE="${IMAGE:-$STACK_IMAGE}"
  [ -n "$IMAGE" ] || die "--isolated needs --image (an image with node 22)"
  mkdir -p "$TMP/sock" && chmod 0777 "$TMP/sock"
  mail_port="$(printf "%s" "$MAIL" | sed -n "s|^[a-z]*://[^:/]*:\([0-9]*\).*|\1|p")"
  web_port="$(printf "%s" "$WEB" | sed -n "s|^[a-z]*://[^:/]*:\([0-9]*\).*|\1|p")"
  node "$ROOT/ops/demo-check-relay.mjs" "$TMP/sock" "web=${web_port:-443}" "mail=${mail_port:-8025}" >"$TMP/relay.log" 2>&1 &
  RELAY_PID=$!
  for _ in 1 2 3 4 5 6 7 8 9 10; do [ -S "$TMP/sock/web.sock" ] && [ -S "$TMP/sock/mail.sock" ] && break; sleep 0.3; done
  [ -S "$TMP/sock/web.sock" ] || die "the socket relay did not start: $(head -n 1 "$TMP/relay.log")" 1
  chmod 0777 "$TMP/sock/web.sock" "$TMP/sock/mail.sock"
  echo "isolated: checker container on --network none, ports through unix sockets"
  # shellcheck disable=SC2086 # AI_ARGS is empty or two words
  docker run --rm --network none --user 1000:1000 --read-only \
    -v "$TMP:/check:ro" -v "$TMP/sock:/sock" -v "$ROOT/docs/spec/reference:/ref:ro" \
    --entrypoint node "$IMAGE" /check/demo-check.mjs \
    --web "$WEB" --mail "$MAIL" --web-socket /sock/web.sock --mail-socket /sock/mail.sock \
    --email "$EMAIL" --mail-timeout "$MAIL_TIMEOUT" --ref-dir /ref $AI_ARGS
  exit $?
fi

# shellcheck disable=SC2086 # AI_ARGS is empty or two words
node "$BUNDLE" --web "$WEB" --mail "$MAIL" --email "$EMAIL" --mail-timeout "$MAIL_TIMEOUT" --ref-dir "$ROOT/docs/spec/reference" $AI_ARGS
exit $?
