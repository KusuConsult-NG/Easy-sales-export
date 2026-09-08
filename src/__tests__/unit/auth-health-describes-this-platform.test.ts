/**
 * @jest-environment node
 */

/**
 *   #511 THE PAGE YOU OPEN WHEN AUTH IS BROKEN SAID AUTH WAS BROKEN, ALWAYS.
 *
 *   /api/auth/health kept its own list of what authentication needs, and that
 *   list was six FIREBASE_* variables. Firebase is not in this application —
 *   package.json resolves both packages to local shims:
 *
 *       "firebase":       "file:./src/lib/shims/firebase"
 *       "firebase-admin": "file:./src/lib/shims/firebase-admin"
 *
 *   — and the data layer is Supabase. So on the live deployment, correctly
 *   configured, this endpoint answered `auth_will_work: false` and listed three
 *   Firebase credentials as MISSING.
 *
 *   `auth_will_work` was `NEXTAUTH_SECRET && NEXT_PUBLIC_FIREBASE_API_KEY &&
 *   FIREBASE_PROJECT_ID && FIREBASE_CLIENT_EMAIL && private key OK`. Four of
 *   those five are unset on every real deploy of this platform, so the value
 *   could not be true. It was false while sign-in worked and would have stayed
 *   false while sign-in was broken. AN INDICATOR WITH ONE VALUE IS NOT AN
 *   INDICATOR.
 *
 *   AND IT NEVER MENTIONED SUPABASE. NEXT_PUBLIC_SUPABASE_URL,
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY — the three
 *   #450 proved fatal from a real Railway log — were not checked at all. The
 *   screen for "why can nobody sign in" asked about a system that is gone and
 *   was silent about the system that is there.
 *
 * ── THE THIRD COPY OF A LIST #450 FIXED TWICE ───────────────────────────────
 *
 *   #450 removed the Firebase names from env-validator.ts and then found a
 *   second copy in security-checks.ts, which it pointed AT env-validator rather
 *   than repairing in place — "Two lists, one dead and wrong, is the shape this
 *   audit has found some thirty times. There is one list now."
 *
 *   There were three. This is the recurring class of this whole audit, met for
 *   the ninth time: the fix reached one of N doors. The door it missed is the
 *   one a person opens at 2am.
 *
 *   THE SECOND DOOR HERE: diagnose-broadcast.ts reported
 *   `projectId: process.env.FIREBASE_PROJECT_ID || "(not set)"` — the one field
 *   naming WHICH database its user counts came from, saying "(not set)" every
 *   time. Both now render env-validator's answer, so a fourth copy cannot be
 *   written.
 *
 * ── WHAT THIS DELIBERATELY DOES NOT DO ──────────────────────────────────────
 *
 *   NO VALUE IS EVER RETURNED. Names, booleans and two NEXT_PUBLIC_ hostname
 *   labels. An environment dump into an HTTP response is how a secret ends up
 *   somewhere it cannot be recalled from, and that rule is asserted below
 *   against a live secret planted in the environment.
 *
 *   THE KEY COMPARISON IS CONSTANT TIME NOW, and said at its size: recovering
 *   NEXTAUTH_SECRET from `===` across a network, through a proxy and Next's
 *   routing, is not a practical attack and I am not claiming one. It costs four
 *   lines not to have the question.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     auth_will_work computed from Firebase names again   KILLED
 *     the Supabase variables dropped from the report      KILLED
 *     a variable's VALUE included beside its name         KILLED
 *     the header key check removed                        KILLED
 *     reword this header                                  SURVIVED, as intended
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { readFileSync } from 'fs';
import { stripComments } from '@/lib/testing/strip-comments';

const SECRET = 'a-real-looking-nextauth-secret-value-9f3b2c';

const FATAL = [
    'NEXTAUTH_SECRET',
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
];

let saved: Record<string, string | undefined>;

const TOUCHED = [
    ...FATAL,
    'NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME',
    'CLOUDINARY_API_KEY',
    'CLOUDINARY_API_SECRET',
    'PAYSTACK_SECRET_KEY',
    'RESEND_API_KEY',
    'NEXTAUTH_URL',
    'RAILWAY_SERVICE_NAME',
];

beforeEach(() => {
    saved = {};
    for (const k of TOUCHED) saved[k] = process.env[k];

    process.env.NEXTAUTH_SECRET = SECRET;
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://dpuiznenrymoyarvdave.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key-value-not-to-be-echoed';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-value-not-to-be-echoed';
    process.env.PAYSTACK_SECRET_KEY = 'sk_test_not_to_be_echoed';
});

afterEach(() => {
    for (const k of TOUCHED) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
    }
});

async function call(headers: Record<string, string>) {
    const { GET } = await import('@/app/api/auth/health/route');
    const req = new Request('https://example.com/api/auth/health', { headers });
    return GET(req as never);
}

const body = async (headers: Record<string, string>) =>
    (await (await call(headers)).json()) as any;

const authed = () => body({ 'X-Auth-Health-Key': SECRET });

const named = (b: any, name: string) =>
    (b.variables as any[]).find((v) => v.name === name);

// ─────────────────────────────────────────────────────────────────────────────
describe('#511 — the health report describes THIS platform', () => {
    it('AUTH_WILL_WORK IS TRUE ON A CORRECTLY CONFIGURED DEPLOY', async () => {
        //   THE test. The old form asked for four Firebase variables that no
        //   deploy of this platform sets, so this value was false here, in
        //   production, and everywhere else — while sign-in worked.
        const b = await authed();

        expect(b.summary.auth_will_work).toBe(true);
        expect(b.summary.fatal_missing).toEqual([]);
    });

    it('AND FALSE WHEN A VARIABLE THAT REALLY IS FATAL IS ABSENT', async () => {
        //   The other half, and the reason the first assertion is not vacuous.
        //   #450 proved these four fatal from a Railway container log.
        delete process.env.SUPABASE_SERVICE_ROLE_KEY;

        const b = await authed();

        expect(b.summary.auth_will_work).toBe(false);
        expect(b.summary.fatal_missing).toContain('SUPABASE_SERVICE_ROLE_KEY');
    });

    it('AND THE SUPABASE VARIABLES ARE REPORTED AT ALL', async () => {
        //   They were absent from the report entirely. Not wrong — missing.
        const b = await authed();

        for (const name of FATAL) {
            expect(named(b, name)).toMatchObject({ status: 'OK', severity: 'fatal' });
        }
    });

    it('AND NO FIREBASE VARIABLE IS ASKED ABOUT', async () => {
        //   Firebase resolves to a local shim. A diagnostic naming it sends
        //   whoever is debugging to reinstate a service account this platform
        //   has no use for.
        const b = await authed();

        const names = (b.variables as any[]).map((v) => v.name).join(' ');
        expect(names).not.toMatch(/FIREBASE/);
    });

    it('AND A MISSING VARIABLE SAYS WHAT IT BREAKS', async () => {
        //   #457's rule: a name alone does not tell an operator whether to hunt
        //   for a key now or after the site is up.
        delete process.env.RESEND_API_KEY;
        const prev = process.env.NODE_ENV;
        Object.defineProperty(process.env, 'NODE_ENV', { value: 'production', configurable: true });

        try {
            const entry = named(await authed(), 'RESEND_API_KEY');
            expect(entry).toMatchObject({ status: 'MISSING' });
            expect(entry.breaks).toMatch(/email/i);
        } finally {
            Object.defineProperty(process.env, 'NODE_ENV', { value: prev, configurable: true });
        }
    });

    it('and a broken email service does not read as broken auth', async () => {
        //   RESEND_API_KEY is a broken feature on a working platform. It is not
        //   an answer to "can anyone sign in", and #457 is the finding that
        //   separated the two lists.
        delete process.env.RESEND_API_KEY;

        expect((await authed()).summary.auth_will_work).toBe(true);
    });

    it('and payments do not need a variable that has a fallback', async () => {
        //   The second false alarm from the same endpoint: payments_will_work
        //   also demanded NEXT_PUBLIC_APP_URL, which env-validator lists as
        //   RECOMMENDED because getBaseUrl() falls back through NEXTAUTH_URL
        //   and then the apex domain.
        delete process.env.NEXT_PUBLIC_APP_URL;

        const b = await authed();
        expect(b.summary.payments_will_work).toBe(true);

        delete process.env.PAYSTACK_SECRET_KEY;
        expect((await authed()).summary.payments_will_work).toBe(false);
    });

    it('and it names the database the counts would come from', async () => {
        expect((await authed()).deployment.supabaseProject).toBe('dpuiznenrymoyarvdave');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#511 — names and booleans, never values', () => {
    it('NO SECRET VALUE APPEARS ANYWHERE IN THE RESPONSE', async () => {
        //   Asserted against live values planted in the environment above, not
        //   against a rule about the code.
        const text = JSON.stringify(await authed());

        expect(text).not.toContain(SECRET);
        expect(text).not.toContain('service-role-value-not-to-be-echoed');
        expect(text).not.toContain('anon-key-value-not-to-be-echoed');
        expect(text).not.toContain('sk_test_not_to_be_echoed');
    });

    it('and the Railway display names are reported, which are not credentials', async () => {
        //   #462's rule — the same words the dashboard breadcrumb shows, so an
        //   operator can tell WHICH service answered.
        process.env.RAILWAY_SERVICE_NAME = 'easy-sales-export';

        expect((await authed()).deployment.railwayService).toBe('easy-sales-export');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#511 — the endpoint is still closed', () => {
    it('A REQUEST WITH NO KEY IS REFUSED', async () => {
        expect((await call({})).status).toBe(401);
    });

    it('AND A WRONG KEY IS REFUSED', async () => {
        expect((await call({ 'X-Auth-Health-Key': 'wrong' })).status).toBe(401);
    });

    it('AND A KEY OF THE RIGHT LENGTH BUT THE WRONG BYTES IS REFUSED', async () => {
        //   The constant-time comparison pads on a length mismatch; this is the
        //   equal-length path, which is the one timingSafeEqual answers.
        const wrong = 'b'.repeat(SECRET.length);

        expect((await call({ 'X-Auth-Health-Key': wrong })).status).toBe(401);
    });

    it('and an unset NEXTAUTH_SECRET refuses rather than opening', async () => {
        delete process.env.NEXTAUTH_SECRET;

        expect((await call({ 'X-Auth-Health-Key': SECRET })).status).toBe(401);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#511 — there is one list, and it is env-validator\'s', () => {
    it('THE ROUTE READS NO ENVIRONMENT VARIABLE LIST OF ITS OWN', () => {
        //   Comments stripped: this file's own header and the route's quote the
        //   FIREBASE_ names in order to explain them — the trap #493 recorded
        //   and this audit has now met five times.
        const route = stripComments(
            readFileSync('src/app/api/auth/health/route.ts', 'utf-8'),
            { label: 'auth/health route.ts' },
        );

        expect(route).not.toMatch(/FIREBASE/);
        expect(route).toContain('envVarStatuses');
    });

    it('AND NEITHER DOES THE BROADCAST DIAGNOSTIC', () => {
        //   The second door. It reported FIREBASE_PROJECT_ID as the source of
        //   its user counts, which was "(not set)" on every call.
        const diag = stripComments(
            readFileSync('src/app/actions/diagnose-broadcast.ts', 'utf-8'),
            { label: 'diagnose-broadcast.ts' },
        );

        expect(diag).not.toMatch(/FIREBASE/);
        expect(diag).toContain('dataLayerTarget()');
    });

    it('and every fatal variable env-validator names is reported here', async () => {
        //   The join that makes the two files one list: adding a name to
        //   FATAL_ENV_VARS must make it appear in this report without anyone
        //   editing the route.
        const { envVarStatuses } = await import('@/lib/env-validator');
        const reported = new Set((await authed()).variables.map((v: any) => v.name));

        for (const s of envVarStatuses()) {
            expect(reported.has(s.name)).toBe(true);
        }
    });
});
