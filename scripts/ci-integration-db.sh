#!/usr/bin/env bash
#
# Bring up an ephemeral Supabase stack and load the app schema into it.
#
# WHY A WHOLE SUPABASE STACK AND NOT JUST POSTGRES
# ------------------------------------------------
# supabase-db.ts does not speak Postgres. It speaks PostgREST over HTTP through
# @supabase/supabase-js, which addresses /rest/v1/* — a path that only exists
# because Supabase puts a Kong gateway in front of PostgREST. The auth shim
# (src/lib/shims/firebase-admin/auth.js) calls supabase.auth.admin.createUser,
# which needs GoTrue at /auth/v1/*. A bare postgres service container gives you
# none of that, and hand-wiring PostgREST + Kong + GoTrue + the anon /
# authenticated / service_role roles + a matching JWT secret is a great deal of
# YAML to get subtly wrong. `supabase start` is that wiring, maintained by the
# people who ship it.
#
# WHY THE MIGRATIONS DIRECTORY IS MOVED ASIDE
# -------------------------------------------
# The schema is split: supabase/schema.sql creates the nine tables, and
# supabase/migrations/002..024 alter them and add the money functions. Nothing
# in migrations/ creates `users` or `document_collections`. `supabase start`
# applies migrations/ automatically at boot and would run 002 against an empty
# database.
#
# So migrations/ is moved out of the CLI's sight, the stack starts with an empty
# database, and this script applies schema.sql first and the migrations after —
# the same order scripts/test-migrations.sh uses, for the same reason.
#
# 004 (row-level security) is skipped, as it is there. Under RLS every query
# from a non-service role returns zero rows, which reads as a failure of the
# thing under test rather than of the setup. The integration suites authenticate
# as service_role, which bypasses RLS anyway, so applying it would change
# nothing except the confusion when something else breaks.
#
# USAGE
#   ./scripts/ci-integration-db.sh          # start, load, print env
#
# Writes NEXT_PUBLIC_SUPABASE_URL / ANON_KEY / SUPABASE_SERVICE_ROLE_KEY to
# $GITHUB_ENV when running under Actions, and to stdout otherwise.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

MIGRATIONS_DIR="supabase/migrations"
STASHED_DIR="$(mktemp -d)/migrations"

restore_migrations() {
    if [ -d "$STASHED_DIR" ] && [ ! -d "$MIGRATIONS_DIR" ]; then
        mv "$STASHED_DIR" "$MIGRATIONS_DIR"
    fi
}
trap restore_migrations EXIT

echo "== moving $MIGRATIONS_DIR aside so 'supabase start' cannot apply it first"
mv "$MIGRATIONS_DIR" "$STASHED_DIR"

echo "== starting supabase (postgres + postgrest + kong + gotrue)"
# Which services come up is decided in supabase/config.toml rather than by -x
# flags here, because the CLI's service names have changed between versions and
# an unknown name is a hard error.
npx --yes supabase@latest start

DB_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"

echo "== applying schema.sql"
psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f supabase/schema.sql

echo "== applying migrations (004 skipped: see header)"
for f in $(ls "$STASHED_DIR" | sort); do
    case "$f" in
        004_*) echo "   skip $f"; continue ;;
    esac
    echo "   $f"
    psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f "$STASHED_DIR/$f"
done

# Grants, and why they are not automatic here.
#
# PostgREST connects as `authenticator` and switches to `anon`,
# `authenticated` or `service_role` depending on the JWT. Supabase normally
# arranges for those roles to hold privileges on new tables through ALTER
# DEFAULT PRIVILEGES tied to the roles its own migration flow runs as. These
# tables were created by psql as `postgres`, outside that flow, so the roles
# ended up with no privileges at all and every request came back 403.
#
# Granted explicitly rather than by adding the tables to Supabase's migration
# flow, because the flow is exactly what cannot be used: it would apply
# migrations 002..024 before schema.sql exists.
echo "== granting the PostgREST roles access to the schema"
psql "$DB_URL" -v ON_ERROR_STOP=1 -q <<'SQL'
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
SQL

# PostgREST caches the schema at boot. It booted against an empty database, so
# without this every request 404s on a table that demonstrably exists — which
# looks exactly like a broken adapter.
echo "== reloading the PostgREST schema cache"
psql "$DB_URL" -q -c "NOTIFY pgrst, 'reload schema';"
sleep 3

API_URL="http://127.0.0.1:54321"
ANON_KEY="$(npx --yes supabase@latest status -o env | grep '^ANON_KEY=' | cut -d= -f2- | tr -d '"')"
SERVICE_KEY="$(npx --yes supabase@latest status -o env | grep '^SERVICE_ROLE_KEY=' | cut -d= -f2- | tr -d '"')"

if [ -z "$ANON_KEY" ] || [ -z "$SERVICE_KEY" ]; then
    echo "FAIL: could not read keys from 'supabase status'" >&2
    exit 1
fi

# Prove the stack is actually serving the schema before handing it to jest. A
# 404 here means the reload above did not take, and finding that out now is much
# cheaper than reading it as a test failure.
echo "== verifying the API can see the schema"
# Body as well as status. The first run of this reported only "403", and
# PostgREST puts the actual reason — permission denied for table users — in the
# body. A check that says less than the thing it is checking costs a round trip
# through CI to learn nothing.
response="$(curl -s -w '\n%{http_code}' \
    -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" \
    "$API_URL/rest/v1/users?select=id&limit=1")"
code="$(echo "$response" | tail -n1)"
body="$(echo "$response" | sed '$d')"
if [ "$code" != "200" ]; then
    echo "FAIL: GET /rest/v1/users returned $code, expected 200" >&2
    echo "  body: $body" >&2
    exit 1
fi
echo "   ok"

if [ -n "${GITHUB_ENV:-}" ]; then
    {
        echo "NEXT_PUBLIC_SUPABASE_URL=$API_URL"
        echo "NEXT_PUBLIC_SUPABASE_ANON_KEY=$ANON_KEY"
        echo "SUPABASE_SERVICE_ROLE_KEY=$SERVICE_KEY"
    } >> "$GITHUB_ENV"
    echo "== wrote credentials to \$GITHUB_ENV"
else
    echo "export NEXT_PUBLIC_SUPABASE_URL=$API_URL"
    echo "export NEXT_PUBLIC_SUPABASE_ANON_KEY=$ANON_KEY"
    echo "export SUPABASE_SERVICE_ROLE_KEY=$SERVICE_KEY"
fi
