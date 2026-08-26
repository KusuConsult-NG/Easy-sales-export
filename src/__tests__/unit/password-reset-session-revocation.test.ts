/**
 * @jest-environment node
 */

/**
 * Resetting your password left the intruder signed in.
 *
 * Sessions on this platform are stateless NextAuth JWTs with an 8-hour maxAge.
 * There is no server-side session record to delete, so ending a session means
 * knowing when it was minted and refusing the ones that predate a revocation
 * point. Nothing did that:
 *
 *   changePasswordAction   writes `passwordChangedAt`. NOTHING READS IT — the
 *                          field is maintained and consulted nowhere.
 *   resetPasswordAction    did not even write that much.
 *
 * So somebody holding a stolen session cookie kept full access for up to eight
 * hours AFTER the victim did the one thing the platform tells people to do
 * about a compromised account. The reset changed the password, the attacker's
 * cookie was unaffected, and the victim was told they were secure.
 *
 * The machinery to fix it already existed. The jwt callback re-reads the
 * profile every two minutes and the session callback already nulls a session
 * outright when `token.isBanned` — the ban check is the same shape of problem
 * with the same answer. Revocation reuses both.
 *
 * SCOPE, AND WHY IT IS RESET AND NOT CHANGE
 * -----------------------------------------
 * Only resetPasswordAction stamps the revocation point. A reset is performed by
 * somebody who is NOT signed in, so revoking every session breaks no flow.
 *
 * changePasswordAction is called from two pages that stay signed in and carry
 * on — /auth/reset-legacy-password pushes to /dashboard, and /profile shows an
 * inline success. Revoking there would sign the user out of the flow they are
 * standing in, which is a UX change to two working paths rather than a defect
 * fix. Recorded for the owner instead; the property that matters most — a
 * locked-out or compromised user being able to evict everyone else — is the
 * reset one.
 *
 * FAILING OPEN IS THE POINT
 * -------------------------
 * A false positive here signs out every user on the platform. A false negative
 * leaves one stale session that still expires within maxAge. So a token with no
 * recorded issue time, or a profile with no revocation point, is left alone.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';

const RESET = 'src/app/actions/password-reset.ts';
const AUTH = 'src/lib/auth.ts';
const AUTH_CONFIG = 'src/lib/auth.config.ts';
const CHANGE = 'src/app/actions/auth.ts';

function source(rel: string): string {
    return readFileSync(join(process.cwd(), rel), 'utf-8');
}

function code(rel: string): string {
    return source(rel)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((l) => !l.trim().startsWith('//'))
        .map((l) => l.replace(/\s\/\/.*$/, ''))
        .join('\n');
}

/**
 * The predicate the jwt callback computes, lifted out so it can be exercised
 * rather than only read.
 *
 * Kept in step with lib/auth.ts by the assertions in "the rule the callback
 * actually runs" below — a copy that drifts from the original proves nothing,
 * which is why both the shape and the behaviour are pinned.
 */
function isRevoked(token: { authAt?: number; iat?: number }, profile: { sessionsValidFrom?: unknown }): boolean {
    const revokedBefore = Number(profile.sessionsValidFrom) || 0;
    const issuedAtMs = typeof token.authAt === 'number'
        ? token.authAt
        : (typeof token.iat === 'number' ? token.iat * 1000 : 0);
    return revokedBefore > 0 && issuedAtMs > 0 && issuedAtMs < revokedBefore;
}

describe('a session minted before the reset is refused', () => {
    const RESET_AT = 1_700_000_000_000;

    it('which is THE test', () => {
        expect(isRevoked({ authAt: RESET_AT - 60_000 }, { sessionsValidFrom: RESET_AT })).toBe(true);
    });

    it('and one minted after it is not', () => {
        expect(isRevoked({ authAt: RESET_AT + 1 }, { sessionsValidFrom: RESET_AT })).toBe(false);
    });

    it('a session minted at the exact instant is kept', () => {
        // Strictly-before, so the session created by signing in with the NEW
        // password at the same millisecond survives.
        expect(isRevoked({ authAt: RESET_AT }, { sessionsValidFrom: RESET_AT })).toBe(false);
    });

    it('falling back to the JWT\'s own iat, in seconds', () => {
        // This is what revokes sessions that were minted before `authAt`
        // existed — without it the fix would only protect sessions created
        // after deployment.
        expect(isRevoked({ iat: (RESET_AT - 60_000) / 1000 }, { sessionsValidFrom: RESET_AT })).toBe(true);
        expect(isRevoked({ iat: (RESET_AT + 60_000) / 1000 }, { sessionsValidFrom: RESET_AT })).toBe(false);
    });

    it('and authAt winning over iat when both are present', () => {
        expect(isRevoked({ authAt: RESET_AT + 1, iat: (RESET_AT - 60_000) / 1000 }, { sessionsValidFrom: RESET_AT }))
            .toBe(false);
    });
});

