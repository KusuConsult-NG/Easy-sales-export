#!/usr/bin/env bash
#
# The db-integration suite WITHOUT Docker.
#
#   ./scripts/local-supabase-rest.sh start
#   ./scripts/local-supabase-rest.sh stop
#
# WHY THIS EXISTS ALONGSIDE ci-integration-db.sh
# ----------------------------------------------
# That script is the right harness and needs `supabase start`, which pulls
# postgres, gotrue, kong and postgrest from Docker Hub. Where those pulls are
# blocked — a restricted network, a rate-limited shared IP, a machine with no
# Docker at all — `npm run test:db` skips every test, and a suite that skips
# everywhere is a suite that has never run. This one had not: its sixteen files
# and 148 assertions had never executed until they were pointed at this rig,
# and the neighbouring pg suite had been silently comparing against the wrong
# query for exactly the same reason.
#
# So this assembles the minimum the adapter actually talks to: PostgREST over
# the local cluster from ./scripts/local-postgres.sh, behind a small gateway
# that maps /rest/v1/* the way Kong does.
#
# WHAT IT DELIBERATELY DOES NOT PROVIDE
# -------------------------------------
# GoTrue. The auth shim (src/lib/shims/firebase-admin/auth.js) drives
# supabase.auth.admin.*, and standing up GoTrue means a JWT-issuing service, its
# own schema and its own migrations — the wiring ci-integration-db.sh exists to
# avoid hand-rolling. The gateway answers /auth/v1/* with 501 rather than
# pretending, jest.db.globalsetup.js probes for it, and auth-shim-pagination
# SKIPS. Skipped is not passed: use the Docker path for that file.
#
# 15 of 16 files, 140 of 148 tests, run here.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

RIG="${TMPDIR:-/tmp}/esx-rest-rig"
PG_URL="${LOCAL_PG_URL:-postgres://postgres@127.0.0.1:55432/app}"
# Length matters: PostgREST rejects an HS256 secret under 32 bytes.
JWT_SECRET="${RIG_JWT_SECRET:-super-secret-jwt-token-with-at-least-32-characters-long}"
PGRST_VERSION="v12.2.3"
API_PORT=54321
PGRST_PORT=3001

