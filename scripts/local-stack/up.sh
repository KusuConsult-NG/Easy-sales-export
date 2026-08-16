#!/usr/bin/env bash
#
# Bring up a complete local backend with NO Docker and NO production anything.
#
#   ./scripts/local-stack/up.sh            # start, load schema + migrations, seed
#   ./scripts/local-stack/up.sh --no-seed  # start and load, leave the data empty
#
# WHY THIS EXISTS ALONGSIDE ci-integration-db.sh
# ----------------------------------------------
# ci-integration-db.sh uses `supabase start`, which pulls container images. That
# is the right tool when a Docker registry is reachable. Where it is not — a
# restricted network, an egress policy that denies the layer CDNs, a machine
# with no Docker at all — it fails at the first pull and there is no local
# database, which is how "test locally" has kept meaning "test on production".
#
# This script needs none of that:
#
#   PostgreSQL  installed natively (the postgresql-16 package, or any 14+)
#   PostgREST   one static binary, fetched once into .local-stack/
#   Kong        replaced by scripts/local-stack/gateway.mjs (a reverse proxy)
#   GoTrue      replaced by the same file (the password grant and admin users)
#
# The DATA path is genuinely real: real PostgREST against real PostgreSQL with
# the real schema, all migrations, and real row-level security. The AUTH path is
# a stand-in for the four endpoints this codebase calls — see gateway.mjs for
# exactly what that does and does not cover.
#
# WHAT IT WRITES
# --------------
# .env.development.local, which OUTRANKS .env.local in `next dev`. That single
# fact is what keeps local work off the production database while .env.local
# sits untouched underneath. Delete that file to go back.
#
# TEARDOWN: ./scripts/local-stack/down.sh

set -euo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

SEED=1
[ "${1:-}" = "--no-seed" ] && SEED=0

STACK_DIR=".local-stack"
PGDATA_PARENT="${LOCAL_STACK_PGDATA_PARENT:-$STACK_DIR}"
PGDATA="$PGDATA_PARENT/pgdata"
PG_PORT=54322
PGRST_PORT=3001
GATEWAY_PORT=54321
DB_URL="postgresql://postgres@127.0.0.1:${PG_PORT}/postgres"
POSTGREST_VERSION="v12.2.3"

mkdir -p "$STACK_DIR"

# ── Locate the PostgreSQL binaries ───────────────────────────────────────────
PGBIN=""
for d in /usr/lib/postgresql/*/bin /usr/local/pgsql/bin /opt/homebrew/opt/postgresql@*/bin; do
    [ -x "$d/initdb" ] && PGBIN="$d"
done
if [ -z "$PGBIN" ]; then
    command -v initdb >/dev/null 2>&1 && PGBIN="$(dirname "$(command -v initdb)")"
fi
if [ -z "$PGBIN" ]; then
    echo "❌ No PostgreSQL server binaries found (initdb)." >&2
    echo "   Ubuntu/Debian: apt-get install -y postgresql-16" >&2
    echo "   macOS:         brew install postgresql@16" >&2
    exit 1
fi
echo "== PostgreSQL binaries: $PGBIN"

# initdb and postgres refuse to run as root. Under root, drop to a dedicated
# unprivileged account; otherwise run as whoever invoked the script.
AS_USER=""
if [ "$(id -u)" = "0" ]; then
    id -u pgrunner >/dev/null 2>&1 || useradd -m pgrunner
    AS_USER="pgrunner"
    # postgres wants a writable socket directory.
    mkdir -p /var/run/postgresql && chown "$AS_USER" /var/run/postgresql
    mkdir -p "$(dirname "$PGDATA")"
    chown -R "$AS_USER" "$(dirname "$PGDATA")"
fi
run_pg() { if [ -n "$AS_USER" ]; then su "$AS_USER" -c "$1"; else bash -c "$1"; fi; }

# ── 1. PostgreSQL ────────────────────────────────────────────────────────────
if [ ! -f "$PGDATA/PG_VERSION" ]; then
    echo "== initdb $PGDATA"
    rm -rf "$PGDATA"; mkdir -p "$PGDATA"
    [ -n "$AS_USER" ] && chown -R "$AS_USER" "$PGDATA"
    run_pg "$PGBIN/initdb -D '$PGDATA' -U postgres --auth=trust -E UTF8" >/dev/null
fi

