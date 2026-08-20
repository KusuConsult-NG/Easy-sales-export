/**
 * The "Anti-Corruption" guard that could not fire.
 *
 * validateUserState in lib/services/userService.ts is documented as guaranteeing
 * "the Anti-Corruption rules across the Firebase database", and its seller rule
 * reads:
 *
 *     Cannot assign 'seller' role without 'approved' verification status.
 *
 * The condition behind that message was:
 *
 *     roles.includes("seller")
 *       && user.sellerVerificationStatus !== "approved"
 *       && user.isVerified !== true            <-- this clause
 *
 * WEAKER THAN IT SAID
 * -------------------
 * Registration writes `isVerified: true` on every account it creates (see the
 * userProfile literal in actions/auth.ts). So `user.isVerified !== true` was false
 * for essentially every real user, and the guard never fired at all.
 *
 * BROADER THAN IT SAID
 * --------------------
 * It ran on the MERGED document, so it judged every update to an existing seller
 * rather than the assignment its message describes. That is why the escape hatch
 * was load-bearing: removing it alone would have started throwing on ordinary
 * admin edits to any seller whose status is not "approved" — breaking admin
 * tooling in order to enforce a rule about something that happened in the past.
 *
 * The rule now fires on the TRANSITION: the role is added by this update and the
 * verification is not approved.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const USER_ID = 'user-1';

/**
 * Drives atomicUpdateUser against a mocked transaction, so the guard is exercised
 * rather than pattern-matched. Source scanning would not distinguish "fires on the
 * transition" from "fires on every update".
 */
function load(currentData: Record<string, any>) {
    jest.resetModules();

    const update = jest.fn((_patch: any) => ({}));

    jest.doMock('@/lib/supabase-db', () => ({
        getAdminDb: () => ({
            collection: () => ({
                doc: () => ({ id: USER_ID }),
            }),
            runTransaction: async (fn: any) => fn({
                get: async () => ({ exists: true, data: () => currentData }),
                update,
            }),
        }),
        supabaseDb: {},
    }));

    // `@/lib/user-cache`, NOT `@/lib/cache-invalidation` — userService imports the
    // former. Mocking the wrong one left the real module in the graph, which pulls
    // in @upstash/redis, which is ESM and untransformed: every test failed with
    // "Unexpected token 'export'" rather than with anything about the guard.
    jest.doMock('@/lib/user-cache', () => ({
        invalidateUserCache: jest.fn(async () => ({})),
    }));

    jest.doMock('@/lib/schema-normalizer', () => ({
        normalizeUserUpdate: (u: any) => u,
    }));

    return { update };
}

async function updateUser(updates: Record<string, any>) {
    const mod = await import('@/lib/services/userService');
    return mod.atomicUpdateUser(USER_ID, updates);
}

describe('assigning the seller role', () => {
    beforeEach(() => {
        jest.resetModules();
    });

    it('is refused when the verification is not approved', async () => {
        // THE test. Under the old condition this passed silently, because the
        // fixture — like every registered account — has isVerified: true.
        load({ roles: ['buyer'], isVerified: true, sellerVerificationStatus: 'pending' });

        await expect(updateUser({ roles: ['buyer', 'seller'] })).rejects.toThrow(
            /Cannot assign 'seller' role without 'approved' verification status/,
        );
    });

    it('is refused even for an account marked isVerified', async () => {
        // The clause that made the rule unreachable. isVerified is set by
        // registration for everyone; it is not a seller approval.
        load({ roles: [], isVerified: true, sellerVerificationStatus: 'rejected' });

        await expect(updateUser({ roles: ['seller'] })).rejects.toThrow(/Data Integrity Error/);
    });

    it('is allowed when the verification IS approved', async () => {
        // Vacuity guard: if the rule refused everything, the tests above would pass
        // while the platform could not onboard a seller at all.
        load({ roles: ['buyer'], isVerified: true, sellerVerificationStatus: 'approved' });

        await expect(updateUser({ roles: ['buyer', 'seller'] })).resolves.toMatchObject({
            roles: ['buyer', 'seller'],
        });
    });

    it('is allowed when the same update also sets the approval', async () => {
        // The realistic onboarding write: role and status land together.
        load({ roles: [], isVerified: true, sellerVerificationStatus: 'pending' });

        await expect(updateUser({
            roles: ['seller'],
            sellerVerificationStatus: 'approved',
        })).resolves.toBeDefined();
    });
});

describe('updating a seller who already has the role', () => {
    beforeEach(() => {
        jest.resetModules();
    });

    it('is NOT refused, even when the status is not approved', async () => {
        // The reason the escape hatch existed. Judging the merged document meant
        // every ordinary admin edit to such a record would throw — which would make
        // the record unfixable, since repairing it requires writing to it.
        load({ roles: ['seller'], isVerified: true, sellerVerificationStatus: 'pending' });

        await expect(updateUser({ phone: '08000000000' })).resolves.toBeDefined();
    });

    it('and repairing the status on such a record still works', async () => {
        load({ roles: ['seller'], isVerified: false, sellerVerificationStatus: 'suspended' });

        await expect(updateUser({ sellerVerificationStatus: 'approved' })).resolves.toBeDefined();
    });
});

describe('roles arriving as an arrayUnion sentinel', () => {
    beforeEach(() => {
        jest.resetModules();
    });

    it('are not treated as an assignment', async () => {
        // FieldValue.arrayUnion is an object, not an array — the original code
        // already guarded for this. A sentinel cannot be inspected, so the rule
        // cannot claim the role is being added, and must not throw on a write it
        // cannot read.
        load({ roles: ['buyer'], isVerified: true, sellerVerificationStatus: 'pending' });

        await expect(updateUser({
            roles: { _methodName: 'FieldValue.arrayUnion', _elements: ['seller'] },
        })).resolves.toBeDefined();
    });
});

describe('the other rules are unchanged', () => {
    beforeEach(() => {
        jest.resetModules();
    });

    it('still blocks writes to protected financial fields', async () => {
        load({ roles: ['buyer'], isVerified: true });

        await expect(updateUser({ walletBalance: 999999 })).rejects.toThrow(
            /Cannot arbitrarily modify protected field/,
        );
    });

    it('still refuses to update a user that does not exist', async () => {
        jest.resetModules();
        jest.doMock('@/lib/supabase-db', () => ({
            getAdminDb: () => ({
                collection: () => ({ doc: () => ({ id: USER_ID }) }),
                runTransaction: async (fn: any) => fn({
                    get: async () => ({ exists: false, data: () => undefined }),
                    update: jest.fn(),
                }),
            }),
            supabaseDb: {},
        }));
        jest.doMock('@/lib/user-cache', () => ({ invalidateUserCache: jest.fn(async () => ({})) }));
        jest.doMock('@/lib/schema-normalizer', () => ({ normalizeUserUpdate: (u: any) => u }));

        await expect(updateUser({ phone: '080' })).rejects.toThrow(/not found in database/);
    });
});
