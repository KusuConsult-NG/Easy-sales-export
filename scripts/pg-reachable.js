#!/usr/bin/env node
/**
 *   #691 IS THE DECLARED DATABASE ACTUALLY THERE?
 *
 *   `.husky/pre-push` decided whether to run the money SQL by asking whether a
 *   URL was SET:
 *
 *       if [ -n "$PG_URL" ]; then  …run…  else  …warn…  fi
 *
 *   A URL IS A DECLARATION, NOT A SERVICE. src/lib/testing/pg-harness.ts says
 *   exactly that, at length, and added assertRestReachable for the PostgREST
 *   half after this codebase had been caught by it twice. The hook makes the
 *   identical mistake for the POSTGRES half — and there is a third form of it
 *   here that the harness names: a stale `.env.development.local` left behind
 *   by a stack that is no longer up.
 *
 *   THE COST IS NOT HYPOTHETICAL. A push during this audit failed against a
 *   database whose container had been reclaimed, and the hook reported:
 *
 *       ❌ Database tests failed. Fix them before pushing — CI runs this same
 *          suite.
 *
 *   which points at the money SQL — locks, wallet debits, claim transitions —
 *   when the money SQL was fine and nothing was listening on the port. The
 *   person reading that goes looking in the wrong place, and the person who has
 *   seen it twice starts passing --no-verify, which is how a gate stops being
 *   one.
 *
 *   A TCP CONNECT, NOT A QUERY. It needs no `psql`, no `pg_isready` and no
 *   driver — none of which a contributor's laptop is guaranteed to have, and a
 *   probe with its own dependencies is a second thing that can be missing. If
 *   something accepts a connection on that port, the suite's own failures are
 *   worth reading; if nothing does, they are not.
 *
 *   Exit 0 = something answered. Exit 1 = nothing did.
 */

const net = require('net');

const url = process.argv[2] || process.env.LOCAL_PG_URL || '';
if (!url) process.exit(1);

let host = '127.0.0.1';
let port = 5432;
try {
    /*
     *   Both spellings — `postgres://` and `postgresql://` — appear in this
     *   repository's own scripts (local-postgres.sh prints the first,
     *   .env.development.local carries the second), and Node's URL parses
     *   either without help.
     *
     *   An earlier version rewrote the scheme to `http://` first. It was cargo:
     *   a mutant that narrowed the rewrite to one spelling SURVIVED, which said
     *   the rewrite was doing nothing. Checked rather than assumed — both
     *   spellings give the same hostname and port through a plain `new URL` —
     *   and then removed, because unnecessary code is a thing that can be got
     *   wrong later.
     */
    const u = new URL(url);
    if (u.hostname) host = u.hostname;
    if (u.port) port = Number(u.port);
} catch {
    process.exit(1);
}

const socket = net.connect({ host, port });
const done = (code) => {
    socket.destroy();
    process.exit(code);
};

socket.setTimeout(3000);
socket.once('connect', () => done(0));
socket.once('timeout', () => done(1));
socket.once('error', () => done(1));
