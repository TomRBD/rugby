#!/usr/bin/env bash
# PostgreSQL local de développement (sans Docker) sur le port 5433, données dans .data/pg
set -euo pipefail
cd "$(dirname "$0")/.."
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
PGDATA="${PGDATA:-$PWD/.data/pg}"
PORT="${PGPORT:-5433}"
SU=postgres

run() { if [ "$(id -u)" = 0 ]; then su "$SU" -s /bin/bash -c "$*"; else bash -c "$*"; fi; }

case "${1:-start}" in
  start)
    mkdir -p "$PGDATA" .data
    if [ "$(id -u)" = 0 ]; then chown -R "$SU" "$PGDATA"; chmod 700 "$PGDATA"; fi
    if [ ! -f "$PGDATA/PG_VERSION" ]; then
      run "$PGBIN/initdb -D '$PGDATA' -U postgres --auth=trust -E UTF8 --locale=C.UTF-8 >/dev/null"
    fi
    if ! run "$PGBIN/pg_ctl -D '$PGDATA' status" >/dev/null 2>&1; then
      run "$PGBIN/pg_ctl -D '$PGDATA' -o '-p $PORT -k /tmp' -l '$PGDATA/server.log' -w start" >/dev/null
    fi
    psql "postgres://postgres@localhost:$PORT/postgres" -v ON_ERROR_STOP=1 -q <<'SQL'
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='rugby_admin') THEN CREATE ROLE rugby_admin LOGIN PASSWORD 'rugby_admin' CREATEDB; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='rugby_app') THEN CREATE ROLE rugby_app LOGIN PASSWORD 'rugby_app'; END IF;
END $$;
SQL
    for db in rugby rugby_test; do
      psql "postgres://postgres@localhost:$PORT/postgres" -tAc "SELECT 1 FROM pg_database WHERE datname='$db'" | grep -q 1 \
        || psql "postgres://postgres@localhost:$PORT/postgres" -qc "CREATE DATABASE $db OWNER rugby_admin"
    done
    echo "PostgreSQL prêt sur le port $PORT (bases rugby et rugby_test)"
    ;;
  stop)
    run "$PGBIN/pg_ctl -D '$PGDATA' stop -m fast" ;;
  *) echo "usage: $0 start|stop"; exit 1 ;;
esac