if ! pg_isready -h 127.0.0.1 -p "$PG_PORT" >/dev/null 2>&1; then
    echo "== starting PostgreSQL on $PG_PORT"
    run_pg "$PGBIN/pg_ctl -D '$PGDATA' -o '-p $PG_PORT -c listen_addresses=127.0.0.1' -l '$PGDATA/server.log' start" >/dev/null
    for _ in $(seq 1 30); do pg_isready -h 127.0.0.1 -p "$PG_PORT" >/dev/null 2>&1 && break; sleep 1; done
fi
pg_isready -h 127.0.0.1 -p "$PG_PORT" >/dev/null 2>&1 || { echo "❌ PostgreSQL did not start; see $PGDATA/server.log" >&2; exit 1; }
echo "== PostgreSQL up"

# ── 2. Roles, schema, migrations ─────────────────────────────────────────────
#
# PostgREST connects as `authenticator` and switches to anon / authenticated /
# service_role from the JWT. Those roles are part of Supabase's own bootstrap,
# not of this repo's schema, so they are created here.
echo "== roles"
psql "$DB_URL" -v ON_ERROR_STOP=1 -q <<'SQL'
DO $$ BEGIN CREATE ROLE anon           NOLOGIN NOINHERIT;            EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated  NOLOGIN NOINHERIT;            EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role   NOLOGIN NOINHERIT BYPASSRLS;  EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticator  NOINHERIT LOGIN PASSWORD 'postgres'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT anon, authenticated, service_role TO authenticator;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- The subset of GoTrue's auth.users the application touches. Passwords are
-- bcrypt via pgcrypto, the same primitive GoTrue uses.
CREATE TABLE IF NOT EXISTS auth.users (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email              TEXT UNIQUE,
    encrypted_password TEXT,
    email_confirmed_at TIMESTAMPTZ,
    raw_user_meta_data JSONB DEFAULT '{}'::jsonb,
    created_at         TIMESTAMPTZ DEFAULT NOW(),
    updated_at         TIMESTAMPTZ DEFAULT NOW()
);
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA auth TO service_role;
SQL

# schema.sql creates the nine tables; migrations/002.. alter them. Nothing in
# migrations/ creates `users` or `document_collections`, so the order matters.
echo "== schema.sql"
psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f supabase/schema.sql

