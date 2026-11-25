#!/usr/bin/env bash
# LOCAL ONLY (docker compose db service, /docker-entrypoint-initdb.d): gives the roles created by
# 01_roles.sql their login passwords from the environment (.env, see .env.example):
#   OWNER_DB_PASSWORD -> glidepath_owner (DATABASE_URL_MIGRATE)
#   APP_DB_PASSWORD   -> glidepath_app   (DATABASE_URL)
# Runs once, on the first start of an empty data volume. If it stops here, set the passwords in .env
# and recreate the volume (docker compose down -v). Neon: passwords are managed in Neon.
set -euo pipefail

: "${OWNER_DB_PASSWORD:?OWNER_DB_PASSWORD is empty: set it in .env, then docker compose down -v && docker compose up -d}"
: "${APP_DB_PASSWORD:?APP_DB_PASSWORD is empty: set it in .env, then docker compose down -v && docker compose up -d}"

# A SQL string literal (standard_conforming_strings: only ' needs doubling). The statements go in on
# stdin, so the passwords never appear in a process list.
sql_literal() {
  local v=${1//\'/\'\'}
  printf "'%s'" "$v"
}

psql -v ON_ERROR_STOP=1 -X --no-password --username "${POSTGRES_USER:-postgres}" --dbname "${POSTGRES_DB:-postgres}" <<SQL
ALTER ROLE glidepath_owner PASSWORD $(sql_literal "$OWNER_DB_PASSWORD");
ALTER ROLE glidepath_app PASSWORD $(sql_literal "$APP_DB_PASSWORD");
SQL