describe('it fails OPEN, because the cost of the two mistakes is not symmetric', () => {
    it('a profile with no revocation point revokes nobody', () => {
        // THE guard against signing out the entire platform.
        expect(isRevoked({ authAt: 1 }, {})).toBe(false);
        expect(isRevoked({ authAt: 1 }, { sessionsValidFrom: undefined })).toBe(false);
        expect(isRevoked({ authAt: 1 }, { sessionsValidFrom: null })).toBe(false);
        expect(isRevoked({ authAt: 1 }, { sessionsValidFrom: 0 })).toBe(false);
    });

    it('and a non-numeric revocation point is treated as absent, not as zero-or-now', () => {
        // A serverTimestamp sentinel or an ISO string would be NaN through
        // Number(); it must not become a revoke-everything.
        expect(isRevoked({ authAt: 1 }, { sessionsValidFrom: 'not-a-number' })).toBe(false);
        expect(isRevoked({ authAt: 1 }, { sessionsValidFrom: {} })).toBe(false);
    });

    it('and a token with no recorded issue time is left alone', () => {
        expect(isRevoked({}, { sessionsValidFrom: 1_700_000_000_000 })).toBe(false);
        expect(isRevoked({ authAt: undefined, iat: undefined }, { sessionsValidFrom: 1_700_000_000_000 })).toBe(false);
    });
});

describe('the rule the callback actually runs', () => {
    const auth = code(AUTH);

    it('is the one exercised above', () => {
        // Pins the copy to the original. If lib/auth.ts changes shape, this
        // fails and the harness above has to be brought back into step.
        expect(auth).toContain('const revokedBefore = Number((cachedProfile as any).sessionsValidFrom) || 0;');
        expect(auth).toContain('typeof token.authAt === "number"');
        expect(auth).toContain('(typeof token.iat === "number" ? token.iat * 1000 : 0)');
        expect(auth).toContain('token.sessionRevoked = revokedBefore > 0 && issuedAtMs > 0 && issuedAtMs < revokedBefore;');
    });

    it('and a revoked session is nulled the same way a banned one is', () => {
        expect(auth).toContain('if (token.isBanned || token.sessionRevoked) {');
        expect(auth).toContain('session.user = null as any;');
    });

    it('inside the sync block that already re-reads the profile', () => {
        // Vacuity guard: the check is worthless if it runs against a token
        // field nobody refreshes. It sits with the roles/ban sync.
        const sync = auth.slice(auth.indexOf('const SYNC_INTERVAL'), auth.indexOf('if (user) {'));

        expect(sync).toContain('token.sessionRevoked =');
        expect(sync).toContain('token.isBanned =');
    });

    it('and every session records when it was authenticated', () => {
        // Without this stamp the predicate has nothing to compare.
        const cfg = code(AUTH_CONFIG);

        // ONCE, and in the sign-in branch. Mutation testing caught the loose
        // version of this: moving the stamp out of `if (user)` so it re-runs on
        // every request makes a stolen session immortal — it would keep
        // re-dating itself past any revocation point — and a slice-based
        // assertion still passed. Adjacency to a line that can only be in the
        // sign-in branch is what pins it.
        const stamps = cfg.match(/token\.authAt = Date\.now\(\);/g) ?? [];
        expect(stamps).toHaveLength(1);
        expect(cfg).toMatch(/token\.authAt = Date\.now\(\);\s*\n\s*token\.id = user\.id;/);
    });
});

describe('the reset stamps the revocation point', () => {
    const reset = code(RESET);

    it('on the profile document a session token identifies itself by', () => {
        // THE other half. token.id is the PROFILE doc id, which is not
        // necessarily targetUserId — that may be the Supabase Auth id.
        expect(reset).toContain('let profileDocId: string | null = null;');
        expect(reset).toContain('profileDocId = profile.id;');
        expect(reset).toContain('await db.collection(COLLECTIONS.USERS).doc(profileDocId).update({');
        expect(reset).toContain('sessionsValidFrom: Date.now(),');
    });

    it('after the password has actually changed', () => {
        // Revoking before the password write would sign everyone out on a reset
        // that then failed.
        const stampAt = reset.indexOf('sessionsValidFrom: Date.now(),');
        const passwordAt = reset.indexOf('supabaseAdmin.auth.admin.updateUserById(');

        expect(passwordAt).toBeGreaterThan(-1);
        expect(stampAt).toBeGreaterThan(passwordAt);
    });

    it('without failing the reset if the stamp cannot be written', () => {
        // The password IS changed by that line. Reporting failure would tell
        // somebody their reset did not work when it did.
        expect(reset).toContain("logger.error('[reset] password changed but existing sessions were NOT revoked'");
        expect(reset).toContain("logger.error('[reset] password changed but no profile found to revoke sessions on'");
    });

    it('and records the change time the platform already had a field for', () => {
        expect(reset).toContain('passwordChangedAt: FieldValue.serverTimestamp(),');
    });
});

