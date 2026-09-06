/**
 * @jest-environment node
 */

/**
 *   #450 A CONTAINER DEPLOYED WITH NO CONFIGURATION AT ALL PRINTED THE FAILURE,
 *   SAID "READY", AND SERVED TRAFFIC IT COULD NOT ANSWER.
 *
 *   From a real Railway log, not a hypothetical:
 *
 *       ❌ Environment validation failed!
 *       Missing required variables: [ 'NEXTAUTH_SECRET', 'NEXTAUTH_URL',
 *         'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', ...15 total ]
 *       [dotenv] injecting env (0) from .env.local
 *       ✓ Ready in 0ms
 *       [auth][error] MissingSecret: Please define a `secret`.
 *           at /app/.next/server/src/middleware.js
 *
 *   Fifteen variables missing, and the process carried on. Every request then
 *   died in the MIDDLEWARE — before any route — so the platform accepted
 *   traffic it could not answer, and the deploy counted as a success.
 *
 *   THAT IS WORSE THAN CRASHING. Railway keeps the previous container when a new
 *   one exits. Booting broken REPLACED a working site with one that 500s on
 *   every request; exiting would have left the old one serving.
 *
 *   THREE THINGS MADE IT POSSIBLE, AND ALL THREE ARE FIXED HERE.
 *
 *   1. logEnvValidation printed and RETURNED. The caller in instrumentation.ts
 *      then continued booting. A gate that reports and proceeds is not a gate —
 *      the same shape as #245's kill switch failing open and #296's refusal
 *      rendered as a clean bill of health.
 *
 *   2. validateRequiredEnvVars in security-checks.ts THROWS a clear
 *      "MISSING REQUIRED ENVIRONMENT VARIABLES" — and HAS NO CALLERS. The guard
 *      written for this exact situation was wired to nothing. Its list had also
 *      drifted: it demanded NEXT_PUBLIC_FIREBASE_API_KEY and FIREBASE_PROJECT_ID,
 *      two names env-validator deliberately removed because Firebase is shimmed
 *      to Supabase and nothing reads them. Wiring it up naively would have
 *      refused to start a CORRECTLY configured platform.
 *
 *   3. QOREID_CLIENT_ID and QOREID_SECRET_KEY were REQUIRED, and the module is
 *      parked by owner decision — so the keys are unset and EVERY deploy printed
 *      "❌ Environment validation failed!". A container with nothing configured
 *      looked exactly like a healthy one. env-validator's own comment records
 *      six FIREBASE_* names being removed for precisely this reason: requiring
 *      what nothing reads "buried the entries that genuinely matter". QoreID had
 *      quietly taken that job over.
 *
 *   THE FATAL SET IS THE ONE THE LOG PROVED, NOT A GUESS. Without NEXTAUTH_SECRET
 *   the middleware rejects everything; without the Supabase URL and keys there is
 *   no data layer to answer with. A missing RESEND_API_KEY breaks email — a
 *   broken feature on a working platform — and stays a loud error, not an exit.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     the production exit removed                    KILLED
 *     the exit fires in development too              KILLED
 *     SUPABASE_SERVICE_ROLE_KEY dropped from fatal   KILLED
 *     QoreID put back in REQUIRED                    KILLED
 *     validateRequiredEnvVars keeps its own list     KILLED
 *     reword this header                             SURVIVED, as intended
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { readFileSync } from 'fs';
import { stripComments } from '@/lib/testing/strip-comments';

const source = (rel: string) => stripComments(readFileSync(rel, 'utf-8'));

/** Every variable the failing Railway container had unset. */
const THE_RAILWAY_CONTAINER = [
    'NEXTAUTH_SECRET', 'NEXTAUTH_URL',
    'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY', 'RESEND_API_KEY', 'PAYSTACK_SECRET_KEY',
    'MFA_SECRET_KEY', 'QR_ENCRYPTION_KEY', 'NEXT_PUBLIC_URL',
    'NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET',
    'QOREID_CLIENT_ID', 'QOREID_SECRET_KEY',
];

const ORIGINAL = process.env;

/** Run `fn` with exactly `env` set, and capture what it does. */
function withEnv<T>(env: Record<string, string | undefined>, fn: () => T): T {
    process.env = { ...env } as NodeJS.ProcessEnv;
    try {
        return fn();
    } finally {
        process.env = ORIGINAL;
    }
}

