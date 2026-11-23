#!/usr/bin/env bash
# ops/backup.sh (OPS-07): one consistent backup of the Glidepath database into
# ./backups/<timestamp>/. Workbooks and AI files are rows of stored_object (ADR-025), so the
# pg_dump covers them; there is no object store to mirror.
#
#   ops/backup.sh [--dir DIR] [--url URL] [--env-file PATH]
#
#   --dir DIR        backup root (default ./backups; env BACKUP_DIR)
#   --url URL        database URL (default: DATABASE_URL_BACKUP, DATABASE_URL_MIGRATE, .env, else the
#                    compose db service; see ops/pg-common.sh)
#
# Writes <DIR>/<UTC timestamp, e.g. 20261204T081500Z>/
#   glidepath.dump   pg_dump -Fc --no-owner --no-privileges (works on a non-superuser URL, sslmode=require)
#   grants.sql       the GRANT/REVOKE lines of the schema, re-applied by ops/restore.sh
#   manifest.txt     key=value: timestamp, sha256, size, server version, row counts and content hashes
# The role must bypass row-level security (superuser or BYPASSRLS), else the script stops (exit 3).
# Exit: 0 ok, 1 failed, 2 usage / no client tools, 3 role cannot read all tenants.
# bash 3.2 compatible (macOS).
set -eu
set -o pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=pg-common.sh
. "$HERE/pg-common.sh"

ROOT="${BACKUP_DIR:-./backups}"; URL=""; ENVF=".env"
while [ $# -gt 0 ]; do
  case "$1" in
    --dir) [ $# -ge 2 ] || pgx_die "--dir needs a value" 2; ROOT="$2"; shift 2 ;;
    --url) [ $# -ge 2 ] || pgx_die "--url needs a value" 2; URL="$2"; shift 2 ;;
    --env-file) [ $# -ge 2 ] || pgx_die "--env-file needs a value" 2; ENVF="$2"; shift 2 ;;
    -h|--help) sed -n '2,/^set -eu/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) pgx_die "backup: unknown option $1 (see --help)" 2 ;;
  esac
done

pgx_select_db "$URL" "$ENVF"
pgx_describe
pgx_require_rls_bypass

TS=$(date -u +%Y%m%dT%H%M%SZ)
DEST="$ROOT/$TS"
mkdir -p "$DEST"
fail() { rm -rf "$DEST"; echo "backup: FAILED: $1" >&2; exit 1; }

pgx_pg_dump -Fc > "$DEST/glidepath.dump" || fail "pg_dump"
[ -s "$DEST/glidepath.dump" ] || fail "empty dump"
pgx_grants > "$DEST/grants.sql" || fail "reading privileges"
# the dump must be readable as an archive before we call it a backup
if [ "$PGX_MODE" = url ]; then pg_restore --list "$DEST/glidepath.dump" > /dev/null || fail "dump is not a valid archive"; fi

{
  echo "created_at=$TS"
  echo "format=pg_dump-custom"
  echo "dump=glidepath.dump"
  echo "dump_sha256=$(pgx_sha256 "$DEST/glidepath.dump")"
  echo "dump_bytes=$(wc -c < "$DEST/glidepath.dump" | tr -d ' ')"
  echo "server_version=$(pgx_psql -At -c 'show server_version' | head -n 1)"
  pgx_counts
} > "$DEST/manifest.txt" || fail "manifest"

echo "backup: OK: $DEST"
