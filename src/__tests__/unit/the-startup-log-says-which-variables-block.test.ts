/**
 * @jest-environment node
 */

/**
 *   #457 THE STARTUP LOG NAMED THIRTEEN VARIABLES AND REFUSED TO START OVER
 *   FOUR, WITHOUT SAYING THEY WERE DIFFERENT LISTS.
 *
 *   The observed production boot, verbatim:
 *
 *       ❌ Environment validation failed!
 *       Missing required variables: [
 *         'NEXTAUTH_URL', 'NEXTAUTH_SECRET', 'NEXT_PUBLIC_SUPABASE_URL',
 *         'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'NEXT_PUBLIC_URL', 'RESEND_API_KEY',
 *         'PAYSTACK_SECRET_KEY', 'MFA_SECRET_KEY', 'QR_ENCRYPTION_KEY',
 *         'SUPABASE_SERVICE_ROLE_KEY', 'NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME',
 *         'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'
 *       ]
 *       🛑 REFUSING TO START.
 *         - NEXTAUTH_SECRET
 *         - NEXT_PUBLIC_SUPABASE_URL
 *         - NEXT_PUBLIC_SUPABASE_ANON_KEY
 *         - SUPABASE_SERVICE_ROLE_KEY
 *
 *   Anyone reading that concludes the container needs thirteen values and goes
 *   looking for a Cloudinary key before the site can come up. It needs FOUR. The
 *   other nine each break one feature on a platform that is otherwise serving —
 *   the distinction #450 drew when it separated fatal from required, and then
 *   did not print.
 *
 *   Getting a platform back up is exactly when nobody has patience for reading a
 *   validator's source to find out which list is which, so the log now says it:
 *   what blocks, what merely degrades, and what each degraded one costs.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     the two lists printed as one again        KILLED
 *     WHAT_BREAKS loses an entry                KILLED
 *     a fatal variable listed as degrading      KILLED
 *     reword this header                        SURVIVED, as intended
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { readFileSync } from 'fs';
import { stripComments } from '@/lib/testing/strip-comments';

const source = (rel: string) => stripComments(readFileSync(rel, 'utf-8'));

/** The four that stop the container, per FATAL_ENV_VARS. */
const FATAL = [
    'NEXTAUTH_SECRET',
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
];

/** Everything else the production boot listed. */
const DEGRADES = [
    'NEXTAUTH_URL',
    'NEXT_PUBLIC_URL',
    'RESEND_API_KEY',
    'PAYSTACK_SECRET_KEY',
    'MFA_SECRET_KEY',
    'QR_ENCRYPTION_KEY',
    'NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME',
    'CLOUDINARY_API_KEY',
    'CLOUDINARY_API_SECRET',
];

const ORIGINAL = process.env;

/**
 * Run logEnvValidation against exactly the given environment, capturing what it
 * prints.
 *
 * The whole `process.env` object is replaced rather than keys deleted: NODE_ENV
 * is typed readonly, and a boot that has to be described exactly is better
 * stated as the whole environment than as a list of deletions. Same shape as
 * a-container-with-no-configuration-must-not-serve.test.ts, deliberately.
 */
function boot(env: Record<string, string | undefined>): string {
    const lines: string[] = [];
    const errors = console.error;
    const warns = console.warn;
    const logs = console.log;

    console.error = (...a: unknown[]) => { lines.push(a.map(String).join(' ')); };
    console.warn = (...a: unknown[]) => { lines.push(a.map(String).join(' ')); };
    console.log = (...a: unknown[]) => { lines.push(a.map(String).join(' ')); };
    process.env = { ...env } as NodeJS.ProcessEnv;

    try {
        // Fresh module: the lists are read at call time, but isolating keeps
        // this honest if that ever changes.
        jest.isolateModules(() => {
            require('@/lib/env-validator').logEnvValidation();
        });
    } finally {
        process.env = ORIGINAL;
        console.error = errors;
        console.warn = warns;
        console.log = logs;
    }

    return lines.join('\n');
}

let output = '';
beforeEach(() => { output = boot({ NODE_ENV: 'production' }); });
afterEach(() => { output = ''; });

// ─────────────────────────────────────────────────────────────────────────────
describe('#457 — a boot with nothing set says what to do first', () => {
    it('SAYS HOW MANY STOP THE CONTAINER, AND NAMES THEM', () => {
        expect(output).toMatch(/4 that STOP THE CONTAINER STARTING/);
        for (const key of FATAL) expect(output).toContain(key);
    });

    it('AND SAYS THE OTHERS STILL SERVE — the whole point', () => {
        // Without this line the thirteen names read as thirteen blockers, and
        // the operator hunts a Cloudinary key before the site can come up.
        expect(output).toMatch(/9 that break one feature each, but still serve/);
    });

    it('AND SAYS WHAT EACH DEGRADED ONE COSTS', () => {
        // A name alone does not tell anyone whether to chase it now or later.
        expect(output).toContain('RESEND_API_KEY: no email leaves the platform');
        expect(output).toContain('PAYSTACK_SECRET_KEY: no payment can be initialised or verified');
        expect(output).toContain('CLOUDINARY_API_KEY: every upload fails');
    });

    it('and NEVER describes a fatal variable as one that still serves', () => {
        // The two lists must not overlap, or the log contradicts itself.
        const degradingSection = output.slice(output.indexOf('break one feature each'));

        for (const key of FATAL) {
            expect({ key, listedAsDegrading: degradingSection.includes(`- ${key}:`) })
                .toEqual({ key, listedAsDegrading: false });
        }
    });

    it('and still refuses to start — #450 is not softened, only explained', () => {
        expect(output).toContain('🛑 REFUSING TO START.');
    });

    it('POSITIVE CONTROL: a fully configured boot prints no failure banner', () => {
        // Without this, a validator that reported nothing at all would pass
        // every assertion above by never being reached.
        const configured: Record<string, string> = { NODE_ENV: 'production' };
        for (const key of [...FATAL, ...DEGRADES]) configured[key] = `set-${key}`;
        configured.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';

        const clean = boot(configured);

        expect(clean).not.toContain('Environment validation failed');
        expect(clean).not.toContain('REFUSING TO START');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#457 — every non-fatal required variable explains itself', () => {
    it('THE RATCHET: a variable added to either required list needs a reason', () => {
        // Otherwise the next one added prints a bare name again, which is the
        // defect this finding is.
        const validator = source('src/lib/env-validator.ts');

        const listed = (name: string) => {
            const start = validator.indexOf(`const ${name} = [`);
            expect(start).toBeGreaterThan(-1);
            const body = validator.slice(start, validator.indexOf('] as const', start));
            return [...body.matchAll(/'([A-Z][A-Z0-9_]*)'/g)].map((m) => m[1]);
        };

        const required = [...listed('REQUIRED_ENV_VARS'), ...listed('PRODUCTION_REQUIRED_ENV_VARS')];
        const explained = validator.slice(validator.indexOf('const WHAT_BREAKS'));

        const unexplained = required
            .filter((key) => !FATAL.includes(key))
            .filter((key) => !new RegExp(`\\b${key}:`).test(explained));

        expect({ unexplained }).toEqual({ unexplained: [] });
        expect(required.length).toBeGreaterThanOrEqual(13);
    });

    it('POSITIVE CONTROL: the scan really would catch an unexplained name', () => {
        const explained = "const WHAT_BREAKS = { RESEND_API_KEY: 'no email' };";

        expect(/\bRESEND_API_KEY:/.test(explained)).toBe(true);
        expect(/\bSOMETHING_NEW:/.test(explained)).toBe(false);
    });
});