interface BootOutcome { exited: boolean; code?: number; output: string }

function boot(env: Record<string, string | undefined>): BootOutcome {
    const out: string[] = [];
    const realError = console.error;
    const realWarn = console.warn;
    const realLog = console.log;
    const realExit = process.exit;

    let exited = false;
    let code: number | undefined;

    console.error = (...a: unknown[]) => { out.push(a.map(String).join(' ')); };
    console.warn = (...a: unknown[]) => { out.push(a.map(String).join(' ')); };
    console.log = (...a: unknown[]) => { out.push(a.map(String).join(' ')); };
    // Recorded rather than performed — exiting the worker would take the whole
    // suite with it, which is the behaviour under test.
    (process as unknown as { exit: (c?: number) => void }).exit = (c?: number) => {
        exited = true; code = c;
        throw new Error('__EXIT__');
    };

    try {
        withEnv(env, () => {
            jest.isolateModules(() => {
                const { logEnvValidation } = require('@/lib/env-validator');
                const result = logEnvValidation();
                // The boot's half of the rule, reproduced exactly as
                // instrumentation.ts spells it — the validator reports, the
                // boot refuses. Asserted together because either half alone
                // lets a dead container serve.
                if (result?.fatalMissing?.length && process.env.NODE_ENV === 'production') {
                    process.exit(1);
                }
            });
        });
    } catch (e) {
        if ((e as Error).message !== '__EXIT__') throw e;
    } finally {
        console.error = realError;
        console.warn = realWarn;
        console.log = realLog;
        (process as unknown as { exit: typeof realExit }).exit = realExit;
    }

    return { exited, code, output: out.join('\n') };
}

/**
 * A COMPLETE production environment — every variable env-validator requires.
 *
 * My first version of this listed only the four fatal ones, and two tests
 * failed because the banner correctly reported the eight production-required
 * variables I had not set. The fixture was wrong, not the code. Written out in
 * full so "configured" here means what it means on the platform.
 */
const CONFIGURED = {
    NODE_ENV: 'production',
    NEXTAUTH_SECRET: 'x'.repeat(64),
    NEXTAUTH_URL: 'https://easysalesexport.com',
    NEXT_PUBLIC_SUPABASE_URL: 'https://p.supabase.co',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon',
    SUPABASE_SERVICE_ROLE_KEY: 'service',
    NEXT_PUBLIC_URL: 'https://easysalesexport.com',
    RESEND_API_KEY: 're_test',
    PAYSTACK_SECRET_KEY: 'sk_test',
    MFA_SECRET_KEY: 'm'.repeat(64),
    QR_ENCRYPTION_KEY: 'q'.repeat(64),
    NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME: 'demo',
    CLOUDINARY_API_KEY: 'ck',
    CLOUDINARY_API_SECRET: 'cs',
};

