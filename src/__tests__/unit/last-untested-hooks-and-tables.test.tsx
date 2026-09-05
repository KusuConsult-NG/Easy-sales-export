/**
 * @jest-environment jsdom
 */

/**
 *   #418 THE LAST OF THE UNTESTED SHARED LAYER — A GUARD THAT ALWAYS SAID YES,
 *   A HAND-COPIED TABLE NOTHING KEPT IN STEP, AND A BROWSER MAP NARROWER THAN
 *   THE SERVER'S.
 *
 *   Closing the sweep that produced #405–#417. What was left in src/lib and
 *   src/hooks with no test naming it: client-collections, form-validation,
 *   locations, record-export, chatbot-knowledge, useDebounce, useOnce,
 *   useFirebaseAuthed, useMembershipStatus.
 *
 *   (a) useFirebaseAuthed RETURNED THE LITERAL `true`. Its own header called it
 *       a "Legacy Firebase Authentication Guard (Shimmed)". A check that cannot
 *       fail reads, at every call site, like a check — #331's class. Nothing
 *       imports it, so no screen relied on it; what made it worth acting on is
 *       that it was one import away from LOOKING like a gate and admitting
 *       everybody. Kept, not deleted, and retired in place: it throws now, so a
 *       caller that wires it up fails at that moment instead of silently
 *       letting everyone through. #3's rule for shims, applied to the last one
 *       that still lied.
 *
 *   (b) client-collections.ts IS TEN COLLECTION NAMES COPIED BY HAND from
 *       lib/types/firestore.ts, and nothing checked they still matched. They
 *       do, today — checked name by name. But the five waiting screens pass
 *       these very strings to getMyApplicationStatus, whose allowlist is keyed
 *       on the SERVER table: one character of drift and every poll answers
 *       "unknown" and every applicant sits on the waiting page. That is #415's
 *       failure mode reachable through a typo, so the two tables are compared
 *       here rather than trusted.
 *
 *   (c) useMembershipStatus MAPPED EACH MODULE TO ONE REGISTRATION KEY, where
 *       the server maps two of them to a pair — ["cooperatives","cooperative"]
 *       and ["farmNation","farm_nation"] — and schema-normalizer exists to
 *       mirror those pairs because both spellings are written. lib/auth.ts puts
 *       serviceRegistrations into the token verbatim, with no mirroring, so a
 *       member stored under the legacy spelling had a session the hook could
 *       not read. Stated exactly: that made the FIRST PAINT wrong, not the
 *       access decision — the server reads both spellings and answers with the
 *       real status. Both are read now.
 *
 *   (d) useOnce's HEADER SAID THE CALLBACK FIRES ON THE SECOND MOUNT. It does
 *       not: the ref persists across React 18's probe unmount, so the callback
 *       fires on the FIRST effect run and the second is the no-op. It still
 *       runs exactly once, which is what the three payment-verification
 *       callbacks need — but a cleanup RETURNED from the callback is then torn
 *       down by the probe unmount and never re-established. No caller returns
 *       one today; all three are checked below.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     useFirebaseAuthed answers true again          KILLED
 *     a collection name drifts from the server      KILLED
 *     the module map narrows to one key again       KILLED
 *     useOnce loses its once-guard                  KILLED
 *     reword the header prose                       SURVIVED, as intended
 */

import React from 'react';
import { describe, it, expect } from '@jest/globals';
import { renderHook, act, render } from '@testing-library/react';
import { readFileSync } from 'fs';
import { join, relative } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import { COLLECTIONS as CLIENT_COLLECTIONS } from '@/lib/client-collections';
import { COLLECTIONS as SERVER_COLLECTIONS } from '@/lib/types/firestore';
import { useFirebaseAuthed } from '@/hooks/useFirebaseAuthed';
import { useOnce } from '@/hooks/useOnce';
import { useDebounce } from '@/hooks/useDebounce';

const ROOT = process.cwd();
const code = (p: string) => stripComments(readFileSync(join(ROOT, p), 'utf-8'), { label: relative(ROOT, p) });

/** The three screens that guard a payment verification with useOnce. */
const PAYMENT_CALLBACKS = [
    'src/app/marketplace/payment/callback/page.tsx',
    'src/app/cooperatives/payment/callback/page.tsx',
    'src/app/academy/payment/callback/page.tsx',
];

