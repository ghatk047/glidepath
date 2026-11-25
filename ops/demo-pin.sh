#!/usr/bin/env bash
# ops/demo-pin.sh (OPS-06): freeze the demo images. Builds or tags glidepath/logic and glidepath/web as
# demo-2026-12-04, reads the digest of those two and of the pinned postgres and mailpit images, and writes
# them where `docker compose --profile demo up -d` reads them (docs/architecture/02 section 4).
#
#   ops/demo-pin.sh --build [options]      build both images with the demo tag, then pin
#   ops/demo-pin.sh --from-tag TAG         retag glidepath/{logic,web}:TAG as the demo tag, then pin
#   ops/demo-pin.sh --apply                no docker: copy the committed record (ops/demo-pins.env) into .env
#
#   --tag TAG            demo tag (default demo-2026-12-04)
#   --env-file PATH      Compose env file to update (default .env; it must exist: cp .env.example .env)
#   --record PATH        record to write or apply (default ops/demo-pins.env; commit it after the freeze)
#   --no-record          do not write the record file
#   --extra-ca PATH      PEM bundle handed to the builds as BuildKit secret `extra-ca` (TLS-inspecting proxy)
#   --digest NAME=HEX    use this digest instead of reading it from the local image; NAME is logic, web, db or
#                        mail, HEX is sha256:<64 hex> (for a multi-arch index pushed to a registry with
#                        `docker buildx bake --push`: a local image only has the digest of its own platform)
#   --dry-run            print what would happen; build, tag and write nothing
#   -h, --help           this text
#
# What it writes: TAG, COMPOSE_PROFILES=demo and LOGIC_IMAGE_PIN, WEB_IMAGE_PIN, DB_IMAGE_PIN, MAIL_IMAGE_PIN
# (each `@sha256:<64 hex>`, appended to the image reference in docker-compose.yml) into the env file, and the same
# five lines into the record. The digest is the image's manifest digest (`.Descriptor.digest` of the containerd
# image store, else the first `RepoDigests` entry). Run it on the Mac that will run the demo, then
# `docker compose --profile demo up -d` and `ops/demo-check.sh`.
#
# Exit codes: 0 done, 1 a step failed (no digest, build failed), 2 usage.
# Written for bash 3.2 (macOS) and GNU bash; no jq needed.

set -u -o pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TAG="demo-2026-12-04"
MODE=""
FROM_TAG=""
ENV_FILE=".env"
RECORD="ops/demo-pins.env"
WRITE_RECORD=1
EXTRA_CA=""
DRY_RUN=0
OVERRIDES=""

# name|image reference without pin|Dockerfile (built here) or empty (pulled)|env variable
LOGIC_REF="glidepath/logic"
WEB_REF="glidepath/web"

usage() { sed -n '2,/^# Written for/p' "${BASH_SOURCE[0]}" | sed '$d' | sed 's/^# \{0,1\}//'; }
die() {
  echo "demo-pin: $1" >&2
  exit "${2:-1}"
}

while [ $# -gt 0 ]; do
  case "$1" in
    --build) MODE=build ;;
    --apply) MODE=apply ;;
    --from-tag | --tag | --env-file | --record | --extra-ca | --digest)
      [ $# -ge 2 ] || die "$1 needs a value" 2
      case "$1" in
        --from-tag) MODE=retag; FROM_TAG="$2" ;;
        --tag) TAG="$2" ;;
        --env-file) ENV_FILE="$2" ;;
        --record) RECORD="$2" ;;
        --extra-ca) EXTRA_CA="$2" ;;
        --digest) OVERRIDES="$OVERRIDES $2" ;;
      esac
      shift
      ;;
    --no-record) WRITE_RECORD=0 ;;
    --dry-run) DRY_RUN=1 ;;
    -h | --help) usage; exit 0 ;;
    *) die "unknown option: $1 (see --help)" 2 ;;
  esac
  shift
done

