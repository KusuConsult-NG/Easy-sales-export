/**
 * @jest-environment node
 */

/**
 *   #449 A BROKEN POINTER TOLD A REAL USER THEY DO NOT EXIST, AND A CIRCULAR
 *   ONE MADE THEIR LOGIN NEVER ANSWER AT ALL.
 *
 *   A legacy profile is linked to its Supabase account by `_migratedTo`, written
 *   by lib/user-migration.ts. SIX places follow that pointer, and they did not
 *   agree on how far:
 *
 *     lib/user-cache.ts            RECURSED — no cycle guard, no limit
 *     lib/session-guard.ts         one hop
 *     infrastructure/payments      one hop, then `supabaseAuthId`
 *     api/webhooks/paystack        one hop, then `supabaseAuthId`
 *     api/cron/reconcile-paystack  one hop, then `supabaseAuthId`
 *     lib/auth.ts                  its own order (login-profile-resolution)
 *
 *   ALL THREE FAILURES WERE MEASURED AGAINST THE REAL getUserProfile BEFORE
 *   ANYTHING WAS CHANGED. Not reasoned about — run.
 *
 *   1. A CYCLE DID NOT CRASH. IT HUNG.
 *
 *      Two rows pointing at each other made getUserProfile call itself forever.
 *      It is not a stack overflow — every hop `await`s, so it yields to the
 *      microtask queue and simply spins. The probe did not fail: it never
 *      returned, ran past a ten-minute timeout, and had to be killed. In
 *      production that is a login request that never answers, holding a
 *      function until the platform times it out. A test that hangs is easy to
 *      mistake for a slow test, which is part of why this survived.
 *
 *   2. A DANGLING POINTER REFUSED THE LOGIN.
 *
 *      Measured: `DANGLING OUTCOME: NULL`. `_migratedTo` naming a row that is
 *      not there returned null, and lib/auth.ts turns null into
 *      `throw new Error("User profile not found in database")`.
 *
 *      The user HAS a profile — the one they started from. They were told they
 *      do not exist because a POINTER broke. And the pointer write is
 *      non-fatal: user-migration.ts flags the legacy row with
 *      `.catch(e => logger.warn(...))`, so a half-finished migration is a state
 *      the system deliberately tolerates. Refusing the login is the worst
 *      available reading of it: the moment a migration half-completes is
 *      exactly when somebody most needs to get in.
 *
 *   3. A TWO-HOP CHAIN SPLIT THE PLATFORM IN TWO.
 *
 *      Measured: with A → B → C, getUserProfile returned `id C` while every
 *      one-hop reader stopped at B. The session said one account and the
 *      contribution handler credited another.
 *
 *   ONE RULE NOW, IN lib/user-identity.ts, AND IT ALWAYS RETURNS A ROW THAT
 *   EXISTS. The walk keeps the last row it actually read, so a broken chain
 *   degrades to the newest good profile rather than to nothing.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     the cycle guard removed                        KILLED (by timeout)
 *     a dangling pointer resolves to null again      KILLED
 *     the walk stops after one hop                   KILLED
 *     supabaseAuthId dropped from the order          KILLED
 *     reword the header prose                        SURVIVED, as intended
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import {
    resolveActiveUser,
    resolveActiveUserId,
    activeIdFromRow,
    MAX_MIGRATION_HOPS,
} from '@/lib/user-identity';

const ROWS: Record<string, Record<string, unknown>> = {};

jest.mock('@/lib/redis', () => ({
    getCached: async () => null,
    setCache: async () => undefined,
    deleteCache: async () => undefined,
    CacheKeys: { userProfile: (id: string) => `u:${id}` },
    CACHE_TTL: { USER_PROFILE: 60 },
}));
// Supabase misses, so the read falls through to the Firestore-compat path —
// the branch that carried the recursion.
jest.mock('@/lib/supabase', () => ({
    supabaseAdmin: {
        from: () => ({ select: () => ({ eq: () => ({
            single: async () => ({ data: null, error: { message: 'not found' } }),
        }) }) }),
    },
}));
jest.mock('@/lib/firebase-admin', () => ({
    getAdminDb: () => ({
        collection: () => ({
            doc: (id: string) => ({
                get: async () => ({ exists: id in ROWS, data: () => ROWS[id] }),
            }),
        }),
    }),
}));

import { getUserProfile } from '@/lib/user-cache';

/** The fake users collection, in the shape resolveActiveUserId expects. */
const COLLECTION = {
    doc: (id: string) => ({
        get: async () => ({ exists: id in ROWS, data: () => ROWS[id] }),
    }),
};

