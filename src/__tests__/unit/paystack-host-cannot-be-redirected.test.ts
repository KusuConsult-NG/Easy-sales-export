/**
 * @jest-environment node
 */

/**
 * The centralisation this audit refused to do for two passes, done safely.
 *
 * "https://api.paystack.co" was written out 24 times across 15 files. Every
 * other duplication in this codebase got centralised on sight. This one was
 * deliberately left alone and recorded as an open item, because the obvious fix
 *
 *     const BASE = process.env.PAYSTACK_API_BASE_URL ?? "https://api.paystack.co";
 *
 * is worse than the duplication it removes.
 *
 * WHY. Every payment on this platform is confirmed by asking Paystack whether a
 * reference was really paid. Point that question at a host somebody else
 * controls and it answers yes — to every reference, for any amount, with any
 * metadata. paystack-verify-no-mock.test.ts exists because an earlier version
 * of verifyPaystackPayment fabricated successful payments for any reference
 * beginning with "T", which is a shape Paystack actually issues; that hole
 * recorded ₦50,000 payments that never happened, on a dozen fulfilment paths.
 * A bare env override reopens the same hole through a deploy config instead of
 * a code path.
 *
 * So the override exists, because a local stub is genuinely useful, and it is
 * refused where it would matter:
 *
 *   1. In production it is ignored outright, and logged.
 *   2. Outside production it must be a LOOPBACK host — a staging deploy pointed
 *      at somebody's domain is the same attack with a smaller audience.
 *
 * Both gates fail CLOSED to the live host, which is the value all 24 sites had
 * hardcoded. The worst case of this module misbehaving is the behaviour the
 * codebase had before it existed.
 *
 * lib/csp.ts KEEPS ITS LITERAL. The Content-Security-Policy must allow the real
 * Paystack host whatever any environment says; pointing the policy at the
 * override would admit a stub's origin into it. That is asserted below, because
 * it is exactly the kind of thing a later tidy-up would "finish".
 */

import { describe, it, expect, afterEach, jest } from '@jest/globals';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const LIVE = 'https://api.paystack.co';

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

describe('the override is refused in production', () => {
    const ORIGINAL = { ...process.env };

    afterEach(() => {
        process.env = { ...ORIGINAL };
        jest.resetModules();
    });

    function load() {
        jest.resetModules();
         
        return require('@/lib/paystack-host');
    }

    it('even when it names a perfectly ordinary-looking host — THE test', () => {
        (process.env as Record<string, string>).NODE_ENV = 'production';
        process.env.PAYSTACK_API_BASE_URL = 'https://api.paystack.co.evil.example';

        const { paystackBaseUrl, PAYSTACK_LIVE_HOST } = load();
        expect(paystackBaseUrl()).toBe(PAYSTACK_LIVE_HOST);
        expect(paystackBaseUrl()).toBe(LIVE);
    });

    it('and even when it names localhost, which is legal everywhere else', () => {
        // Production never talks to a stub, whatever the stub is.
        (process.env as Record<string, string>).NODE_ENV = 'production';
        process.env.PAYSTACK_API_BASE_URL = 'http://localhost:9999';

        const { paystackBaseUrl } = load();
        expect(paystackBaseUrl()).toBe(LIVE);
    });

    it('saying so loudly rather than silently', () => {
        (process.env as Record<string, string>).NODE_ENV = 'production';
        process.env.PAYSTACK_API_BASE_URL = 'http://localhost:9999';

        // resetModules FIRST, so the logger spied on is the same instance the
        // freshly-required paystack-host will import. Spying before the reset
        // patches a module that is about to be thrown away.
        jest.resetModules();
        const { logger } = require('@/lib/logger');
        const spy = jest.spyOn(logger, 'error').mockImplementation(() => {});
        require('@/lib/paystack-host').paystackBaseUrl();

        expect(String(spy.mock.calls[0]?.[0])).toContain('PRODUCTION deploy and is being IGNORED');
        spy.mockRestore();
    });
});