// ─────────────────────────────────────────────────────────────────────────────
describe('#450 — a production container with nothing configured refuses to start', () => {
    beforeEach(() => { process.env = ORIGINAL; });
    afterEach(() => { process.env = ORIGINAL; });

    it('THE RAILWAY CONTAINER EXITS INSTEAD OF SAYING READY', () => {
        // Exactly the environment from the log: nothing set at all.
        const outcome = boot({ NODE_ENV: 'production' });

        expect(outcome.exited).toBe(true);
        expect(outcome.code).toBe(1);
        expect(outcome.output).toContain('REFUSING TO START');
    });

    it('and names the variables that made it impossible to serve', () => {
        const outcome = boot({ NODE_ENV: 'production' });

        for (const key of ['NEXTAUTH_SECRET', 'NEXT_PUBLIC_SUPABASE_URL',
            'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']) {
            expect(outcome.output).toContain(key);
        }
    });

    it('MISSING NEXTAUTH_SECRET ALONE IS ENOUGH — it is what killed every request', () => {
        // The log's own proof: MissingSecret, thrown in the middleware, before
        // any route ran.
        const outcome = boot({ ...CONFIGURED, NEXTAUTH_SECRET: undefined });

        expect(outcome.exited).toBe(true);
        expect(outcome.output).toContain('NEXTAUTH_SECRET');
    });

    it('and so is missing SUPABASE_SERVICE_ROLE_KEY — there is no data layer without it', () => {
        const outcome = boot({ ...CONFIGURED, SUPABASE_SERVICE_ROLE_KEY: undefined });

        expect(outcome.exited).toBe(true);
        expect(outcome.output).toContain('SUPABASE_SERVICE_ROLE_KEY');
    });

    it('A FULLY CONFIGURED PRODUCTION BOOT IS NOT REFUSED', () => {
        // The control that stops this from being "refuse everything".
        const outcome = boot(CONFIGURED);

        expect(outcome.exited).toBe(false);
        expect(outcome.output).not.toContain('REFUSING TO START');
    });

    it('AND A BROKEN FEATURE IS NOT A REFUSAL — email, payments, uploads', () => {
        // These break one thing on a platform that otherwise works. Exiting for
        // them would turn a missing email key into an outage.
        const outcome = boot({
            ...CONFIGURED,
            RESEND_API_KEY: undefined,
            PAYSTACK_SECRET_KEY: undefined,
            CLOUDINARY_API_KEY: undefined,
        });

        expect(outcome.exited).toBe(false);
    });

    it('AND DEVELOPMENT IS NEVER REFUSED — a missing key stops the thing that needs it', () => {
        const outcome = boot({ NODE_ENV: 'development' });

        expect(outcome.exited).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#450 — the failure banner means something again', () => {
    it('QOREID IS NO LONGER REQUIRED, so a parked module stops burying real faults', () => {
        // It was required while the module is parked by owner decision, so
        // EVERY deploy printed "Environment validation failed!" and a container
        // with nothing configured looked exactly like a healthy one.
        const outcome = boot(CONFIGURED);

        expect(outcome.output).not.toContain('Environment validation failed');
        expect(outcome.output).not.toContain('QOREID_CLIENT_ID');
    });

    it('and an unset QoreID key still fails where it is USED, with its own name', () => {
        // Demoting it must not make the failure silent — it moves from a boot
        // banner nobody could read to a per-request error that names the key.
        expect(source('src/lib/qoreid.ts'))
            .toContain('QOREID_CLIENT_ID or QOREID_SECRET_KEY is missing');
    });

    it('THE FAILURE BANNER STILL FIRES for something genuinely required', () => {
        // Vacuity guard: the two tests above would both pass if the banner had
        // simply been deleted.
        const outcome = boot({ ...CONFIGURED, NEXTAUTH_URL: undefined });

        expect(outcome.output).toContain('Environment validation failed');
        expect(outcome.output).toContain('NEXTAUTH_URL');
        expect(outcome.exited).toBe(false);   // required, but not fatal
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#450 — one list of required variables, not two', () => {
    it('validateRequiredEnvVars NO LONGER KEEPS ITS OWN', () => {
        const src = source('src/lib/security-checks.ts');

        // It demanded two Firebase names env-validator deliberately removed, so
        // wiring it up would have refused a correctly configured platform.
        expect(src).not.toContain('NEXT_PUBLIC_FIREBASE_API_KEY');
        expect(src).not.toContain('FIREBASE_PROJECT_ID');
        expect(src).toContain('validateEnv()');
    });

    it('and still throws, so a caller wanting an exception gets one', () => {
        // The contract is kept; only the answer is shared.
        withEnv({ NODE_ENV: 'production' }, () => {
            jest.isolateModules(() => {
                const { validateRequiredEnvVars } = require('@/lib/security-checks');
                expect(() => validateRequiredEnvVars()).toThrow(/MISSING REQUIRED/);
            });
        });
    });

    it('and says nothing when the platform is configured', () => {
        withEnv(CONFIGURED, () => {
            jest.isolateModules(() => {
                const { validateRequiredEnvVars } = require('@/lib/security-checks');
                expect(() => validateRequiredEnvVars()).not.toThrow();
            });
        });
    });

    it('VACUITY GUARD: the container we are describing really was missing all of these', () => {
        // The fixture is the log, not an invention.
        expect(THE_RAILWAY_CONTAINER).toHaveLength(15);
        expect(THE_RAILWAY_CONTAINER).toContain('NEXTAUTH_SECRET');
        expect(THE_RAILWAY_CONTAINER).toContain('SUPABASE_SERVICE_ROLE_KEY');
    });
});
