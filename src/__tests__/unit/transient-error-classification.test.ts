/**
 * @jest-environment node
 */

/**
 * ONE QUESTION, SEVENTEEN HAND-WRITTEN ANSWERS, THREE OF THEM DIFFERENT.
 *
 * "Is this error the network failing, or the request being wrong?" was answered
 * by a pasted chain of `.includes()` calls in seventeen places across ten
 * files. Counted, not estimated — the scan at the bottom of this file is the
 * one that found them, and it had drifted into three distinct lists:
 *
 *     16 clauses   lib/firestore-utils.ts, actions/auth.ts (x2),
 *                  components/auth/LoginForm.tsx
 *     13 clauses   lib/paystack-server.ts (x2)   — the 11 plus "timeout"/"exceeded"
 *     11 clauses   lib/safe-action.ts (x2), lib/auth.ts, actions/kyc.ts (x4),
 *                  actions/admin/_users.ts, cooperative/_coop_registration.ts (x2),
 *                  cooperative/_coop_money.ts
 *
 * WHY THE DRIFT IS NOT COSMETIC
 * -----------------------------
 * The short list and the long list sit on opposite sides of the same request.
 *
 *   runQueryWithRetry (16)   retries getaddrinfo / ENOTFOUND / network-error /
 *                            DEADLINE_EXCEEDED as infrastructure faults
 *   safe-action.ts (11)      does not have them, and its branch is
 *
 *       const sanitizedMessage = isTransient
 *           ? "A temporary connection issue occurred. Please try again."
 *           : errorMessage;
 *
 *                            under a comment reading "Return safe string to
 *                            client boundaries"
 *
 * So exactly the errors the system retries as infrastructure faults are the
 * ones it then hands to the browser VERBATIM — `getaddrinfo ENOTFOUND
 * db.<project-ref>.supabase.co` includes the Supabase project hostname. The
 * sanitiser's list being a SUBSET of the retrier's is the whole defect.
 *
 * The same split runs through one login. preValidateLoginAction holds the long
 * list and answers "A temporary connection issue occurred"; authorize() in
 * lib/auth.ts holds the short one and falls through to `userMessage =
 * error.message` for anything not ALL_CAPS and not in its map — so the raw DNS
 * error lands on the login screen, and a user is told an outage is their
 * password.
 *
 * WHAT IS DELIBERATELY NOT SHARED
 * -------------------------------
 * paystack-server.ts also matched the bare strings "timeout" and "exceeded".
 * "exceeded" matches "Quota exceeded" and "Rate limit exceeded" — calling a
 * rate limit a temporary connection issue would mislead the user, and inside a
 * retry loop it would hammer the limiter. Those two stay at their call site,
 * composed onto the shared helper rather than promoted into it.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { isTransientError, TRANSIENT_ERROR_MARKERS } from '@/lib/transient-error';

/** The five clauses the 11-clause copies were missing. */
const WAS_MISSING_FROM_THE_SHORT_LIST = [
    'getaddrinfo ENOTFOUND db.abcdefgh.supabase.co',
    'ENOTFOUND',
    'network-error',
    'DEADLINE_EXCEEDED',
    'context deadline exceeded',
];

describe('the classification the three lists disagreed about', () => {
    it.each(WAS_MISSING_FROM_THE_SHORT_LIST)(
        'treats %s as transient, which eleven of the seventeen copies did not',
        (message) => {
            expect(isTransientError(message)).toBe(true);
        },
    );

    it.each([
        'Premature close',
        'socket hang up',
        'read ECONNRESET',
        'Client network socket disconnected before secure TLS connection was established',
        'FetchError: request failed',
        'TypeError: fetch failed',
        'Connection closed',
        'Socket closed',
        '13 UNAVAILABLE: connection attempt failed',
        'stream terminated by RST_STREAM',
        'ERR_STREAM_PREMATURE_CLOSE',
    ])('still treats %s as transient, as every copy already did', (message) => {
        expect(isTransientError(message)).toBe(true);
    });

    it.each([
        'Invalid login credentials',
        'A user with this email address has already been registered',
        'permission denied for table users',
        'duplicate key value violates unique constraint',
        '',
    ])('does not treat %s as transient', (message) => {
        expect(isTransientError(message)).toBe(false);
    });

    it('DOES NOT CALL A RATE LIMIT A CONNECTION PROBLEM', () => {
        // paystack-server.ts matched the bare string "exceeded", which catches
        // these. Promoting that into the shared helper would have told a
        // rate-limited user to check their connection, and made
        // runQueryWithRetry retry against a limiter.
        expect(isTransientError('Quota exceeded')).toBe(false);
        expect(isTransientError('Rate limit exceeded')).toBe(false);
        expect(isTransientError('Request timeout')).toBe(false);
    });

    it('accepts an Error, a string, or anything with a message', () => {
        // The seventeen call sites variously passed `err.message`,
        // `String(err)` and a caught value of unknown shape.
        expect(isTransientError(new Error('socket hang up'))).toBe(true);
        expect(isTransientError('socket hang up')).toBe(true);
        expect(isTransientError({ message: 'socket hang up' })).toBe(true);
        expect(isTransientError(null)).toBe(false);
        expect(isTransientError(undefined)).toBe(false);
    });
});

