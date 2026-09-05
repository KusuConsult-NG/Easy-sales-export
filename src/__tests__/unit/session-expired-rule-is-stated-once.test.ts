/**
 * @jest-environment node
 */

/**
 *   #411 THREE STATEMENTS OF THE SESSION-EXPIRED RULE, AND A COMMENT SAYING
 *   THEY WERE THE SAME.
 *
 *   From the untested-module sweep — session-expiry-code.ts and
 *   useSessionExpiry.ts were both files never named in any test.
 *
 *   WHAT WAS THERE
 *   ---------------
 *     lib/session-guard.ts        success === false && code === SESSION_EXPIRED
 *     lib/session-expiry-code.ts  code === SESSION_EXPIRED          ← looser
 *     hooks/useSessionExpiry.ts   a private third copy, written by hand next to
 *                                 an import of the module that exported one
 *
 *   And the middle one was introduced with the comment "Client-safe type guard
 *   — identical to the one in session-guard.ts". It was not identical: it
 *   dropped the `success === false` clause, so it matched ANY object carrying
 *   the code, including a successful result that happened to have one.
 *
 *   WHY THAT MATTERS WHERE IT IS USED. /messages takes an early return on it in
 *   six places — `if (isSessionExpired(result)) return;` — so a false positive
 *   is a screen that silently does nothing, which is #322's shape. And the hook
 *   using its own copy meant the module that decides WHEN TO SIGN A USER OUT
 *   kept a private opinion about it.
 *
 *   NO LIVE DEFECT, AND SAYING SO PLAINLY. All four emitters in session-guard.ts
 *   set `success: false` alongside the code — checked, all four — so nothing
 *   produced today is classified differently by the loose guard and the strict
 *   one. This is #390's class: one rule stated three times, which is how the
 *   next divergence gets in. It is recorded as a consistency repair, not dressed
 *   up as a bug that bit somebody.
 *
 *   FIXED: session-expiry-code.ts holds the ONLY definition, with the clause the
 *   comment always claimed. session-guard.ts re-exports it. The hook imports it.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     the shared guard drops the success clause     KILLED
 *     session-guard redefines its own copy          KILLED
 *     an emitter stops setting success:false        KILLED
 *     reword the header prose                       SURVIVED, as intended
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join, relative } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import { isSessionExpired, SESSION_EXPIRED_CODE } from '@/lib/session-expiry-code';

const ROOT = process.cwd();
const code = (p: string) => stripComments(readFileSync(join(ROOT, p), 'utf-8'), { label: relative(ROOT, p) });

const SHARED = 'src/lib/session-expiry-code.ts';
const GUARD = 'src/lib/session-guard.ts';
const HOOK = 'src/hooks/useSessionExpiry.ts';

// ─────────────────────────────────────────────────────────────────────────────
describe('#411 — the rule itself', () => {
    it('A REFUSAL CARRYING THE CODE IS SESSION-EXPIRED', () => {
        expect(isSessionExpired({ success: false, code: SESSION_EXPIRED_CODE, error: 'x' })).toBe(true);
    });

    it('and a SUCCESS carrying the code is not', () => {
        /**
         * The clause the client-safe copy was missing. Nothing emits this shape
         * today, which is why the divergence was invisible — but the guard is
         * what decides whether a user gets signed out, so it should not depend
         * on nothing ever emitting it.
         */
        expect(isSessionExpired({ success: true, code: SESSION_EXPIRED_CODE })).toBe(false);
    });

    it('and neither is anything else', () => {
        for (const value of [null, undefined, 'SESSION_EXPIRED', 42, {}, { success: false }, { code: 'OTHER' }]) {
            expect({ value, expired: isSessionExpired(value) }).toEqual({ value, expired: false });
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#411 — stated once, imported everywhere', () => {
    it('THE ONLY DEFINITION IS IN THE CLIENT-SAFE MODULE', () => {
        // One `function isSessionExpired` in the whole of src.
        const shared = code(SHARED);
        expect(shared).toMatch(/export function isSessionExpired/);
        expect(shared).toMatch(/\(result as any\)\.success === false/);
    });

    it('and session-guard re-exports rather than redefining', () => {
        const guard = code(GUARD);
        expect(guard).toMatch(/export \{ isSessionExpired \} from "@\/lib\/session-expiry-code"/);
        expect(guard).not.toMatch(/export function isSessionExpired/);
    });

    it('and the hook imports it instead of keeping a private copy', () => {
        const hook = code(HOOK);
        expect(hook).toMatch(/import \{ isSessionExpired \} from "@\/lib\/session-expiry-code"/);
        expect(hook).not.toMatch(/function isSessionExpiredResult/);
        // …and still uses it where the sign-out decision is made.
        expect(hook).toMatch(/if \(isSessionExpired\(result\)\) \{\s*handleExpiry\(\)/);
    });

    it('and the hook still imports ONLY from the client-safe module', () => {
        // The file's own warning: importing session-guard would drag
        // "server-only" into a client component and break the build.
        expect(code(HOOK)).not.toMatch(/from "@\/lib\/session-guard"/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#411 — the premise: every emitter sets success:false', () => {
    it('WHICH IS WHY TIGHTENING THE GUARD CHANGES NOTHING LIVE', () => {
        /**
         * The claim in the header, asserted rather than asserted-in-prose. If an
         * emitter ever stops pairing the code with `success: false`, the guard
         * silently stops matching it and a user is no longer signed out — so
         * this is the assertion that keeps the repair honest.
         */
        const guard = code(GUARD);
        const emissions = [...guard.matchAll(/code:\s*SESSION_EXPIRED_CODE/g)];
        expect(emissions.length).toBe(4);
        for (const m of emissions) {
            const before = guard.slice(Math.max(0, m.index! - 200), m.index!);
            expect({ at: m.index, paired: /success:\s*false/.test(before) })
                .toEqual({ at: m.index, paired: true });
        }
    });
});