[ -n "$MODE" ] || die "choose --build, --from-tag TAG or --apply (see --help)" 2
case "$TAG" in *[!A-Za-z0-9_.-]* | "") die "bad tag: $TAG" 2 ;; esac
cd "$ROOT" || die "cannot enter $ROOT" 2
[ "$DRY_RUN" = 1 ] || [ -f "$ENV_FILE" ] || die "env file $ENV_FILE not found (cp .env.example .env)" 2
[ -z "$EXTRA_CA" ] || [ "$DRY_RUN" = 1 ] || [ -f "$EXTRA_CA" ] || die "--extra-ca file not found: $EXTRA_CA" 2
for o in $OVERRIDES; do
  case "$o" in
    logic=sha256:* | web=sha256:* | db=sha256:* | mail=sha256:*) ;;
    *) die "bad --digest $o (want logic|web|db|mail=sha256:<hex>)" 2 ;;
  esac
  hex="${o#*=sha256:}"
  case "$hex" in *[!0-9a-f]* | "") die "bad --digest $o: not hex" 2 ;; esac
  [ "${#hex}" = 64 ] || die "bad --digest $o: sha256 is 64 hex digits" 2
done

# The third-party references are the ones docker-compose.yml pins by version.
compose_ref() { # compose_ref SERVICE-IMAGE-PREFIX -> the image line without the pin variable
  sed -n "s|^ *image: \\($1[^\$]*\\)\\\${.*|\\1|p" docker-compose.yml | head -n 1
}
DB_REF="$(compose_ref 'postgres:')"
MAIL_REF="$(compose_ref 'axllent/mailpit:')"
[ -n "$DB_REF" ] && [ -n "$MAIL_REF" ] || die "cannot read the postgres and mailpit images from docker-compose.yml" 2

# set_kv FILE KEY VALUE: replace the KEY= line, or append it. No sed -i (BSD and GNU differ).
set_kv() {
  local file="$1" key="$2" value="$3" tmp
  tmp="$(mktemp "${file}.XXXXXX")" || die "cannot write next to $file"
  if grep -q "^${key}=" "$file" 2>/dev/null; then
    awk -v k="$key" -v v="$value" 'BEGIN { p = k "=" } index($0, p) == 1 { print p v; next } { print }' "$file" >"$tmp"
  else
    { cat "$file" 2>/dev/null; echo "${key}=${value}"; } >"$tmp"
  fi
  mv "$tmp" "$file"
}

override_for() { # override_for NAME -> sha256:hex or empty
  local o
  for o in $OVERRIDES; do [ "${o%%=*}" = "$1" ] && { echo "${o#*=}"; return; }; done
}

digest_of() { # digest_of IMAGE-REF: the manifest digest of a local image
  local d
  d="$(docker image inspect --format '{{.Descriptor.digest}}' "$1" 2>/dev/null)"
  case "$d" in sha256:*) echo "$d"; return ;; esac
  d="$(docker image inspect --format '{{index .RepoDigests 0}}' "$1" 2>/dev/null)"
  case "$d" in *@sha256:*) echo "sha256:${d#*@sha256:}"; return ;; esac
  return 1
}

PINS=""     # lines "VAR=@sha256:hex"
if [ "$MODE" = apply ]; then
  [ -f "$RECORD" ] || die "record $RECORD not found (run ops/demo-pin.sh on the build Mac and commit it)"
  for var in TAG LOGIC_IMAGE_PIN WEB_IMAGE_PIN DB_IMAGE_PIN MAIL_IMAGE_PIN; do
    line="$(grep "^${var}=" "$RECORD" | tail -n 1)"
    [ -n "$line" ] || die "$RECORD has no $var"
    case "$var" in
      TAG) TAG="${line#*=}" ;;
      *) case "${line#*=}" in @sha256:*) ;; *) die "$RECORD: $var is not an @sha256 pin" ;; esac; PINS="$PINS
$line" ;;
    esac
  done
