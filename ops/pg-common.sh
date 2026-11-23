# shellcheck shell=bash disable=SC2016
# ops/pg-common.sh (OPS-07): shared by ops/backup.sh and ops/restore.sh. Sourced, not run.
# bash 3.2 (macOS) safe: only POSIX-style constructs, no bash 4 features.
#
# Where the database is (first match wins):
#   1. --url URL, or env DATABASE_URL_BACKUP, or env DATABASE_URL_MIGRATE   (client tools on PATH,
#      or in $PG_BIN; works against a managed Postgres such as Neon, sslmode=require included)
#   2. DATABASE_URL_MIGRATE from .env, when its host is not the compose-internal `db`
#   3. the compose `db` service: client tools run inside the container over its local socket as
#      the bootstrap superuser (the db port is not published on the host)
# Env: OPS_DOCKER (docker binary, default docker), COMPOSE_PROJECT_NAME / COMPOSE_FILE (compose's own).

PGX_URL=""
PGX_MODE=""

pgx_die() { echo "$1" >&2; exit "${2:-1}"; }

# value of KEY in an env file, quotes stripped, ${NAME} references expanded from the same file
pgx_envfile_get() {
  _f="$1"; _k="$2"
  [ -f "$_f" ] || return 0
  _v=$(grep -E "^${_k}=" "$_f" | tail -n 1 | cut -d= -f2- || true)
  _v=${_v#\"}; _v=${_v%\"}; _v=${_v#\'}; _v=${_v%\'}
  _n=0
  while [ $_n -lt 20 ]; do
    _ref=$(printf '%s' "$_v" | sed -n 's/.*\${\([A-Za-z_][A-Za-z0-9_]*\)[^}]*}.*/\1/p')
    [ -n "$_ref" ] || break
    _rv=$(grep -E "^${_ref}=" "$_f" | tail -n 1 | cut -d= -f2- || true)
    _rve=$(printf '%s' "$_rv" | sed 's/[|&\]/\\&/g')
    _v=$(printf '%s' "$_v" | sed "s|\${${_ref}[^}]*}|${_rve}|")
    _n=$((_n + 1))
  done
  printf '%s' "$_v"
}

# pgx_select_db URL ENVFILE: sets PGX_MODE (url|compose) and PGX_URL
pgx_select_db() {
  _url="${1:-}"; _envf="${2:-.env}"
  [ -n "$_url" ] || _url="${DATABASE_URL_BACKUP:-${DATABASE_URL_MIGRATE:-}}"
  if [ -z "$_url" ]; then
    _cand=$(pgx_envfile_get "$_envf" DATABASE_URL_MIGRATE)
    case "$_cand" in
      ''|*@db:*|*@db/*) ;;
      *) _url="$_cand" ;;
    esac
  fi
  if [ -n "$_url" ]; then
    PGX_MODE=url; PGX_URL="$_url"
    if [ -n "${PG_BIN:-}" ]; then PATH="$PG_BIN:$PATH"; export PATH; fi
    for _t in pg_dump pg_restore psql; do
      command -v "$_t" >/dev/null 2>&1 || pgx_die "$_t not found on PATH (set PG_BIN to a PostgreSQL 16 bin directory)" 2
    done
  else
    PGX_MODE=compose
    command -v "${OPS_DOCKER:-docker}" >/dev/null 2>&1 || \
      pgx_die "no DATABASE_URL_MIGRATE and no docker: cannot reach a database" 2
  fi
}

pgx_dc() { "${OPS_DOCKER:-docker}" compose "$@"; }

pgx_describe() {
  if [ "$PGX_MODE" = url ]; then
    # never print the password
    printf 'database: %s\n' "$(printf '%s' "$PGX_URL" | sed 's|//[^@/]*@|//|')"
  else
    echo "database: compose service db (as the container's bootstrap superuser)"
  fi
}

# psql, SQL on stdin or via args (-c). Quiet, no psqlrc, stops on first error.
pgx_psql() {
  if [ "$PGX_MODE" = url ]; then
    psql -X -q -v ON_ERROR_STOP=1 "$PGX_URL" "$@"
  else
    pgx_dc exec -T db sh -c 'exec psql -X -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" "$@"' sh "$@"
  fi
}

# pg_dump with fixed options; extra args after. Writes to stdout.
pgx_pg_dump() {
  if [ "$PGX_MODE" = url ]; then
    pg_dump --no-owner --no-privileges "$@" "$PGX_URL"
  else
    pgx_dc exec -T db sh -c 'exec pg_dump --no-owner --no-privileges -U "$POSTGRES_USER" -d "$POSTGRES_DB" "$@"' sh "$@"
  fi
}

# the plain-text schema dump WITH privileges, reduced to its GRANT/REVOKE lines (the custom dump
# drops them, --no-privileges, so restore re-applies them from grants.sql)
pgx_grants() {
  if [ "$PGX_MODE" = url ]; then
    pg_dump --no-owner --schema-only -Fp "$PGX_URL"
  else
    pgx_dc exec -T db sh -c 'exec pg_dump --no-owner --schema-only -Fp -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
  fi | grep -E '^(GRANT|REVOKE) ' || true
}

# pg_restore reading the custom dump on stdin
pgx_pg_restore() {
  if [ "$PGX_MODE" = url ]; then
    pg_restore --no-owner --no-privileges -d "$PGX_URL" "$@"
  else
    pgx_dc exec -T db sh -c 'exec pg_restore --no-owner --no-privileges -U "$POSTGRES_USER" -d "$POSTGRES_DB" "$@"' sh "$@"
  fi
}

# Tenant tables are under FORCE ROW LEVEL SECURITY and the owner role is NOBYPASSRLS: with such a
# role pg_dump either fails or (--enable-row-security) writes empty tenant tables. Refuse that.
pgx_require_rls_bypass() {
  _ok=$(pgx_psql -At -c "select (rolsuper or rolbypassrls) from pg_roles where rolname = current_user" | head -n 1)
  [ "$_ok" = t ] || pgx_die "the database role cannot bypass row-level security (not superuser, no BYPASSRLS), so tenant rows would be missing from the dump or the restore. Use a role that does (compose: the db container's postgres user; Neon: the project owner role) via DATABASE_URL_BACKUP." 3
}

# key=value lines, sorted: row counts and content hashes of what must survive a round trip
pgx_counts() {
  pgx_psql -At -c "
    select 'tenant_count=' || count(*) from tenant
    union all select 'calc_run_count=' || count(*) from calc_run
    union all select 'calc_run_md5=' || coalesce(md5(string_agg(id::text || outputs::text, ',' order by id)), '') from calc_run
    union all select 'stored_object_count=' || count(*) from stored_object
    union all select 'stored_object_bytes=' || coalesce(sum(size), 0) from stored_object
    union all select 'stored_object_md5=' || coalesce(md5(string_agg(tenant_id::text || bucket || key || sha256, ',' order by tenant_id, bucket, key)), '') from stored_object" | sort
}

pgx_sha256() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi
}