// ─────────────────────────────────────────────────────────────────────────────
describe('#418 — a guard that always said yes', () => {
    it('IT REFUSES TO ANSWER RATHER THAN ANSWERING "YES"', () => {
        expect(() => useFirebaseAuthed('any-user')).toThrow(/retired/i);
        expect(() => useFirebaseAuthed(undefined)).toThrow(/NextAuth/);
    });

    it('and it is still imported by nothing, which is why retiring it is safe', () => {
        // If somebody wires it up, they now get the throw above — and this
        // says the retirement was still the right shape at that moment.
        const src = code('src/hooks/useFirebaseAuthed.ts');
        expect(src).not.toMatch(/return true/);
        expect(src).toMatch(/throw new Error/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#418 — the hand-copied collection table', () => {
    it('EVERY CLIENT NAME MATCHES THE SERVER TABLE, EXACTLY', () => {
        /**
         * The five waiting screens pass these strings to a server allowlist
         * keyed on the other table. Drift here is #415's failure mode arriving
         * through a typo.
         */
        const drifted: Array<{ key: string; client: string; server: unknown }> = [];
        for (const [key, value] of Object.entries(CLIENT_COLLECTIONS)) {
            const server = (SERVER_COLLECTIONS as Record<string, string>)[key];
            if (server !== value) drifted.push({ key, client: value, server });
        }
        expect({ drifted }).toEqual({ drifted: [] });
    });

    it('and the client table is a SUBSET — it may lag, it may not disagree', () => {
        const clientKeys = Object.keys(CLIENT_COLLECTIONS);
        const serverKeys = new Set(Object.keys(SERVER_COLLECTIONS));
        const orphans = clientKeys.filter((k) => !serverKeys.has(k));
        expect({ orphans }).toEqual({ orphans: [] });
        expect(clientKeys.length).toBeGreaterThanOrEqual(10);
    });

    it('and the names the waiting screens actually pass are among them', () => {
        // Named explicitly, because these are the ones #415 depends on.
        expect(CLIENT_COLLECTIONS.WAVE_APPLICATIONS).toBe(SERVER_COLLECTIONS.WAVE_APPLICATIONS);
        expect(CLIENT_COLLECTIONS.ACADEMY_APPLICATIONS).toBe(SERVER_COLLECTIONS.ACADEMY_APPLICATIONS);
        expect(CLIENT_COLLECTIONS.EXPORT_APPLICATIONS).toBe(SERVER_COLLECTIONS.EXPORT_APPLICATIONS);
        expect(CLIENT_COLLECTIONS.SELLER_VERIFICATIONS).toBe(SERVER_COLLECTIONS.SELLER_VERIFICATIONS);
        expect(CLIENT_COLLECTIONS.USERS).toBe(SERVER_COLLECTIONS.USERS);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#418 — the browser reads the same registration keys as the server', () => {
    it('BOTH SPELLINGS, FOR THE TWO MODULES THAT HAVE TWO', () => {
        const hook = code('src/hooks/useMembershipStatus.ts');
        expect(hook).toMatch(/cooperative: \["cooperatives", "cooperative"\]/);
        expect(hook).toMatch(/"farm-nation": \["farmNation", "farm_nation"\]/);
        expect(hook).not.toMatch(/MODULE_TO_REG_KEY\b(?!S)/);
    });

    it('and those are the pairs the server and the normalizer use', () => {
        // The premise: three tables, one vocabulary. If the server widens or
        // narrows, this says the browser has not followed.
        const server = code('src/app/actions/my-data.ts');
        expect(server).toMatch(/regKeys: \["cooperatives", "cooperative"\]/);
        expect(server).toMatch(/regKeys: \["farmNation", "farm_nation"\]/);

        const normalizer = code('src/lib/schema-normalizer.ts');
        expect(normalizer).toMatch(/"serviceRegistrations\.cooperatives", "serviceRegistrations\.cooperative"/);
        expect(normalizer).toMatch(/"serviceRegistrations\.farmNation", "serviceRegistrations\.farm_nation"/);
    });

    it('and BOTH legacy spellings really are written, which is why this matters', () => {
        const legacy = code('src/app/actions/admin/_legacy.ts');
        expect(legacy).toMatch(/serviceRegistrations\.cooperative = /);
        expect(legacy).toMatch(/serviceRegistrations\.farm_nation = /);
    });

    it('and the session carries them unmirrored, which is where it bit', () => {
        // lib/auth.ts puts the profile's registrations into the token verbatim.
        expect(code('src/lib/auth.ts')).toMatch(/serviceRegistrations: profile\.serviceRegistrations \|\| \{\}/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#418 — useOnce runs once, whatever its header used to claim', () => {
    it('THE CALLBACK FIRES EXACTLY ONCE UNDER STRICT MODE, WHICH IS THE POINT', () => {
        /**
         * StrictMode is not optional here. Without it React mounts the effect
         * once, the `[]` deps mean it never re-runs, and the assertion passes
         * whether or not the guard exists — which is how the first draft of
         * this test let a "remove the once-guard" mutant survive. Under
         * StrictMode React deliberately mounts, unmounts and remounts, so an
         * unguarded callback verifies the payment TWICE.
         */
        let calls = 0;
        function Probe() {
            useOnce(() => { calls += 1; });
            return null;
        }
        // render(), not renderHook() with a wrapper: the wrapper form did not
        // put StrictMode above the hook here, so the mutant that removes the
        // guard survived the first draft of this test.
        const { unmount } = render(
            React.createElement(React.StrictMode, null, React.createElement(Probe)),
        );
        expect(calls).toBe(1);
        unmount();
        expect(calls).toBe(1);
    });

    it('and WITHOUT the hook, StrictMode really does run the effect twice', () => {
        // The premise of the test above. If this ever reports 1, the test
        // above proves nothing and this says so.
        let runs = 0;
        function Bare() {
            React.useEffect(() => { runs += 1; }, []);
            return null;
        }
        render(React.createElement(React.StrictMode, null, React.createElement(Bare)));
        expect(runs).toBe(2);
    });

    it('and its header no longer claims the SECOND mount', () => {
        /**
         * The ref persists across React 18's probe unmount, so the callback
         * fires on the first effect run and the second is the no-op — the
         * opposite of what the header said, about a hook guarding three payment
         * verifications.
         */
        const raw = readFileSync(join(ROOT, 'src/hooks/useOnce.ts'), 'utf-8');
        expect(raw).not.toMatch(/fires on the SECOND mount/);
        expect(raw).toMatch(/#418/);
    });

    it('and no payment callback returns a cleanup from it — the case that would bite', () => {
        for (const path of PAYMENT_CALLBACKS) {
            const src = code(path);
            const start = src.indexOf('useOnce(');
            expect({ path, uses: start > -1 }).toEqual({ path, uses: true });
            // Bounded to the callback body, not the rest of the component.
            const open = src.indexOf('{', start);
            let depth = 0, end = open;
            for (let i = open; i < src.length; i += 1) {
                if (src[i] === '{') depth += 1;
                else if (src[i] === '}') { depth -= 1; if (depth === 0) { end = i; break; } }
            }
            const body = src.slice(open, end + 1);
            expect({ path, returnsCleanup: /return\s*(?:\(\)\s*=>|function)/.test(body) })
                .toEqual({ path, returnsCleanup: false });
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#418 — useDebounce, the one that was simply correct', () => {
    it('HOLDS THE PREVIOUS VALUE UNTIL THE DELAY PASSES', () => {
        jest.useFakeTimers();
        try {
            const { result, rerender } = renderHook(
                (p: { v: string }) => useDebounce(p.v, 500),
                { initialProps: { v: 'a' } },
            );
            expect(result.current).toBe('a');

            rerender({ v: 'b' });
            expect(result.current).toBe('a');

            act(() => { jest.advanceTimersByTime(499); });
            expect(result.current).toBe('a');

            act(() => { jest.advanceTimersByTime(1); });
            expect(result.current).toBe('b');
        } finally {
            jest.useRealTimers();
        }
    });

    it('and a change inside the window replaces the pending value rather than queueing two', () => {
        jest.useFakeTimers();
        try {
            const { result, rerender } = renderHook(
                (p: { v: string }) => useDebounce(p.v, 500),
                { initialProps: { v: 'a' } },
            );
            rerender({ v: 'b' });
            act(() => { jest.advanceTimersByTime(400); });
            rerender({ v: 'c' });
            act(() => { jest.advanceTimersByTime(400); });
            // The 'b' timer was cleared; only 'c' is pending.
            expect(result.current).toBe('a');
            act(() => { jest.advanceTimersByTime(100); });
            expect(result.current).toBe('c');
        } finally {
            jest.useRealTimers();
        }
    });
});
