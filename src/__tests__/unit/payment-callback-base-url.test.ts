/**
 * @jest-environment node
 */

/**
 * Two cooperative payment callbacks built their URL from a variable nothing
 * guarantees, and the check that would have noticed could never print.
 *
 * PART ONE — "undefined/cooperatives/verify-payment"
 * -------------------------------------------------
 * Both Paystack initiators in the cooperative module wrote:
 *
 *     callback_url: `${process.env.NEXT_PUBLIC_APP_URL}/cooperatives/verify-payment`
 *
 * with no fallback. NEXT_PUBLIC_APP_URL is not in env-validator's required
 * lists, so a deploy that never set it starts, serves, and takes payments
 * normally — and that template produces the literal string
 * "undefined/cooperatives/verify-payment". Paystack accepts the transaction and
 * redirects the member, who has just paid, to a URL that resolves nowhere. The
 * page that would have run verifyContributionPaymentAction never loads.
 *
 * One of the two is the REGISTRATION fee, so the member who lands nowhere has
 * paid to join and has no page on which to finish joining.
 *
 * The identical read was taken out of the academy and export initiators in
 * earlier passes. These two survived because the fix there was about the
 * callback PATH — a /academy/verify that was not a page — and this is about the
 * base in front of the path. Same file, same line, different half.
 *
 * getBaseUrl() is the platform's own answer: it prefers the request host and
 * falls back to www rather than the apex, which matters because the apex is a
 * redirector that answers POST with 405.
 *
 * PART TWO — a security check that was written to be invisible
 * -----------------------------------------------------------
 * env-validator looks for demo values in NEXTAUTH_SECRET, MFA_SECRET_KEY and
 * QR_ENCRYPTION_KEY. That check runs inside `if (isProduction)`. Its output
 * went into `warnings`, and logEnvValidation printed warnings inside
 * `if (process.env.NODE_ENV !== 'production')`.
 *
 * Production-only to compute, non-production-only to print. Not a race, not an
 * edge case — the finding could never be seen, by construction. A live deploy
 * running with a demo signing secret would report nothing at all.
 */

import { describe, it, expect, jest, afterEach } from '@jest/globals';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();

const CONTRIBUTE = 'src/app/api/cooperative/contribute/route.ts';
const REGISTER = 'src/app/api/cooperatives/register/route.ts';

function source(rel: string): string {
    return readFileSync(join(ROOT, rel), 'utf-8');
}

function code(rel: string): string {
    return source(rel)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((l) => !l.trim().startsWith('//'))
        .map((l) => l.replace(/\s\/\/.*$/, ''))
        .join('\n');
}

describe('the two cooperative initiators resolve their base from the request', () => {
    it.each([
        ['the contribution initiator', CONTRIBUTE],
        ['the registration initiator', REGISTER],
    ])('%s calls getBaseUrl()', (_label, rel) => {
        // THE test.
        const src = code(rel);
        expect(src).toContain('await getBaseUrl()');
        expect(src).toContain('from "@/lib/server-utils"');
    });

    it('and neither builds a callback from a bare env read any more', () => {
        for (const rel of [CONTRIBUTE, REGISTER]) {
            expect(code(rel)).not.toContain('${process.env.NEXT_PUBLIC_APP_URL}');
        }
    });

    it('still landing on the page that verifies the payment', () => {
        // The earlier fix must survive this one: the PATH was already corrected
        // from a /cooperatives/contribute/callback that does not exist.
        expect(code(CONTRIBUTE)).toContain('/cooperatives/verify-payment`');
        expect(code(REGISTER)).toContain('/cooperatives/verify-payment?reference=');
        expect(code(CONTRIBUTE)).not.toContain('/cooperatives/contribute/callback');
    });

    it('the registration one keeping the query it dispatches on', () => {
        expect(code(REGISTER)).toContain('type=registration');
        expect(code(REGISTER)).toContain('reference=${paymentReference}');
    });
});