function seed(rows: Record<string, Record<string, unknown>>) {
    for (const k of Object.keys(ROWS)) delete ROWS[k];
    Object.assign(ROWS, rows);
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#449 — the three ways the pointer broke a login', () => {
    beforeEach(() => seed({}));

    it('A CYCLE RETURNS INSTEAD OF SPINNING FOREVER', async () => {
        // The case that hung. The jest timeout is the assertion of last resort:
        // if the guard goes, this test does not fail fast, it stops responding.
        seed({
            A: { _migratedTo: 'B', fullName: 'Legacy Ada' },
            B: { _migratedTo: 'A', fullName: 'Newer Ada' },
        });

        const resolved = await resolveActiveUser('A', async (id) => ROWS[id] ?? null);

        expect(resolved.stoppedBecause).toBe('cycle');
        expect(resolved.healed).toBe(true);
        expect(['A', 'B']).toContain(resolved.id);
        expect(resolved.row).not.toBeNull();
    }, 10_000);

    it('AND THE REAL getUserProfile RETURNS ON THAT SAME CYCLE', async () => {
        // Through the actual function, not just the helper — the recursion was
        // in getUserProfile, and the helper existing is not proof it is used.
        seed({
            A: { _migratedTo: 'B', fullName: 'Legacy Ada' },
            B: { _migratedTo: 'A', fullName: 'Newer Ada' },
        });

        const profile = await getUserProfile('A');

        expect(profile).not.toBeNull();
        expect(profile!.displayName).toMatch(/Ada/);
    }, 10_000);

    it('A DANGLING POINTER KEEPS THE PROFILE IT STARTED FROM', async () => {
        // Was: null, which lib/auth.ts turns into "User profile not found in
        // database" and the user cannot sign in.
        seed({ A: { _migratedTo: 'GONE-FOREVER', fullName: 'Ada Complete', roles: ['seller'] } });

        const profile = await getUserProfile('A');

        expect(profile).not.toBeNull();
        expect(profile!.id).toBe('A');
        expect(profile!.displayName).toBe('Ada Complete');
        expect(profile!.roles).toEqual(['seller']);
    });

    it('and says so, rather than healing in silence', async () => {
        seed({ A: { _migratedTo: 'GONE-FOREVER', fullName: 'Ada' } });

        const resolved = await resolveActiveUser('A', async (id) => ROWS[id] ?? null);

        expect(resolved.stoppedBecause).toBe('dangling');
        expect(resolved.healed).toBe(true);
        expect(resolved.id).toBe('A');
    });

    it('A TWO-HOP CHAIN LANDS ON THE SAME ROW FOR EVERY READER', async () => {
        // The disagreement that sent the session to C and the money to B.
        seed({
            A: { _migratedTo: 'B', fullName: 'Oldest' },
            B: { _migratedTo: 'C', fullName: 'Middle' },
            C: { fullName: 'Ada Final', roles: ['seller'] },
        });

        const profile = await getUserProfile('A');            // login
        const payments = await resolveActiveUserId('A', COLLECTION);  // money

        expect(profile!.id).toBe('C');
        expect(payments.id).toBe('C');
        expect(profile!.id).toBe(payments.id);
    });

    it('and a chain longer than the limit stops rather than walking forever', async () => {
        const rows: Record<string, Record<string, unknown>> = {};
        for (let i = 0; i < MAX_MIGRATION_HOPS + 5; i += 1) {
            rows[`u${i}`] = { _migratedTo: `u${i + 1}`, fullName: `step ${i}` };
        }
        rows[`u${MAX_MIGRATION_HOPS + 5}`] = { fullName: 'end' };
        seed(rows);

        const resolved = await resolveActiveUser('u0', async (id) => ROWS[id] ?? null);

        expect(resolved.stoppedBecause).toBe('hop-limit');
        expect(resolved.hops).toBe(MAX_MIGRATION_HOPS);
        expect(resolved.row).not.toBeNull();
    }, 10_000);
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#449 — the order, stated once', () => {
    beforeEach(() => seed({}));

    it('FOLLOWS _migratedTo FIRST', () => {
        expect(activeIdFromRow('A', { _migratedTo: 'B', supabaseAuthId: 'C' })).toBe('B');
    });

    it('AND supabaseAuthId SECOND — the half four readers of six did not have', () => {
        // infrastructure/payments/service.ts spelled this out and lib/auth.ts
        // decides a login by it. session-guard and user-cache knew only the
        // first half.
        expect(activeIdFromRow('A', { supabaseAuthId: 'C' })).toBe('C');
    });

    it('and an active row pointing at ITSELF costs nothing', async () => {
        // user-migration writes supabaseAuthId onto the active row too, so the
        // second half must be a no-op there rather than a wasted read or a loop.
        seed({ LIVE: { supabaseAuthId: 'LIVE', fullName: 'Ada' } });

        const resolved = await resolveActiveUser('LIVE', async (id) => ROWS[id] ?? null);

        expect(resolved.id).toBe('LIVE');
        expect(resolved.hops).toBe(0);
        expect(resolved.healed).toBe(false);
    });

    it('and a row that is genuinely absent still resolves to nothing', async () => {
        // The ONE case that may return no row. Healing must not invent a user.
        const resolved = await resolveActiveUser('NOBODY', async (id) => ROWS[id] ?? null);

        expect(resolved.row).toBeNull();
        expect(resolved.id).toBe('NOBODY');
        expect(await getUserProfile('NOBODY')).toBeNull();
    });

    it('ignores a blank or non-string pointer instead of chasing it', () => {
        expect(activeIdFromRow('A', { _migratedTo: '   ' })).toBe('A');
        expect(activeIdFromRow('A', { _migratedTo: 42 })).toBe('A');
        expect(activeIdFromRow('A', {})).toBe('A');
        expect(activeIdFromRow('A', null)).toBe('A');
    });
});