// ─── the ratchet ─────────────────────────────────────────────────────────────

function sourceFiles(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
            if (entry === 'node_modules' || entry === '__tests__') continue;
            sourceFiles(full, out);
        } else if (/\.tsx?$/.test(entry)) {
            out.push(full);
        }
    }
    return out;
}

describe('no eighteenth copy', () => {
    it('NOTHING HAND-ROLLS THE CHAIN ANY MORE', () => {
        /**
         * The check that matters. Seventeen copies drifted into three lists
         * because each was written by hand next to the code that needed it,
         * and nothing could see the others. This can see all of them.
         *
         * Keyed on `.includes("Premature close")` — the first clause of every
         * copy, and specific enough that only this chain matches. A comment
         * mentioning the phrase is fine; a call is not.
         */
        const offenders: string[] = [];
        for (const file of sourceFiles(join(process.cwd(), 'src'))) {
            if (file.endsWith('src/lib/transient-error.ts')) continue;
            readFileSync(file, 'utf-8').split('\n').forEach((raw, i) => {
                if (/\.includes\(\s*["'`]Premature close["'`]\s*\)/.test(raw)) {
                    offenders.push(`${file.replace(process.cwd() + '/', '')}:${i + 1}`);
                }
            });
        }

        expect(offenders).toEqual([]);
    });

    it('and the shared list still carries every clause the copies had', () => {
        // Guards the consolidation itself: dropping a marker here would
        // silently narrow seventeen call sites at once, which is a worse
        // version of the drift being fixed.
        for (const marker of [
            'Premature close', 'socket hang up', 'ECONNRESET',
            'Client network socket disconnected', 'FetchError', 'fetch failed',
            'Connection closed', 'Socket closed', 'UNAVAILABLE',
            'stream terminated', 'ERR_STREAM_PREMATURE_CLOSE',
            'ENOTFOUND', 'getaddrinfo', 'network-error',
            'DEADLINE_EXCEEDED', 'deadline exceeded',
        ]) {
            expect(TRANSIENT_ERROR_MARKERS).toContain(marker);
        }
        expect(TRANSIENT_ERROR_MARKERS).toHaveLength(16);
    });

    it('and the two gateway-specific clauses stayed at their call site', () => {
        // paystack composes them on rather than the helper absorbing them.
        const paystack = readFileSync(join(process.cwd(), 'src/lib/paystack-server.ts'), 'utf-8');

        expect(paystack).toContain('isTransientError(errMsg) || errMsg.includes("timeout") || errMsg.includes("exceeded")');
        expect(TRANSIENT_ERROR_MARKERS).not.toContain('exceeded');
        expect(TRANSIENT_ERROR_MARKERS).not.toContain('timeout');
    });
});

describe('the two sides of the request now agree', () => {
    it('the retrier and the sanitiser ask the same function', () => {
        // The defect in one assertion: these two files disagreeing is what put
        // a Supabase hostname in front of a user.
        for (const file of ['src/lib/firestore-utils.ts', 'src/lib/safe-action.ts']) {
            const text = readFileSync(join(process.cwd(), file), 'utf-8');
            expect(text).toContain('isTransientError');
        }
    });

    it('and so do the two halves of the login flow', () => {
        for (const file of ['src/app/actions/auth.ts', 'src/lib/auth.ts']) {
            const text = readFileSync(join(process.cwd(), file), 'utf-8');
            expect(text).toContain('isTransientError');
        }
    });
});
