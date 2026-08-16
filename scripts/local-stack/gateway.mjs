/**
 * The local stack's gateway: Kong's routing and GoTrue's login, in one process.
 *
 * WHY THIS EXISTS
 * ---------------
 * `supabase start` needs to pull container images, and this environment's
 * egress policy denies Docker's layer CDNs. Without it there was no way to run
 * the application against anything but the production database — which is how
 * "testing locally" came to mean "testing on production with a localhost front
 * end", the situation migration 004's notes describe.
 *
 * Everything the stack needs except two pieces is available natively:
 * PostgreSQL is installed, and PostgREST ships a standalone static binary. The
 * two missing pieces are what this file supplies:
 *
 *   1. KONG'S ROUTING. supabase-js addresses `${url}/rest/v1/...` and
 *      `${url}/auth/v1/...`. PostgREST serves `/` — it knows nothing about the
 *      /rest/v1 prefix. Supabase puts Kong in front to strip it. That is a
 *      reverse proxy, and it is about thirty lines.
 *
 *   2. GOTRUE'S PASSWORD GRANT. src/lib/auth.ts authenticates every login
 *      through supabase.auth.signInWithPassword, and the seeder creates
 *      identities through supabase.auth.admin.createUser. Without those two,
 *      no test can log in and the entire authenticated surface — 22 of the 23
 *      e2e specs — stays unrunnable.
 *
 * WHAT THIS IS NOT
 * ----------------
 * This is NOT a reimplementation of Supabase, and the distinction matters when
 * reading a green run.
 *
 * The DATA path is real. Requests go to a real PostgREST binary against a real
 * PostgreSQL with the real schema, all 23 real migrations, and real row-level
 * security. Nothing about queries, filters, JSONB behaviour, the money
 * functions or RLS is simulated — if supabase-db.ts gets PostgREST semantics
 * wrong, it gets them wrong here too. That is the half that has been finding
 * defects.
 *
 * The AUTH path is a stand-in. It implements the four endpoints this codebase
 * calls, well enough to establish who is logged in. It deliberately does NOT
 * implement refresh-token rotation, MFA, OAuth providers, magic links, email
 * confirmation flows, or GoTrue's rate limiting. A green e2e run proves the
 * application's behaviour once a session exists; it does not certify GoTrue.
 * Anything that turns on those flows must still be tested against the real
 * thing.
 *
 * Passwords are hashed with pgcrypto's bcrypt, the same primitive GoTrue uses,
 * rather than stored in the clear — a fixture database is still a database, and
 * a shim that takes a shortcut there teaches the wrong habit.
 */

import http from 'node:http';
import crypto from 'node:crypto';
import pg from 'pg';

const PORT = Number(process.env.GATEWAY_PORT || 54321);
const POSTGREST = process.env.POSTGREST_URL || 'http://127.0.0.1:3001';
const DB_URL = process.env.LOCAL_DB_URL || 'postgresql://postgres@127.0.0.1:54322/postgres';
const JWT_SECRET = process.env.LOCAL_JWT_SECRET;

if (!JWT_SECRET) {
    console.error('LOCAL_JWT_SECRET is required — it must match the secret PostgREST was started with.');
    process.exit(1);
}

const pool = new pg.Pool({ connectionString: DB_URL, max: 10 });

// ─── JWT (HS256) ──────────────────────────────────────────────────────────────

const b64url = (buf) => Buffer.from(buf).toString('base64url');

export function mintToken(claims, expiresInSeconds = 60 * 60 * 24 * 365) {
    const now = Math.floor(Date.now() / 1000);
    const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const payload = b64url(JSON.stringify({ iss: 'supabase-local', iat: now, exp: now + expiresInSeconds, ...claims }));
    const signature = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest('base64url');
    return `${header}.${payload}.${signature}`;
}

// ─── Auth endpoints ───────────────────────────────────────────────────────────

