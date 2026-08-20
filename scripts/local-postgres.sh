#!/usr/bin/env bash
#
# Start a throwaway PostgreSQL with this app's real schema, WITHOUT Docker.
#
#   ./scripts/local-postgres.sh start     # cluster + schema + all migrations
#   ./scripts/local-postgres.sh stop
#   ./scripts/local-postgres.sh status
#
# WHY THIS EXISTS
# ---------------
# The repo's other database harness, scripts/ci-integration-db.sh, runs
# `supabase start` — a whole Kong + PostgREST + GoTrue stack — because
# lib/supabase-db.ts speaks PostgREST over HTTP rather than Postgres. That is
# the right harness for testing the ADAPTER, and it needs Docker.
#
# It is the wrong harness, and an unavailable one, for testing the SQL. Every
# money-critical guarantee in this platform lives in a Postgres function:
# claim_status_transition, increment_within_ceiling, debit_wallet_locked,
# credit_wallet_once, claim_idempotency_key,
# claim_single_open_loan_application. Those need a database and nothing else.
#
# Postgres is already installed on most machines that can build this app, and
# on Debian/Ubuntu the server binaries sit OUTSIDE $PATH under
# /usr/lib/postgresql/<version>/bin — which is why it is easy to conclude no
# database is available when one is. This script finds them.
#
# WHAT IT DELIBERATELY DOES NOT DO
# --------------------------------
# It does not serve PostgREST, so lib/supabase-db.ts cannot talk to it. Tests
# built on this use `pg` directly and exercise the SQL. Adapter-level tests stay
# with ci-integration-db.sh.
#
# EVERYTHING IS THROWAWAY. The data directory is under /tmp, the port is
# non-standard, and `stop` deletes it. It never touches a configured database:
# it reads no .env and takes no connection string.

set -euo pipefail

PORT="${LOCAL_PG_PORT:-55432}"
DATADIR="${LOCAL_PG_DATA:-/tmp/esx-pg}"
DBNAME="app"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Debian/Ubuntu hide the server binaries here; a Homebrew or Postgres.app
# install has them on PATH already.
find_bindir() {
    if command -v initdb >/dev/null 2>&1; then
        dirname "$(command -v initdb)"
        return
    fi
    for d in /usr/lib/postgresql/*/bin /usr/local/pgsql/bin /opt/homebrew/opt/postgresql*/bin; do
        [ -x "$d/initdb" ] && { echo "$d"; return; }
    done
    echo ""
}

BINDIR="$(find_bindir)"
if [ -z "$BINDIR" ]; then
    cat >&2 <<'MSG'
No PostgreSQL server binaries found.

Looked on PATH and in /usr/lib/postgresql/*/bin, /usr/local/pgsql/bin and
/opt/homebrew/opt/postgresql*/bin. `psql` alone is not enough — that is the
client. Install the server package (postgresql-16 on Debian/Ubuntu,
`brew install postgresql@16` on macOS).
MSG
    exit 1
fi
export PATH="$BINDIR:$PATH"

# initdb refuses to run as root, which is the usual reason a first attempt at
# this fails. Fall back to the `postgres` service account when we are root.
RUN_AS=""
if [ "$(id -u)" = "0" ]; then
    if id postgres >/dev/null 2>&1; then
        RUN_AS="postgres"
    else
        echo "Running as root and there is no 'postgres' user to drop to. Re-run as a normal user." >&2
        exit 1
    fi
fi
run_pg() { if [ -n "$RUN_AS" ]; then runuser -u "$RUN_AS" -- "$@"; else "$@"; fi; }

# TCP, not a unix socket: the socket path has a 107-byte limit and a data
# directory under a long temp path silently exceeds it.
PSQL=(psql -h 127.0.0.1 -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -q)

is_up() { pg_isready -h 127.0.0.1 -p "$PORT" -U postgres >/dev/null 2>&1; }

cmd_start() {
    if is_up; then
        echo "Already up on 127.0.0.1:$PORT"
        return
    fi

    echo "PostgreSQL $("$BINDIR/postgres" --version | awk '{print $3}') from $BINDIR"

    rm -rf "$DATADIR"
    mkdir -p "$DATADIR"
    [ -n "$RUN_AS" ] && chown "$RUN_AS" "$DATADIR"

    run_pg initdb -D "$DATADIR/data" -U postgres --auth=trust >/dev/null
    run_pg pg_ctl -D "$DATADIR/data" \
        -o "-p $PORT -k $DATADIR -c listen_addresses=127.0.0.1" \
        -l "$DATADIR/log" start >/dev/null

    for _ in $(seq 1 30); do is_up && break; sleep 0.5; done
    is_up || { echo "Server did not come up. Log:"; tail -20 "$DATADIR/log"; exit 1; }

    "${PSQL[@]}" -c "create database $DBNAME;"

    # schema.sql creates the nine tables; migrations/ only ALTERs them and adds
    # the functions, so the order matters and nothing in migrations/ can run
    # first. Same reason ci-integration-db.sh moves migrations/ aside.
    echo "Loading schema.sql"
    "${PSQL[@]}" -d "$DBNAME" -f "$REPO_ROOT/supabase/schema.sql" >/dev/null

    local n=0
    for m in $(ls "$REPO_ROOT"/supabase/migrations/*.sql | sort); do
        "${PSQL[@]}" -d "$DBNAME" -f "$m" >/dev/null
        n=$((n + 1))
    done
    echo "Applied $n migration(s)"

    local fns
    fns=$("${PSQL[@]}" -d "$DBNAME" -tAc "
        select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public';")
    echo "Ready: postgres://postgres@127.0.0.1:$PORT/$DBNAME  ($fns functions)"
    echo
    echo "  export LOCAL_PG_URL=postgres://postgres@127.0.0.1:$PORT/$DBNAME"
    echo "  npm run test:pg"
}

cmd_stop() {
    if [ -d "$DATADIR/data" ]; then
        run_pg pg_ctl -D "$DATADIR/data" -m immediate stop >/dev/null 2>&1 || true
    fi
    rm -rf "$DATADIR"
    echo "Stopped and removed $DATADIR"
}

cmd_status() {
    if is_up; then
        echo "up   postgres://postgres@127.0.0.1:$PORT/$DBNAME"
    else
        echo "down (port $PORT)"
        exit 1
    fi
}

case "${1:-start}" in
    start)  cmd_start ;;
    stop)   cmd_stop ;;
    status) cmd_status ;;
    *)      echo "usage: $0 {start|stop|status}" >&2; exit 2 ;;
esac
