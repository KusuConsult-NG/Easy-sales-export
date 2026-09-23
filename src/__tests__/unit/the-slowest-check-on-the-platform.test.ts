/**
 *   THE OWNER: "fix the cooperative one next."
 *
 *   Their log, one session — and the slowest of the six by a clear margin:
 *
 *       checkCooperativeStatusAction took 1840ms
 *       checkCooperativeStatusAction took 2075ms
 *       checkCooperativeStatusAction took 1928ms
 *       checkCooperativeStatusAction took 1720ms
 *
 * ── MEASURED, NOT GUESSED ───────────────────────────────────────────────────
 *
 *   #261's read meter with a real per-request memoiser — React's cache() is a
 *   PASS-THROUGH under jest, so a suite that skips that step measures a
 *   platform with no request memoisation at all. A member with nothing filed:
 *
 *       checkCooperativeStatusAction    8 reads → 7
 *       a cooperatives page draw       14 reads → 10
 *
 *   FOURTEEN was the highest count this audit has measured anywhere, and
 *   THREE of them were the same user row: the module gate read it, the status
 *   action read it again, and the member lookup's identity walk read it a
 *   third time.
 *
 *   TWO CHANGES.
 *
 *   1. The action reads the row through the request memo, so the gate above
 *      it and the action share one read.
 *
 *   2. `findCooperativeMemberRowForPerson` takes the row when the caller
 *      already holds it. `ownedProfileIdsFor` is `liveProfileId` composed with
 *      `ownedProfileIds`, and its own header says the forward walk costs "ONE
 *      EXTRA KEYED READ ... a live id resolves to itself on the first hop" —
 *      that hop reads the row the caller is holding. The same change lets the
 *      action share the backward identity search with the gate, which was
 *      being paid TWICE because the two used different cache() entry points.
 *
 *   THE WALK IS KEPT FOR THE CALLERS THAT NEED IT. `membershipRefForPayment`
 *   and `cooperativeTierForPerson` are handed an id that may not be the
 *   caller's own — a membership id out of payment metadata, an admin looking
 *   at somebody else. They pass no row and resolve exactly as before.
 *
 * ── TEN AND NOT SEVEN, ON PURPOSE ───────────────────────────────────────────
 *
 *   Three duplicate reads remain on the page, and each needs the GATE's query
 *   to change shape rather than a memo:
 *
 *       cooperative_members:doc     the gate's `.doc(userId)` and the lookup's
 *       cooperative_members:query   `userId IN <owned>` vs `userId == <id>`
 *       cooperative_members:query   the two email queries
 *
 *   Only the first is an identical read, and a memo over it has to be dropped
 *   by the heal-writes in BOTH the gate and the action. That is the same care
 *   lib/current-user-doc needed, on a collection that decides module access,
 *   and it is worth its own change rather than a footnote to this one.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

jest.mock('react', () => {
    const actual: any = jest.requireActual('react');
    return {
        ...actual,
        cache: (fn: any) => {
            const memo = new Map<string, any>();
            return (...args: any[]) => {
                const key = JSON.stringify(args);
                if (!memo.has(key)) memo.set(key, fn(...args));
                return memo.get(key);
            };
        },
    };
});

jest.mock('@/lib/rate-limiter', () => ({
    rateLimit: () => ({ check: jest.fn(async () => ({ success: true, limit: 100, remaining: 99, reset: 0 })) }),
    getClientIp: jest.fn(() => '127.0.0.1'),
    createRateLimitResponse: jest.fn(),
}));

const UID = 'member-1';
const EMAIL = 'member@example.test';
const MEMBERS = COLLECTIONS.COOPERATIVE_MEMBERS;

/** Today's cost of the cooperatives screens a member actually waits on. */
const CEILING = { action: 7, page: 10 };

let store: FakeDbHandle;

const sessionAs = (id: string, email: string) => {
    (global as any).mockRequireSession = jest.fn(() => Promise.resolve({
        session: { user: { id, email, roles: ['general_user'] } },
        error: null,
    }));
};

beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    store = installFakeDb();
    store.seed(COLLECTIONS.USERS, UID, {
        uid: UID, email: EMAIL, roles: ['general_user'],
        isVerified: true, profileComplete: true, serviceRegistrations: {},
    });
    sessionAs(UID, EMAIL);
});