describe('what a bare read actually produced, exercised rather than described', () => {
    it('an unset variable interpolates as the string "undefined"', () => {
        // The whole defect in one line, and the reason it is silent: this is a
        // valid string, not a throw.
        const unset = process.env.__DEFINITELY_NOT_SET_ANYWHERE__;
        expect(`${unset}/cooperatives/verify-payment`).toBe('undefined/cooperatives/verify-payment');
    });

    it('while getBaseUrl falls back to a host that can serve a POST', () => {
        // Vacuity guard: swapping one constant for another would be no fix.
        // The apex is a redirector that 405s a POST, so the fallback is www.
        const utils = source('src/lib/server-utils.ts');
        expect(utils).toContain('return process.env.NEXT_PUBLIC_APP_URL || "https://www.easysalesexport.com";');
        expect(utils).toContain('rejects POST with 405');
        // And the primary path is the request host, not the fallback at all.
        expect(utils).toContain('headerList.get("x-forwarded-host") || headerList.get("host")');
    });
});

describe('the shared initializer behind all eight modules', () => {
    // The sweep below is what found this one; it is not in the cooperative
    // module at all. initializePaystackPayment's LAST-RESORT callback — used
    // when neither the caller nor the metadata supplies one — was built from
    // the same bare read, so it was the widest instance of the three.
    const PAYSTACK = 'src/lib/paystack-server.ts';

    it('resolves its default base rather than interpolating an env var', () => {
        const src = code(PAYSTACK);
        expect(src).toContain('callback_url: callbackUrl || (metadata.callback_url as string) || `${await resolveDefaultBase()}/cooperatives/verify-payment`');
        expect(src).toContain('async function resolveDefaultBase()');
        expect(src).toContain('const { getBaseUrl } = await import("@/lib/server-utils");');
    });

    it('and degrades to www rather than throwing, because a throw fails the payment', () => {
        // getBaseUrl reads headers(), which needs a request scope. Every caller
        // is a server action, but the cost of being wrong is a failed payment,
        // so it is caught.
        const src = code(PAYSTACK);
        expect(src).toContain('return process.env.NEXT_PUBLIC_APP_URL || "https://www.easysalesexport.com";');
        expect(src).toMatch(/} catch \{\s*\n\s*return process\.env\.NEXT_PUBLIC_APP_URL/);
    });

    it('the caller-supplied callback still winning, unchanged', () => {
        // The fix must not change which callback is used when one was given —
        // only what happens when none was.
        const src = code(PAYSTACK);
        const line = src.split('\n').find((l) => l.includes('callback_url:'))!;
        expect(line.indexOf('callbackUrl')).toBeLessThan(line.indexOf('resolveDefaultBase'));
        expect(line.indexOf('metadata.callback_url')).toBeLessThan(line.indexOf('resolveDefaultBase'));
    });
});

describe('no payment initiator anywhere builds a callback from a bare env read', () => {
    // Per-CALLBACK rather than per-file: a file with one correct callback and
    // one broken one must not pass on the strength of the correct one.
    function walk(dir: string, out: string[] = []): string[] {
        for (const e of readdirSync(dir)) {
            const full = join(dir, e);
            if (statSync(full).isDirectory()) {
                if (e !== 'node_modules' && e !== '__tests__') walk(full, out);
            } else if (/\.tsx?$/.test(e)) out.push(full);
        }
        return out;
    }

    it('across every callback_url in src', () => {
        const offenders: string[] = [];
        for (const file of walk(join(ROOT, 'src'))) {
            const rel = file.slice(ROOT.length + 1);
            for (const line of code(rel).split('\n')) {
                if (!line.includes('callback_url')) continue;
                if (line.includes('${process.env.')) offenders.push(`${rel}: ${line.trim()}`);
            }
        }
        expect(offenders).toEqual([]);
    });

    it('and the scan can see a callback_url at all', () => {
        // Vacuity guard on the sweep above — an empty scan passes trivially.
        const found = walk(join(ROOT, 'src')).filter((f) =>
            code(f.slice(ROOT.length + 1)).includes('callback_url'));
        expect(found.length).toBeGreaterThan(3);
    });
});