describe('outside production only a loopback stub is honoured', () => {
    const ORIGINAL = { ...process.env };

    afterEach(() => {
        process.env = { ...ORIGINAL };
        jest.resetModules();
    });

    function baseUrlWith(value: string | undefined, env = 'development'): string {
        jest.resetModules();
        (process.env as Record<string, string>).NODE_ENV = env;
        if (value === undefined) delete process.env.PAYSTACK_API_BASE_URL;
        else process.env.PAYSTACK_API_BASE_URL = value;
         
        return require('@/lib/paystack-host').paystackBaseUrl();
    }

    it('a local stub is used', () => {
        expect(baseUrlWith('http://localhost:9999')).toBe('http://localhost:9999');
        expect(baseUrlWith('http://127.0.0.1:9999')).toBe('http://127.0.0.1:9999');
    });

    it('with a trailing slash trimmed, so the joined path has no double slash', () => {
        expect(baseUrlWith('http://localhost:9999/')).toBe('http://localhost:9999');
    });

    it('and ANY non-loopback host is refused', () => {
        // The second gate. "It is only staging" is how a stub confirms a real
        // order.
        for (const host of [
            'https://api.paystack.co.evil.example',
            'https://evil.example',
            'https://staging-paystack.internal',
            'http://169.254.169.254',
            'http://localhost.evil.example',
        ]) {
            expect(baseUrlWith(host)).toBe(LIVE);
        }
    });

    it('as is anything that is not a URL at all', () => {
        for (const junk of ['not a url', '//localhost', 'localhost:9999', 'file:///etc/passwd', ' ']) {
            expect(baseUrlWith(junk)).toBe(LIVE);
        }
    });

    it('and an unset variable gives the live host, which is what every site had', () => {
        expect(baseUrlWith(undefined)).toBe(LIVE);
        expect(baseUrlWith('')).toBe(LIVE);
    });

    it('the test environment behaving like development, not like production', () => {
        // Stated so nobody reads the production gate as covering `test`.
        expect(baseUrlWith('http://localhost:9999', 'test')).toBe('http://localhost:9999');
    });
});

describe('the CSP keeps the real host, whatever the environment says', () => {
    it('as a literal, not through the override', () => {
        // THE thing a later tidy-up would "finish" and must not. Admitting a
        // stub's origin into the policy is the same hole from the browser side.
        //
        // RAW source, not stripped: csp.ts's allow-list contains wildcard hosts
        // like "https://*.firebaseio.com", and the `//*` in those is a block
        // comment opener to a regex-based stripper. Stripping this file eats it.
        const csp = source('src/lib/csp.ts');

        expect(csp).toContain('"https://api.paystack.co"');
        expect(csp).not.toContain('paystackBaseUrl');
        expect(csp).not.toContain('paystack-host');
    });

    it('and the module says why', () => {
        expect(source('src/lib/paystack-host.ts')).toContain('lib/csp.ts is NOT a caller');
    });
});

describe('every caller goes through it', () => {
    function walk(dir: string, out: string[] = []): string[] {
        for (const e of readdirSync(dir)) {
            const full = join(dir, e);
            if (statSync(full).isDirectory()) {
                if (e !== 'node_modules' && e !== '__tests__') walk(full, out);
            } else if (/\.tsx?$/.test(e)) out.push(full);
        }
        return out;
    }

    /** Files still writing the host out by hand, ignoring comments. */
    function hardcoded(): string[] {
        const found: string[] = [];
        for (const file of walk(join(ROOT, 'src'))) {
            const rel = file.slice(ROOT.length + 1);
            if (rel === 'src/lib/csp.ts' || rel === 'src/lib/paystack-host.ts') continue;
            if (code(rel).includes(LIVE)) found.push(rel);
        }
        return found.sort();
    }

    it('no file hardcodes the host any more', () => {
        // Was 24 occurrences across 15 files.
        expect(hardcoded()).toEqual([]);
    });

    it('and the scan can see one, so [] means clean', () => {
        // Vacuity guard: csp.ts is excluded from the sweep above precisely
        // because it still carries the literal, so it doubles as the positive
        // control. Raw source for the same reason as above.
        expect(source('src/lib/csp.ts')).toContain(LIVE);
    });

    it('the money paths in particular', () => {
        // Named individually — these are the ones where a redirected host means
        // a fabricated payment rather than a wrong bank list.
        for (const rel of [
            'src/lib/paystack-server.ts',
            'src/lib/paystack.ts',
            'src/lib/paystack-transfer.ts',
            'src/app/actions/wallet.ts',
            'src/app/api/cooperative/verify-payment/route.ts',
            'src/app/api/cron/reconcile-paystack/route.ts',
        ]) {
            expect(code(rel)).toContain('paystackBaseUrl');
        }
    });
});

describe('what this does not weaken', () => {
    it('verifyPaystackPayment still has no test-reference bypass', () => {
        // The hole this whole design exists to avoid reopening. If a mock ever
        // comes back, it comes back here.
        const src = code('src/lib/paystack-server.ts');

        expect(src).not.toContain("reference.startsWith('T')");
        expect(src).not.toContain('PLAYWRIGHT_TEST');
        expect(src).not.toContain('TEST_E2E_REF_');
    });

    it('and still refuses to run without a secret key', () => {
        expect(code('src/lib/paystack-server.ts'))
            .toContain('if (!secretKey) throw new Error("Payment service not configured");');
    });
});
