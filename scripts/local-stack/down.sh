#!/usr/bin/env bash
#
# Stop the local stack. Leaves .local-stack/pgdata in place, so the next
# ./scripts/local-stack/up.sh reuses the database instead of rebuilding it.
# To start from an empty database: rm -rf .local-stack/pgdata
set -uo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# Bracketed so pkill cannot match this script's own command line.
pkill -f "local-stack/[g]ateway.mjs" 2>/dev/null && echo "== gateway stopped"
pkill -f "local-stack/[p]ostgrest"  2>/dev/null && echo "== postgrest stopped"

PGBIN=""
for d in /usr/lib/postgresql/*/bin /usr/local/pgsql/bin; do [ -x "$d/pg_ctl" ] && PGBIN="$d"; done
PGDATA="${LOCAL_STACK_PGDATA_PARENT:-.local-stack}/pgdata"
if [ -n "$PGBIN" ] && [ -d "$PGDATA" ]; then
    if [ "$(id -u)" = "0" ] && id -u pgrunner >/dev/null 2>&1; then
        su pgrunner -c "$PGBIN/pg_ctl -D '$PGDATA' stop" >/dev/null 2>&1 && echo "== postgres stopped"
    else
        "$PGBIN/pg_ctl" -D "$PGDATA" stop >/dev/null 2>&1 && echo "== postgres stopped"
    fi
fi

echo "== .env.development.local left in place; delete it to point the app back at .env.local"