echo "== migrations (004 row-level security included)"
for f in $(ls supabase/migrations/*.sql | sort); do
    printf '   %s' "$(basename "$f")"
    psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f "$f" && echo "" || { echo " ❌"; exit 1; }
done

# A migration that enabled RLS on nothing would leave the database wide open
# while reporting success. Check the outcome, not the exit code.
rls_count="$(psql "$DB_URL" -t -A -c "SELECT count(*) FROM pg_tables WHERE schemaname='public' AND rowsecurity;")"
echo "== row-level security enabled on $rls_count tables"
[ "$rls_count" -ge 9 ] || { echo "❌ expected RLS on at least 9 tables, found $rls_count" >&2; exit 1; }

# These tables were created by psql as `postgres`, outside Supabase's migration
# flow, so the PostgREST roles hold no privileges on them and every request
# would come back 403. Granted explicitly.
echo "== grants"
psql "$DB_URL" -v ON_ERROR_STOP=1 -q <<'SQL'
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES     IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES  IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL FUNCTIONS  IN SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES    TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
SQL

# ── 3. PostgREST ─────────────────────────────────────────────────────────────
PGRST_BIN="$STACK_DIR/postgrest"
if [ ! -x "$PGRST_BIN" ]; then
    echo "== fetching PostgREST $POSTGREST_VERSION"
    url="https://github.com/PostgREST/postgrest/releases/download/${POSTGREST_VERSION}/postgrest-${POSTGREST_VERSION}-linux-static-x64.tar.xz"
    curl -sSL --fail --max-time 300 -o "$STACK_DIR/postgrest.tar.xz" "$url"
    tar xf "$STACK_DIR/postgrest.tar.xz" -C "$STACK_DIR"
    chmod +x "$PGRST_BIN"
    rm -f "$STACK_DIR/postgrest.tar.xz"
fi

# One secret shared by PostgREST and the gateway. Regenerated per stack so a
# key from one machine cannot authenticate against another, and kept in the
# stack directory so a restart reuses it rather than invalidating live tokens.
SECRET_FILE="$STACK_DIR/jwt-secret"
[ -f "$SECRET_FILE" ] || head -c 48 /dev/urandom | base64 | tr -d '\n=/+' | head -c 40 > "$SECRET_FILE"
JWT_SECRET="$(cat "$SECRET_FILE")"

cat > "$STACK_DIR/postgrest.conf" <<EOF
db-uri = "postgresql://authenticator:postgres@127.0.0.1:${PG_PORT}/postgres"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "${JWT_SECRET}"
server-host = "127.0.0.1"
server-port = ${PGRST_PORT}
db-pool = 10
EOF

# Bracketed so the pattern cannot match this script's own command line,
# which contains the word and would make pkill kill the shell running it.
pkill -f "local-stack/[p]ostgrest" 2>/dev/null || true
sleep 1
echo "== starting PostgREST on $PGRST_PORT"
nohup "$PGRST_BIN" "$STACK_DIR/postgrest.conf" > "$STACK_DIR/postgrest.log" 2>&1 &
for _ in $(seq 1 30); do curl -sf "http://127.0.0.1:${PGRST_PORT}/" >/dev/null 2>&1 && break; sleep 1; done
curl -sf "http://127.0.0.1:${PGRST_PORT}/" >/dev/null 2>&1 || { echo "❌ PostgREST did not start; see $STACK_DIR/postgrest.log" >&2; tail -20 "$STACK_DIR/postgrest.log" >&2; exit 1; }
echo "== PostgREST up"

# ── 4. Gateway (Kong's routing + GoTrue's password grant) ────────────────────
ANON_KEY="$(LOCAL_JWT_SECRET="$JWT_SECRET" node scripts/local-stack/mint-keys.mjs anon)"
SERVICE_KEY="$(LOCAL_JWT_SECRET="$JWT_SECRET" node scripts/local-stack/mint-keys.mjs service_role)"

pkill -f "local-stack/[g]ateway.mjs" 2>/dev/null || true
sleep 1
echo "== starting gateway on $GATEWAY_PORT"
LOCAL_JWT_SECRET="$JWT_SECRET" \
GATEWAY_PORT="$GATEWAY_PORT" \
POSTGREST_URL="http://127.0.0.1:${PGRST_PORT}" \
LOCAL_DB_URL="$DB_URL" \
nohup node scripts/local-stack/gateway.mjs > "$STACK_DIR/gateway.log" 2>&1 &
for _ in $(seq 1 30); do curl -sf "http://127.0.0.1:${GATEWAY_PORT}/health" >/dev/null 2>&1 && break; sleep 1; done
curl -sf "http://127.0.0.1:${GATEWAY_PORT}/health" >/dev/null 2>&1 || { echo "❌ gateway did not start; see $STACK_DIR/gateway.log" >&2; tail -20 "$STACK_DIR/gateway.log" >&2; exit 1; }
echo "== gateway up"

# ── 5. Point the app at it ───────────────────────────────────────────────────
#
# .env.development.local outranks .env.local in `next dev`. That is the entire
# mechanism keeping local work off production.
cat > .env.development.local <<EOF
# Generated by scripts/local-stack/up.sh — points the app at the LOCAL stack.
# This file OUTRANKS .env.local in \`next dev\`. Delete it to fall back to
# .env.local (production). Regenerate: ./scripts/local-stack/up.sh
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:${GATEWAY_PORT}
NEXT_PUBLIC_SUPABASE_ANON_KEY=${ANON_KEY}
SUPABASE_SERVICE_ROLE_KEY=${SERVICE_KEY}
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=local-stack-development-secret-not-for-production
NEXT_PUBLIC_APP_URL=http://localhost:3000

# No production third parties. Each of these is a deliberate local value so a
# code path that reaches for a real provider fails loudly instead of billing
# someone or emailing a customer.
PAYSTACK_SECRET_KEY=sk_test_local_stack_not_a_real_key
NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY=pk_test_local_stack_not_a_real_key
EOF
echo "== wrote .env.development.local"

# ── 6. Seed ──────────────────────────────────────────────────────────────────
if [ "$SEED" = "1" ]; then
    echo "== seeding"
    npx tsx scripts/seed-local.ts
fi

cat <<EOF

✅ Local stack is up. Nothing here touches production.

   Postgres   127.0.0.1:${PG_PORT}      (real PostgreSQL, real schema, all migrations, RLS on)
   PostgREST  127.0.0.1:${PGRST_PORT}       (real PostgREST ${POSTGREST_VERSION})
   Gateway    127.0.0.1:${GATEWAY_PORT}      (/rest/v1 -> PostgREST, /auth/v1 -> local auth)

   npm run dev          start the app against it
   npm run test:e2e     run the Playwright suite against it
   npm run test:db      run the DB/integration suites against it

   ./scripts/local-stack/down.sh   stop everything
EOF