else
  if [ "$DRY_RUN" = 1 ]; then
    echo "plan ($MODE): ${LOGIC_REF}:$TAG and ${WEB_REF}:$TAG${FROM_TAG:+ from :$FROM_TAG}; pin $DB_REF and $MAIL_REF"
    echo "plan: write TAG=$TAG COMPOSE_PROFILES=demo and the four *_IMAGE_PIN lines to $ENV_FILE${RECORD:+ and $RECORD}"
    exit 0
  fi
  command -v docker >/dev/null 2>&1 || die "docker not found" 2
  docker info >/dev/null 2>&1 || die "the Docker daemon is not running" 2
  if [ "$MODE" = build ]; then
    for pair in "$LOGIC_REF:ops/docker/logic/Dockerfile" "$WEB_REF:ops/docker/web/Dockerfile"; do
      img="${pair%%:*}"
      df="${pair#*:}"
      echo "build: $img:$TAG"
      if [ -n "$EXTRA_CA" ]; then
        docker build -q -f "$df" -t "$img:$TAG" --secret "id=extra-ca,src=$EXTRA_CA" . >/dev/null || die "build failed: $img ($df)"
      else
        docker build -q -f "$df" -t "$img:$TAG" . >/dev/null || die "build failed: $img ($df)"
      fi
    done
  else
    for img in "$LOGIC_REF" "$WEB_REF"; do
      docker image inspect "$img:$FROM_TAG" >/dev/null 2>&1 || die "image $img:$FROM_TAG not found (build it, or use --build)"
      docker tag "$img:$FROM_TAG" "$img:$TAG" || die "cannot tag $img:$FROM_TAG as $img:$TAG"
    done
  fi
  for ref in "$DB_REF" "$MAIL_REF"; do
    docker image inspect "$ref" >/dev/null 2>&1 || docker pull -q "$ref" >/dev/null || die "cannot pull $ref"
  done
  for entry in "logic|$LOGIC_REF:$TAG|LOGIC_IMAGE_PIN" "web|$WEB_REF:$TAG|WEB_IMAGE_PIN" "db|$DB_REF|DB_IMAGE_PIN" "mail|$MAIL_REF|MAIL_IMAGE_PIN"; do
    name="${entry%%|*}"
    rest="${entry#*|}"
    ref="${rest%%|*}"
    var="${rest#*|}"
    d="$(override_for "$name")"
    if [ -z "$d" ]; then
      d="$(digest_of "$ref")" || die "no digest for $ref (not a local image with a manifest digest; push it and pass --digest $name=sha256:...)"
      # The pin must resolve on this Docker, or `up` would try to pull it.
      docker image inspect "$ref@$d" >/dev/null 2>&1 || die "$ref@$d does not resolve locally (this Docker does not keep manifest digests; use the containerd image store or --digest $name=...)"
    fi
    echo "pin: $ref -> $d"
    PINS="$PINS
$var=@$d"
  done
fi

if [ "$DRY_RUN" = 1 ]; then
  echo "plan (apply): copy $RECORD into $ENV_FILE"
  exit 0
fi
set_kv "$ENV_FILE" TAG "$TAG"
set_kv "$ENV_FILE" COMPOSE_PROFILES demo
for line in $PINS; do set_kv "$ENV_FILE" "${line%%=*}" "${line#*=}"; done
echo "demo-pin: $ENV_FILE updated (TAG=$TAG, COMPOSE_PROFILES=demo, 4 digests)"

if [ "$MODE" != apply ] && [ "$WRITE_RECORD" = 1 ]; then
  {
    echo "# Demo image pins written by ops/demo-pin.sh. Commit this file at the freeze; on another Mac"
    echo "# \`ops/demo-pin.sh --apply\` copies it into .env. Not secrets."
    echo "TAG=$TAG"
    for line in $PINS; do echo "$line"; done
  } >"$RECORD"
  echo "demo-pin: record written to $RECORD"
fi
echo "demo-pin: next: docker compose --profile demo up -d && ops/demo-check.sh"
