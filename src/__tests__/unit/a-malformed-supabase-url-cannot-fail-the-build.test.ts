/**
 * @jest-environment node
 */

/**
 *   #451 `url || fallback` HANDLED MISSING AND NOT MALFORMED, SO ONE BAD
 *   CHARACTER IN AN ENVIRONMENT VARIABLE FAILED THE ENTIRE BUILD.
 *
 *   From a real Railway build, at "Collecting page data":
 *
 *       Error: Failed to collect configuration for
 *              /api/academy/certificate/generate
 *         [cause]: Error: Invalid supabaseUrl: Must be a valid HTTP or HTTPS URL.
 *             at 447697 (webpack://.../src/lib/supabase.ts:12:37)
 *             at 421095 (webpack://.../src/lib/supabase-db.ts:2224:1)
 *             at 720966 (webpack://.../src/lib/schemas.ts:414:4)
 *             at 928265 (webpack://.../src/lib/auth.config.ts:164:28)
 *       > Build error occurred
 *       Build Failed: exit code: 1
 *
 *   THE CAUSE. lib/supabase.ts ran, at MODULE SCOPE:
 *
 *       createClient(supabaseUrl || 'https://placeholder.supabase.co', ...)
 *
 *   An EMPTY value takes the fallback and is fine — that is the case the author
 *   had in mind, and it works. A NON-EMPTY value that is not a URL does not:
 *   `'PASTE-YOUR-OWN' || fallback` is `'PASTE-YOUR-OWN'`, and createClient
 *   throws on it.
 *
 *   The ways to get a non-empty non-URL are all ordinary: an unreplaced
 *   placeholder pasted into the platform's variable editor, a quoted value, a
 *   trailing space, `htps://`, or the project ref without the scheme.
 *
 *   TWO THINGS MAKE IT WORSE THAN THE TYPO DESERVES.
 *
 *     IT FAILS THE BUILD, NOT A REQUEST. auth.config.ts pulls this module in
 *     through schemas.ts and supabase-db.ts, so every page's data collection
 *     touches it. Nothing ships at all — where a platform that cannot reach
 *     Supabase at RUNTIME is a condition this codebase already handles.
 *
 *     AND IT NAMES THE WRONG FILE. The error leads with an academy certificate
 *     route, four frames from the cause, so the person reading it starts in a
 *     file that has nothing to do with the problem.
 *
 *   A malformed value now degrades exactly like a missing one, and says which
 *   variable and what is wrong with it.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     usableUrl returns the raw value again          KILLED
 *     the protocol check dropped (javascript: URLs)  KILLED
 *     a good URL silently replaced by the fallback   KILLED
 *     reword this header                             SURVIVED, as intended
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';

const ORIGINAL = process.env;

/** Load lib/supabase.ts fresh with `url` set, capturing what it logs. */
function loadWith(url: string | undefined): { threw: string | null; logs: string; clientUrl: string } {
    const logs: string[] = [];
    const realError = console.error;
    const realWarn = console.warn;
    console.error = (...a: unknown[]) => { logs.push(a.map(String).join(' ')); };
    console.warn = (...a: unknown[]) => { logs.push(a.map(String).join(' ')); };

    process.env = {
        ...ORIGINAL,
        NEXT_PUBLIC_SUPABASE_URL: url,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
        SUPABASE_SERVICE_ROLE_KEY: 'service-key',
    } as NodeJS.ProcessEnv;
    if (url === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;

    let threw: string | null = null;
    let clientUrl = '';

    try {
        jest.isolateModules(() => {
            const mod = require('@/lib/supabase');
            // supabase-js exposes the origin it was built with.
            clientUrl = String((mod.supabase as { supabaseUrl?: string }).supabaseUrl ?? '');
        });
    } catch (e) {
        threw = e instanceof Error ? e.message : String(e);
    } finally {
        console.error = realError;
        console.warn = realWarn;
        process.env = ORIGINAL;
    }

    return { threw, logs: logs.join('\n'), clientUrl };
}

/** Exactly the values that reach a deployment platform by accident. */
const NOT_URLS = [
    'PASTE-YOUR-OWN',                       // an unreplaced placeholder
    '<Project URL>',                        // the same, in angle brackets
    'abcdefghijklmno.supabase.co',          // the ref, no scheme
    'htps://abcdefghijklmno.supabase.co',   // a typo in the scheme
    '"https://abcdefghijklmno.supabase.co"',// quoted by the editor
    'your-project-url-here',
];

// ─────────────────────────────────────────────────────────────────────────────
describe('#451 — a malformed Supabase URL cannot fail the build', () => {
    beforeEach(() => { process.env = ORIGINAL; });
    afterEach(() => { process.env = ORIGINAL; });

    it('THE EXACT VALUE FROM THE FAILING BUILD NO LONGER THROWS', () => {
        // `NEXT_PUBLIC_SUPABASE_URL=PASTE-YOUR-OWN`, pasted literally.
        const loaded = loadWith('PASTE-YOUR-OWN');

        expect(loaded.threw).toBeNull();
    });

    it('and neither does any other ordinary way to get it wrong', () => {
        for (const value of NOT_URLS) {
            expect({ value, threw: loadWith(value).threw }).toEqual({ value, threw: null });
        }
    });

    it('IT FALLS BACK TO THE PLACEHOLDER, exactly as a MISSING value does', () => {
        // The whole point: malformed and missing become the same condition,
        // which the platform already knows how to be in.
        const { PLACEHOLDER_SUPABASE_URL } = require('@/lib/supabase');

        expect(loadWith('PASTE-YOUR-OWN').clientUrl).toBe(PLACEHOLDER_SUPABASE_URL);
        expect(loadWith(undefined).clientUrl).toBe(PLACEHOLDER_SUPABASE_URL);
        expect(loadWith('').clientUrl).toBe(PLACEHOLDER_SUPABASE_URL);
    });

    it('and SAYS WHICH VARIABLE and what is wrong with it', () => {
        // The old failure named an academy certificate route four frames from
        // the cause. This one names the variable.
        const logs = loadWith('PASTE-YOUR-OWN').logs;

        expect(logs).toContain('NEXT_PUBLIC_SUPABASE_URL');
        expect(logs).toMatch(/not a valid URL/i);
    });

    it('REFUSES A NON-HTTP SCHEME, which is a valid URL and not a usable one', () => {
        // `new URL()` accepts these happily. javascript: and file: are not
        // things to hand a client constructor.
        const loaded = loadWith('javascript:alert(1)');

        expect(loaded.threw).toBeNull();
        expect(loaded.logs).toMatch(/not http/i);
        expect(loaded.clientUrl).not.toContain('javascript');
    });

    it('A GOOD URL IS USED UNCHANGED — the control', () => {
        // Without this, "never throws" would also be satisfied by a module that
        // ignored the variable entirely.
        const loaded = loadWith('https://abcdefghijklmno.supabase.co');

        expect(loaded.threw).toBeNull();
        expect(loaded.clientUrl).toBe('https://abcdefghijklmno.supabase.co');
        expect(loaded.logs).not.toMatch(/not a valid URL/i);
    });

    it('and a good URL with surrounding whitespace is trimmed, not rejected', () => {
        // A trailing newline is what a copy-paste into a variable editor
        // produces, and it is not a mistake worth failing over.
        const loaded = loadWith('  https://abcdefghijklmno.supabase.co\n');

        expect(loaded.clientUrl).toBe('https://abcdefghijklmno.supabase.co');
        expect(loaded.logs).not.toMatch(/not a valid URL/i);
    });
});