function json(res, status, body) {
    const text = JSON.stringify(body);
    res.writeHead(status, {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(text),
        // supabase-js is called from the browser in some paths.
        'access-control-allow-origin': '*',
        'access-control-allow-headers': '*',
        'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    });
    res.end(text);
}

/** GoTrue's user shape, trimmed to the fields this codebase reads. */
function userPayload(row) {
    return {
        id: row.id,
        aud: 'authenticated',
        role: 'authenticated',
        email: row.email,
        email_confirmed_at: row.email_confirmed_at,
        confirmed_at: row.email_confirmed_at,
        user_metadata: row.raw_user_meta_data ?? {},
        app_metadata: { provider: 'email', providers: ['email'] },
        created_at: row.created_at,
        updated_at: row.updated_at,
        // Read by the firebase-admin auth shim's toUserRecord().
        phone: row.phone ?? undefined,
        banned_until: row.banned_until ?? undefined,
        last_sign_in_at: row.last_sign_in_at ?? undefined,
    };
}

function sessionPayload(row) {
    return {
        access_token: mintToken({ sub: row.id, email: row.email, role: 'authenticated' }, 60 * 60),
        token_type: 'bearer',
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        refresh_token: crypto.randomBytes(24).toString('hex'),
        user: userPayload(row),
    };
}

async function readBody(req) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    if (chunks.length === 0) return {};
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return {}; }
}