start() {
    mkdir -p "$RIG"

    command -v psql >/dev/null || { echo "FAIL: psql not found" >&2; exit 1; }
    psql "$PG_URL" -c 'select 1' >/dev/null 2>&1 || {
        echo "FAIL: no cluster at $PG_URL — run ./scripts/local-postgres.sh start first" >&2
        exit 1; }

    if [ ! -x "$RIG/postgrest" ]; then
        echo "== fetching PostgREST $PGRST_VERSION"
        curl -sSL -o "$RIG/pgrst.tar.xz" \
            "https://github.com/PostgREST/postgrest/releases/download/$PGRST_VERSION/postgrest-$PGRST_VERSION-linux-static-x64.tar.xz"
        tar xf "$RIG/pgrst.tar.xz" -C "$RIG"
    fi

    # The roles PostgREST switches between, and their grants. Taken from
    # ci-integration-db.sh, which explains why they are not automatic: these
    # tables were created by psql outside Supabase's migration flow, so the
    # ALTER DEFAULT PRIVILEGES that flow relies on never applied to them, and
    # every request comes back 403 without this.
    echo "== roles and grants"
    psql "$PG_URL" -v ON_ERROR_STOP=1 -q <<'SQL'
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticator') THEN CREATE ROLE authenticator LOGIN NOINHERIT PASSWORD 'authpass'; END IF;
END $$;
GRANT anon, authenticated, service_role TO authenticator;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
SQL

    cat > "$RIG/pgrst.conf" <<EOF
db-uri = "postgres://authenticator:authpass@$(echo "$PG_URL" | sed 's#.*@##')"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "$JWT_SECRET"
server-port = $PGRST_PORT
EOF

    node -e '
const crypto = require("crypto");
const [secret, out] = process.argv.slice(1);
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const mk = (role) => {
    const now = Math.floor(Date.now() / 1000);
    const h = b64({ alg: "HS256", typ: "JWT" });
    const p = b64({ role, iss: "esx-local-rig", iat: now, exp: now + 86400 });
    return h + "." + p + "." + crypto.createHmac("sha256", secret).update(h + "." + p).digest("base64url");
};
require("fs").writeFileSync(out, `ANON=${mk("anon")}\nSERVICE=${mk("service_role")}\n`);
' "$JWT_SECRET" "$RIG/keys.env"

    cat > "$RIG/gateway.js" <<'EOF'
// Kong, reduced to the one thing the adapter needs: /rest/v1/* -> PostgREST /*.
// /auth/v1/* answers 501 on purpose. Proxying it to something that is not
// GoTrue would turn "this rig cannot do that" into a confusing test failure.
const http = require('http');
const PGRST = Number(process.env.PGRST_PORT || 3001);
http.createServer((req, res) => {
    const m = req.url.match(/^\/rest\/v1(\/.*)$/);
    if (!m) {
        res.writeHead(501, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({
            message: 'local rig serves /rest/v1 only; GoTrue is not available here',
            path: req.url,
        }));
    }
    const headers = { ...req.headers, host: `127.0.0.1:${PGRST}` };
    delete headers['content-length'];
    const up = http.request(
        { host: '127.0.0.1', port: PGRST, path: m[1], method: req.method, headers },
        (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    up.on('error', (e) => { res.writeHead(502); res.end(String(e)); });
    req.pipe(up);
}).listen(Number(process.env.API_PORT || 54321), '127.0.0.1');
EOF

    # Fully detached: stdin from /dev/null and both streams into log files.
    # Without closing stdout the children inherit this script's pipe, so
    # `./local-supabase-rest.sh start | tail` blocks until they exit — the
    # script looks hung when it has in fact finished, which is how a working
    # rig gets reported as broken.
    echo "== starting postgrest and gateway"
    "$RIG/postgrest" "$RIG/pgrst.conf" >"$RIG/pgrst.log" 2>&1 </dev/null &
    echo $! > "$RIG/pgrst.pid"
    PGRST_PORT=$PGRST_PORT API_PORT=$API_PORT node "$RIG/gateway.js" >"$RIG/gw.log" 2>&1 </dev/null &
    echo $! > "$RIG/gw.pid"
    disown -a 2>/dev/null || true
    sleep 4

    # PostgREST caches the schema at boot; a cluster rebuilt underneath it
    # answers 404 for tables that demonstrably exist, which reads as a broken
    # adapter. Same reason ci-integration-db.sh reloads.
    psql "$PG_URL" -q -c "NOTIFY pgrst, 'reload schema';" || true
    sleep 2

    # shellcheck disable=SC1090
    . "$RIG/keys.env"

    # Prove the API serves the schema before handing it to jest, body included:
    # PostgREST puts the real reason (permission denied for table users) in the
    # body, and a check that says less than the thing it checks costs a whole
    # run to learn nothing.
    response="$(curl -s -w '\n%{http_code}' \
        -H "apikey: $SERVICE" -H "Authorization: Bearer $SERVICE" \
        "http://127.0.0.1:$API_PORT/rest/v1/users?select=id&limit=1")"
    code="$(echo "$response" | tail -n1)"
    if [ "$code" != "200" ]; then
        echo "FAIL: GET /rest/v1/users returned $code" >&2
        echo "  body: $(echo "$response" | sed '$d')" >&2
        exit 1
    fi

    cat > .env.staging <<EOF
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:$API_PORT
NEXT_PUBLIC_SUPABASE_ANON_KEY=$ANON
SUPABASE_SERVICE_ROLE_KEY=$SERVICE
EOF

    echo "Ready: http://127.0.0.1:$API_PORT  (.env.staging written)"
    echo "  npm run test:db      # 15 of 16 files; auth-shim skips, see header"
}

stop() {
    for p in pgrst gw; do
        [ -f "$RIG/$p.pid" ] && kill "$(cat "$RIG/$p.pid")" 2>/dev/null || true
        rm -f "$RIG/$p.pid"
    done
    echo "stopped"
}

case "${1:-start}" in
    start) start ;;
    stop) stop ;;
    *) echo "usage: $0 {start|stop}" >&2; exit 2 ;;
esac