describe('changePasswordAction revokes the OTHER sessions', () => {
    /**
     *   #306 THIS SUITE PINNED MY OWN WRONG REASONING, AND THE TEST BELOW WAS
     *        NAMED AFTER IT.
     *
     *        It asserted `sessionsValidFrom = session.user.authAt`, and one of
     *        its cases carried the argument in a comment:
     *
     *          "Deliberate: a session minted after this one could only have been
     *           created with a password, and after this call that is the new one."
     *
     *        That is a contradiction. A session minted after yours but BEFORE
     *        this call was created with the OLD password — the new one does not
     *        exist until the call finishes. And the case it let through is the
     *        ordinary one: you sign in Monday, somebody who learned your password
     *        signs in Tuesday, you notice Wednesday and change it from your
     *        Monday session. revokeBefore is Monday, theirs is Tuesday, and they
     *        stay signed in.
     *
     *        The last test here was the tell — "and its two callers still stay
     *        signed in, which is why Date.now() was wrong". Keeping the caller
     *        signed in was treated as the requirement, and correctness bent
     *        around it. It is the other way round: the caller being signed out
     *        is the price, and both callers now say so.
     *
     *        Reversed rather than deleted, because "the intruder is revoked"
     *        needs pinning at least as firmly as the old claim did.
     */
    const change = code(CHANGE);
    const fn = change.slice(change.indexOf('export async function changePasswordAction'));

    it('stamping NOW rather than this session\'s issue time — THE test', () => {
        expect(fn).toContain('const revokeBefore = Date.now();');
        expect(fn).toContain('sessionsValidFrom: revokeBefore,');
        // The value that let a newer intruder session survive.
        expect(fn).not.toContain('const revokeBefore = session.user.authAt;');
    });

    it('WHICH DROPS A SESSION MINTED AFTER THIS ONE — the case that was missed', () => {
        // Exercised against the same predicate the callback runs.
        const myLogin = 1_700_000_500_000;
        const intruderLogin = myLogin + 60_000;   // signed in after me, before I noticed
        const stampedNow = intruderLogin + 60_000;

        expect(isRevoked({ authAt: intruderLogin }, { sessionsValidFrom: stampedNow })).toBe(true);
        expect(isRevoked({ authAt: myLogin }, { sessionsValidFrom: stampedNow })).toBe(true);

        // And the old behaviour, kept as the contrast: stamping my own issue
        // time left the intruder alone.
        expect(isRevoked({ authAt: intruderLogin }, { sessionsValidFrom: myLogin })).toBe(false);
    });

    it('no longer depends on this session recording an issue time', () => {
        // It used to skip the revocation entirely when authAt was absent —
        // "fails open" — so a session with no issue time revoked nothing.
        expect(fn).not.toContain('if (typeof revokeBefore !== "number" || !(revokeBefore > 0)) {');
    });

    it('and a failed revocation is reported to the caller, not just logged', () => {
        // The old catch named only the lesser consequence — "the forced-change
        // flag was not cleared" — while the caller was told plainly it worked.
        expect(fn).toContain('sessionsRevoked = false;');
        expect(fn).toContain('OTHER SESSIONS WERE NOT REVOKED');
        expect(fn).toContain('return { success: true as const, error: null, sessionsRevoked };');
    });

    it('and still keeps the fields it already wrote', () => {
        expect(fn).toContain('requiresPasswordChange: FieldValue.delete(),');
        expect(fn).toContain('passwordChangedAt: FieldValue.serverTimestamp(),');
    });

    it('the issue time is still surfaced on the session, for the predicate to read', () => {
        // Vacuity guard: the comparison the jwt callback makes needs authAt on
        // each token even though the STAMP no longer comes from it.
        const cfg = code(AUTH_CONFIG);
        expect(cfg).toContain('session.user.authAt = typeof token.authAt === "number"');
        expect(cfg).toContain('(typeof token.iat === "number" ? token.iat * 1000 : undefined)');
    });

    it('AND BOTH CALLERS TELL THE USER THEY ARE SIGNED OUT', () => {
        // This asserted the opposite — that they stayed signed in — and used it
        // as the reason the safe value was "wrong".
        const legacy = source('src/app/auth/reset-legacy-password/page.tsx');
        const profile = source('src/app/profile/page.tsx');

        expect(legacy).toContain('sign in again');
        expect(legacy).toContain('/auth/login');
        expect(profile).toContain('signed out on all devices');

        // And both read the new flag rather than assuming it happened.
        expect(legacy).toContain('result.sessionsRevoked');
        expect(profile).toContain('res.sessionsRevoked');
    });

    it('revocation lands within the sync interval, not instantly', () => {
        // The same latency the ban check has, for the same reason: the profile
        // is only re-read there. Said plainly so nobody reads this as immediate.
        expect(code(AUTH)).toContain('const SYNC_INTERVAL = 2 * 60 * 1000;');
    });
});