async function handleAuth(req, res, url) {
    const path = url.pathname.replace(/^\/auth\/v1/, '') || '/';

    // POST /token?grant_type=password — the login path src/lib/auth.ts uses.
    if (req.method === 'POST' && path === '/token') {
        const grant = url.searchParams.get('grant_type');
        if (grant !== 'password') {
            return json(res, 400, { error: 'unsupported_grant_type', error_description: `grant_type ${grant} is not implemented by the local stack` });
        }
        const { email, password } = await readBody(req);
        if (!email || !password) {
            return json(res, 400, { error: 'invalid_request', error_description: 'email and password are required' });
        }
        const { rows } = await pool.query(
            `SELECT * FROM auth.users
              WHERE lower(email) = lower($1)
                AND encrypted_password = crypt($2, encrypted_password)`,
            [email, password],
        );
        if (rows.length === 0) {
            // The shape supabase-js turns into { error: { message: 'Invalid login credentials' } }.
            return json(res, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials', msg: 'Invalid login credentials' });
        }
        return json(res, 200, sessionPayload(rows[0]));
    }

    // POST /admin/users — supabase.auth.admin.createUser, used by the seeder
    // and by the registration path's firebase-admin shim.
    if (req.method === 'POST' && path === '/admin/users') {
        const body = await readBody(req);
        const { email, password, email_confirm, user_metadata } = body;
        if (!email || !password) {
            return json(res, 400, { msg: 'email and password are required' });
        }
        const existing = await pool.query('SELECT 1 FROM auth.users WHERE lower(email) = lower($1)', [email]);
        if (existing.rowCount > 0) {
            // The seeder tests this message with /already/i before falling back
            // to listUsers, so the wording is load-bearing.
            return json(res, 422, { code: 422, msg: 'A user with this email address has already been registered' });
        }
        const { rows } = await pool.query(
            `INSERT INTO auth.users (email, encrypted_password, email_confirmed_at, raw_user_meta_data)
             VALUES (lower($1), crypt($2, gen_salt('bf')), $3, $4)
             RETURNING *`,
            [email, password, email_confirm ? new Date() : null, user_metadata ?? {}],
        );
        return json(res, 200, userPayload(rows[0]));
    }

    // GET /admin/users — supabase.auth.admin.listUsers
    if (req.method === 'GET' && path === '/admin/users') {
        const page = Math.max(1, Number(url.searchParams.get('page') || 1));
        const perPage = Math.min(1000, Math.max(1, Number(url.searchParams.get('per_page') || 50)));
        const { rows } = await pool.query(
            'SELECT * FROM auth.users ORDER BY created_at LIMIT $1 OFFSET $2',
            [perPage, (page - 1) * perPage],
        );
        return json(res, 200, { users: rows.map(userPayload), aud: 'authenticated' });
    }

    // GET /admin/users/:id — supabase.auth.admin.getUserById
    //
    // Absent until the auth shim was fixed. The shim's getUser() and the new
    // getUsers() both use it, so without it every uid lookup 404'd locally and
    // the auth paths could not be tested against this stack at all.
    const byId = /^\/admin\/users\/([^/]+)$/.exec(path);
    if (req.method === 'GET' && byId) {
        const { rows } = await pool.query('SELECT * FROM auth.users WHERE id = $1', [byId[1]]);
        if (rows.length === 0) return json(res, 404, { code: 404, msg: 'User not found' });
        return json(res, 200, userPayload(rows[0]));
    }

    // PUT /admin/users/:id — supabase.auth.admin.updateUserById
    //
    // Used by the password-change and password-reset paths, and by
    // updateUser({ disabled }) for account suspension. Also absent before.
    if (req.method === 'PUT' && byId) {
        const body = await readBody(req);
        const sets = [];
        const args = [byId[1]];
        const push = (frag, value) => { args.push(value); sets.push(frag.replace('?', '$' + args.length)); };

        if (body.email !== undefined) push('email = lower(?)', body.email);
        if (body.password !== undefined) push('encrypted_password = crypt(?, gen_salt(\'bf\'))', body.password);
        if (body.user_metadata !== undefined) push('raw_user_meta_data = ?', body.user_metadata);
        if (body.email_confirm !== undefined) push('email_confirmed_at = ?', body.email_confirm ? new Date() : null);
        if (body.phone !== undefined) push('phone = ?', body.phone);
        if (body.ban_duration !== undefined) {
            // GoTrue takes a Go duration string, or the literal 'none' to lift
            // the ban. Only the two cases the shim emits are modelled.
            push('banned_until = ?', body.ban_duration === 'none' ? null : new Date(Date.now() + 100 * 365 * 24 * 3600 * 1000));
        }

        if (sets.length === 0) {
            const { rows } = await pool.query('SELECT * FROM auth.users WHERE id = $1', [byId[1]]);
            if (rows.length === 0) return json(res, 404, { code: 404, msg: 'User not found' });
            return json(res, 200, userPayload(rows[0]));
        }

        const { rows } = await pool.query(
            `UPDATE auth.users SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $1 RETURNING *`,
            args,
        );
        if (rows.length === 0) return json(res, 404, { code: 404, msg: 'User not found' });
        return json(res, 200, userPayload(rows[0]));
    }

    // DELETE /admin/users/:id — supabase.auth.admin.deleteUser
    const del = byId;
    if (req.method === 'DELETE' && del) {
        await pool.query('DELETE FROM auth.users WHERE id = $1', [del[1]]);
        return json(res, 200, {});
    }

    // GET /user — the current user from a bearer token.
    if (req.method === 'GET' && path === '/user') {
        const token = (req.headers.authorization || '').replace(/^Bearer /i, '');
        try {
            const [, payload] = token.split('.');
            const { sub } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
            const { rows } = await pool.query('SELECT * FROM auth.users WHERE id = $1', [sub]);
            if (rows.length) return json(res, 200, userPayload(rows[0]));
        } catch { /* fall through to 401 */ }
        return json(res, 401, { msg: 'invalid token' });
    }

    // Anything else is a GoTrue feature this stack does not implement. Say so
    // loudly rather than returning an empty success — a silent no-op here would
    // be indistinguishable from a working endpoint, which is the failure mode
    // this whole audit keeps running into.
    return json(res, 501, {
        msg: `local-stack gateway does not implement ${req.method} /auth/v1${path}. `
            + 'Add it to scripts/local-stack/gateway.mjs, or test this flow against real GoTrue.',
    });
}

// ─── PostgREST proxy (Kong's job) ─────────────────────────────────────────────

function proxyToPostgrest(req, res, url) {
    const target = new URL(POSTGREST);
    const outbound = http.request(
        {
            hostname: target.hostname,
            port: target.port,
            // Strip the /rest/v1 prefix Kong exists to strip.
            path: url.pathname.replace(/^\/rest\/v1/, '') + url.search,
            method: req.method,
            headers: { ...req.headers, host: `${target.hostname}:${target.port}` },
        },
        (upstream) => {
            res.writeHead(upstream.statusCode || 502, upstream.headers);
            upstream.pipe(res);
        },
    );
    outbound.on('error', (err) => {
        json(res, 502, { message: `local-stack gateway could not reach PostgREST at ${POSTGREST}: ${err.message}` });
    });
    req.pipe(outbound);
}

// ─── Server ───────────────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

    if (req.method === 'OPTIONS') return json(res, 200, {});
    if (url.pathname === '/health') return json(res, 200, { ok: true });

    if (url.pathname.startsWith('/auth/v1')) {
        handleAuth(req, res, url).catch((err) => {
            console.error('[gateway] auth error', err);
            json(res, 500, { msg: err.message });
        });
        return;
    }

    if (url.pathname.startsWith('/rest/v1')) return proxyToPostgrest(req, res, url);

    json(res, 404, { message: `local-stack gateway has no route for ${url.pathname}` });
});

server.listen(PORT, '127.0.0.1', () => {
    console.log(`[gateway] listening on http://127.0.0.1:${PORT}`);
    console.log(`[gateway]   /rest/v1/* -> ${POSTGREST}`);
    console.log(`[gateway]   /auth/v1/* -> local auth (password grant, admin users)`);
});