const coop = () => import('@/app/actions/cooperative/_coop_membership');
const ownRowReads = () =>
    store.reads.filter((r: any) => r.collection === COLLECTIONS.USERS && r.id === UID).length;

describe('what a cooperatives page draw costs a member with nothing filed', () => {
    it('DOES NOT GROW — seven reads is the action\'s ceiling, down from eight', async () => {
        const { checkCooperativeStatusAction } = await coop();
        store.reads.length = 0;

        const result = await checkCooperativeStatusAction();

        expect(store.reads.length).toBeLessThanOrEqual(CEILING.action);
        //   AND THE ANSWER IS UNCHANGED, which is what makes the saving free.
        expect(result).toBeNull();
    });

    it('reads the caller\'s own row ONCE inside the action, not twice', async () => {
        const { checkCooperativeStatusAction } = await coop();
        store.reads.length = 0;

        await checkCooperativeStatusAction();

        expect(ownRowReads()).toBe(1);
    });

    it('DOES NOT GROW — ten reads is the page\'s ceiling, down from fourteen', async () => {
        const { checkModuleAccess } = await import('@/lib/module-access-check');
        const { checkCooperativeStatusAction } = await coop();
        store.reads.length = 0;

        await checkModuleAccess(UID, ['general_user'] as never, 'cooperatives');
        await checkCooperativeStatusAction();

        expect(store.reads.length).toBeLessThanOrEqual(CEILING.page);
    });

    it('and the gate and the action share ONE read of that row, not three', async () => {
        const { checkModuleAccess } = await import('@/lib/module-access-check');
        const { checkCooperativeStatusAction } = await coop();
        store.reads.length = 0;

        await checkModuleAccess(UID, ['general_user'] as never, 'cooperatives');
        await checkCooperativeStatusAction();

        expect(ownRowReads()).toBe(1);
    });
});

describe('the identity walk is narrowed, not deleted', () => {
    it('STILL FINDS a membership filed under a superseded profile', async () => {
        //   #816's case: the row sits under a profile the member no longer
        //   signs in as, and #490 signs them in as the row that won.
        store.seed(COLLECTIONS.USERS, 'old-id', {
            uid: 'old-id', email: 'old@example.test', _migratedTo: UID, serviceRegistrations: {},
        });
        store.seed(MEMBERS, 'old-id', {
            userId: 'old-id', membershipStatus: 'active', onboardingCompleted: true,
            paymentStatus: 'completed',
        });
        const { checkCooperativeStatusAction } = await coop();

        const result = await checkCooperativeStatusAction();

        expect(result).toBe('active');
    });

    it('AND THE CALLERS THAT PASS NO ROW STILL WALK FORWARD', async () => {
        /*
         *   membershipRefForPayment and cooperativeTierForPerson are handed an
         *   id that may not be the caller's own. They omit the row, and must
         *   still resolve a SUPERSEDED id forward to the row that won — which
         *   the narrowed branch cannot do and is not asked to.
         */
        store.seed(COLLECTIONS.USERS, 'old-id', {
            uid: 'old-id', email: 'old@example.test', _migratedTo: UID, serviceRegistrations: {},
        });
        store.seed(MEMBERS, UID, { userId: UID, totalContributions: 50000 });

        const { findCooperativeMemberRowForPerson } = await import('@/lib/cooperative-member-lookup');

        //   Asked about the id that LOST, with no row in hand.
        const row = await findCooperativeMemberRowForPerson(
            (await import('@/lib/supabase-db')).supabaseDb.collection(MEMBERS), 'old-id');

        expect(row?.id).toBe(UID);
    });

    it('and a row that is MISSING is not mistaken for a live one', async () => {
        //   `isLiveUserRow(id, null)` is false, so a caller that passes null
        //   gets the walk — the conservative branch, not the cheap one.
        const { findCooperativeMemberRowForPerson } = await import('@/lib/cooperative-member-lookup');
        store.seed(COLLECTIONS.USERS, 'old-id', {
            uid: 'old-id', email: 'old@example.test', _migratedTo: UID, serviceRegistrations: {},
        });
        store.seed(MEMBERS, UID, { userId: UID });

        const row = await findCooperativeMemberRowForPerson(
            (await import('@/lib/supabase-db')).supabaseDb.collection(MEMBERS), 'old-id', null);

        expect(row?.id).toBe(UID);
    });
});
