#!/usr/bin/env bash
# ops/restore.sh (OPS-07): restore a backup made by ops/backup.sh.
#
#   ops/restore.sh [options] <backup-dir | latest>
#
#   --dir DIR        backup root used to resolve `latest` (default ./backups; env BACKUP_DIR)
#   --url URL        target database URL (default: DATABASE_URL_BACKUP, DATABASE_URL_MIGRATE, .env,
#                    else the compose db service; see ops/pg-common.sh)
#   --owner ROLE     after the restore hand the public-schema objects to ROLE (default in compose
#                    mode: glidepath_owner, so migrations keep working; none in url mode)
#   --yes            replace a database that already has tables (default: refuse)
#   --no-grants      do not re-apply grants.sql
#
# Steps: check dump sha256 against manifest.txt; require an RLS-bypassing role; refuse a non-empty
# target without --yes; pg_restore --clean --if-exists --no-owner --no-privileges
# --single-transaction; transfer ownership (--owner); apply grants.sql (errors for roles missing in
# the target are warnings); compare the row counts and hashes with manifest.txt.
# Exit: 0 ok, 1 failed, 2 usage, 3 role cannot bypass RLS, 4 target not empty (no --yes),
# 5 counts differ from the manifest after the restore.
# bash 3.2 compatible (macOS).
set -eu
set -o pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=pg-common.sh
. "$HERE/pg-common.sh"

ROOT="${BACKUP_DIR:-./backups}"; URL=""; ENVF=".env"; OWNER=""; YES=0; GRANTS=1; SRC=""
while [ $# -gt 0 ]; do
  case "$1" in
    --dir) [ $# -ge 2 ] || pgx_die "--dir needs a value" 2; ROOT="$2"; shift 2 ;;
    --url) [ $# -ge 2 ] || pgx_die "--url needs a value" 2; URL="$2"; shift 2 ;;
    --env-file) [ $# -ge 2 ] || pgx_die "--env-file needs a value" 2; ENVF="$2"; shift 2 ;;
    --owner) [ $# -ge 2 ] || pgx_die "--owner needs a value" 2; OWNER="$2"; shift 2 ;;
    --yes) YES=1; shift ;;
    --no-grants) GRANTS=0; shift ;;
    -h|--help) sed -n '2,/^set -eu/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) pgx_die "restore: unknown option $1 (see --help)" 2 ;;
    *) [ -z "$SRC" ] || pgx_die "restore: one backup only" 2; SRC="$1"; shift ;;
  esac
done
[ -n "$SRC" ] || pgx_die "restore: name a backup directory or 'latest' (see --help)" 2
if [ "$SRC" = latest ]; then
  # shellcheck disable=SC2012
  SRC=$(ls -1d "$ROOT"/*/ 2>/dev/null | sed 's|/$||' | sort | tail -n 1 || true)
  [ -n "$SRC" ] || pgx_die "restore: no backups in $ROOT" 1
fi
if [ ! -f "$SRC/glidepath.dump" ] || [ ! -f "$SRC/manifest.txt" ]; then
  pgx_die "restore: $SRC is not a backup (glidepath.dump / manifest.txt missing)" 2
fi

WANT=$(grep '^dump_sha256=' "$SRC/manifest.txt" | cut -d= -f2)
[ "$(pgx_sha256 "$SRC/glidepath.dump")" = "$WANT" ] || pgx_die "restore: FAILED: dump does not match the sha256 in manifest.txt" 1

pgx_select_db "$URL" "$ENVF"
pgx_describe
echo "backup: $SRC"
pgx_require_rls_bypass

N=$(pgx_psql -At -c "select count(*) from pg_tables where schemaname = 'public'" | head -n 1)
if [ "$N" != 0 ] && [ "$YES" != 1 ]; then
  echo "restore: the target already has $N tables; pass --yes to replace them." >&2
  exit 4
fi

if [ -z "$OWNER" ] && [ "$PGX_MODE" = compose ]; then OWNER=glidepath_owner; fi

pgx_pg_restore --clean --if-exists --single-transaction --exit-on-error < "$SRC/glidepath.dump" \
  || pgx_die "restore: FAILED: pg_restore" 1

if [ -n "$OWNER" ]; then
  # tables, views, enum types and functions of public that are not part of an extension (citext)
  pgx_psql -v owner="$OWNER" <<'SQL' || pgx_die "restore: FAILED: ownership transfer to $OWNER" 1
SELECT set_config('glidepath.owner', :'owner', false);
DO $do$
DECLARE r record; o text := current_setting('glidepath.owner');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = o) THEN RETURN; END IF;
  FOR r IN SELECT c.oid::regclass::text AS n, CASE c.relkind WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MATERIALIZED VIEW' ELSE 'TABLE' END AS k
           FROM pg_class c JOIN pg_namespace s ON s.oid = c.relnamespace
           WHERE s.nspname = 'public' AND c.relkind IN ('r','p','v','m') AND pg_get_userbyid(c.relowner) = current_user
             AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'e')
  LOOP EXECUTE format('ALTER %s %s OWNER TO %I', r.k, r.n, o); END LOOP;
  FOR r IN SELECT t.oid::regtype::text AS n FROM pg_type t JOIN pg_namespace s ON s.oid = t.typnamespace
           WHERE s.nspname = 'public' AND t.typtype = 'e' AND pg_get_userbyid(t.typowner) = current_user
             AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = t.oid AND d.deptype = 'e')
  LOOP EXECUTE format('ALTER TYPE %s OWNER TO %I', r.n, o); END LOOP;
  FOR r IN SELECT p.oid::regprocedure::text AS n FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace
           WHERE s.nspname = 'public' AND pg_get_userbyid(p.proowner) = current_user
             AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
  LOOP EXECUTE format('ALTER FUNCTION %s OWNER TO %I', r.n, o); END LOOP;
END
$do$;
SQL
fi

if [ "$GRANTS" = 1 ] && [ -s "$SRC/grants.sql" ]; then
  # statement by statement: a role that does not exist in this target is a warning, not a failure
  BAD=0
  while IFS= read -r line; do
    printf '%s\n' "$line" | pgx_psql >/dev/null 2>&1 || BAD=$((BAD + 1))
  done < "$SRC/grants.sql"
  [ "$BAD" = 0 ] || echo "restore: warning: $BAD GRANT/REVOKE statements did not apply (missing roles?)" >&2
fi

GOT=$(pgx_counts)
WANTC=$(grep -E '^(tenant_count|calc_run_count|calc_run_md5|stored_object_count|stored_object_bytes|stored_object_md5)=' "$SRC/manifest.txt" | sort)
if [ "$GOT" != "$WANTC" ]; then
  echo "restore: FAILED: counts differ from manifest.txt" >&2
  printf 'manifest:\n%s\nrestored:\n%s\n' "$WANTC" "$GOT" >&2
  exit 5
fi
echo "restore: OK: $(printf '%s' "$GOT" | tr '\n' ' ')"