describe('the weak-secret check can now be seen', () => {
    const ORIGINAL = { ...process.env };

    afterEach(() => {
        process.env = { ...ORIGINAL };
        jest.restoreAllMocks();
    });

    function loadValidator() {
        jest.resetModules();
        return require('@/lib/env-validator');
    }

    it('a demo secret in production is reported', () => {
        // THE test for part two. Before the split this landed in `warnings`,
        // which logEnvValidation printed only when NOT in production.
        (process.env as Record<string, string>).NODE_ENV = 'production';
        process.env.NEXTAUTH_SECRET = 'demo-secret-replace-me';

        const { validateEnv } = loadValidator();
        const result = validateEnv();

        expect(result.securityWarnings).toEqual(
            expect.arrayContaining([expect.stringContaining('NEXTAUTH_SECRET')]),
        );
    });

    it('and printed, in production, where it is the only place it can occur', () => {
        (process.env as Record<string, string>).NODE_ENV = 'production';
        process.env.QR_ENCRYPTION_KEY = 'test-key-example';

        const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
        const { logEnvValidation } = loadValidator();
        logEnvValidation();

        const printed = spy.mock.calls.map((c) => String(c[0])).join('\n');
        expect(printed).toContain('🔒 Environment security warnings:');
    });

    it('the old arrangement being unable to print it, shown rather than asserted', () => {
        // Reconstructs both conditions. computed only when production, printed
        // only when not production — the intersection is empty for every value
        // of NODE_ENV, which is why no amount of testing in dev would surface it.
        for (const env of ['production', 'development', 'test']) {
            const computed = env === 'production';
            const printed = env !== 'production';
            expect(computed && printed).toBe(false);
        }
    });

    it('a strong secret in production reports nothing', () => {
        (process.env as Record<string, string>).NODE_ENV = 'production';
        process.env.NEXTAUTH_SECRET = 'g7Qv2LpX9mZr4KsA1nWc6TbY8dHfJ3eR';
        process.env.MFA_SECRET_KEY = 'V5uN8xQ2wE7rT1yU4iO6pA9sD3fG0hJk';
        process.env.QR_ENCRYPTION_KEY = 'Zx3Cv6Bn9Mq2Ws5Ed8Rf1Tg4Yh7Uj0Ik';

        const { validateEnv } = loadValidator();
        expect(validateEnv().securityWarnings).toEqual([]);
    });

    it('and outside production the check does not run, so nothing is claimed', () => {
        // Stated so the guarantee is not overread: this reports on live
        // deploys only.
        (process.env as Record<string, string>).NODE_ENV = 'development';
        process.env.NEXTAUTH_SECRET = 'demo-secret-replace-me';

        const { validateEnv } = loadValidator();
        expect(validateEnv().securityWarnings).toEqual([]);
    });
});

describe('the recommended list names the variable this was all about', () => {
    it('NEXT_PUBLIC_APP_URL is recommended, not required', () => {
        // Recommended is the honest strength. After the two fixes above every
        // read of it has a fallback, so a deploy without it works — but several
        // of those fallbacks are the apex domain, so it should still be set.
        const src = source('src/lib/env-validator.ts');
        const recommended = src.slice(src.indexOf('const RECOMMENDED_ENV_VARS'), src.indexOf('] as const;', src.indexOf('const RECOMMENDED_ENV_VARS')));
        const required = src.slice(src.indexOf('const PRODUCTION_REQUIRED_ENV_VARS'), src.indexOf('] as const;', src.indexOf('const PRODUCTION_REQUIRED_ENV_VARS')));

        expect(recommended).toContain("'NEXT_PUBLIC_APP_URL'");
        expect(required).not.toContain("'NEXT_PUBLIC_APP_URL'");
    });

    it('and the validator is actually wired to startup', () => {
        // Vacuity guard: none of this matters if nothing calls it.
        expect(source('src/instrumentation.ts')).toContain("require('./lib/env-validator')");
        expect(source('src/instrumentation.ts')).toContain('logEnvValidation();');
    });
});
