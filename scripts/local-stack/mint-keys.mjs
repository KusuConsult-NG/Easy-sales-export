/**
 * Mint the anon / service_role API keys the local stack uses.
 *
 * A Supabase "API key" is just an HS256 JWT whose `role` claim names the
 * Postgres role PostgREST should switch to. There is nothing else to it — which
 * is worth knowing, because it is also why the anon key that ships in the
 * browser bundle is a real database credential, and why row-level security is
 * the only thing standing between it and every row.
 *
 *   node scripts/local-stack/mint-keys.mjs anon
 *   node scripts/local-stack/mint-keys.mjs service_role
 *
 * LOCAL_JWT_SECRET must match the secret PostgREST was started with, or every
 * request comes back 401 with a message that does not mention the secret.
 */

import crypto from 'node:crypto';

const role = process.argv[2];
const secret = process.env.LOCAL_JWT_SECRET;

if (!role || !['anon', 'service_role', 'authenticated'].includes(role)) {
    console.error('usage: mint-keys.mjs <anon|service_role|authenticated>');
    process.exit(1);
}
if (!secret) {
    console.error('LOCAL_JWT_SECRET is required');
    process.exit(1);
}

const b64url = (s) => Buffer.from(s).toString('base64url');
const now = Math.floor(Date.now() / 1000);

const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
const payload = b64url(JSON.stringify({
    iss: 'supabase-local',
    role,
    iat: now,
    exp: now + 60 * 60 * 24 * 365 * 10,
}));
const signature = crypto.createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');

process.stdout.write(`${header}.${payload}.${signature}`);
