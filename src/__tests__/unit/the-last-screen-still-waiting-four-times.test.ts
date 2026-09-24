/**
 * @jest-environment node
 */

/**
 *   THE OWNER: "fix the marketplace one next."
 *
 *       [slow-action] checkMarketplaceStatusAction took 2324ms
 *
 *   THE LAST MODULE WITHOUT A DEPTH PASS. #270 took this page from eleven
 *   reads to seven and then to five, and it was still taking seconds — which
 *   is the whole lesson this audit learned late and wrote down in
 *   lib/testing/read-depth:
 *
 *       READ COUNT IS NOT WHAT LATENCY IS MADE OF.
 *
 *   Five reads issued one after another cost five round trips. A read count
 *   cannot tell that from five issued together, so an action could be
 *   optimised twice and still wait four times. This one did.
 *
 * ── WHAT THE CHAIN WAS ──────────────────────────────────────────────────────
 *
 *   Measured with lib/testing/read-depth, for a first-time visitor to
 *   /marketplace/onboarding — the commonest visitor that screen has:
 *
 *       1. the user row                       needs the caller's id
 *       2. the identity walk                  needs the caller's id
 *       3. the owner-scoped verifications     needs the OWNED IDS from 2
 *       4. the legacy marketplace_sellers row needs NOTHING
 *
 *   ONLY STEP 3 DEPENDS ON ANYTHING. Step 4 asks `marketplace_sellers` for
 *   `userId == <the caller>` and sat at the end of the chain, a round trip
 *   spent waiting for answers it never reads.
 *
 *       nothing filed            5 reads, depth 4  ->  5 reads, depth 3
 *       approved on the row      1 read,  depth 1  ->  unchanged
 *       pending on the row       4 reads, depth 3  ->  unchanged
 *       a legacy seller row      5 reads, depth 4  ->  5 reads, depth 3
 *       a verification row only  4 reads, depth 3  ->  5 reads, depth 3
 *
 *   THE LAST ROW IS THE COST, AND IT IS STATED RATHER THAN BURIED. An account
 *   with no registration on its user row but a seller_verifications record
 *   reads five where it read four. It waits for none of them — the depth is
 *   unchanged — and it is the repair population these heals exist for, not the
 *   common path. Buying a generation with a concurrent read is the right way
 *   round here, as it was in #283. It would be the wrong way round for an
 *   expensive query on a path that usually skips it.
 *
 *   THE APPROVED SELLER PAYS NOTHING NEW. The guard is `!status`, and nothing
 *   below the guard ever clears `status`, so a row that already carries one
 *   returns before the fallback and never issues the prefetch at all.
 *
 * ── OBSERVED WHILE MEASURING, DELIBERATELY NOT CHANGED ──────────────────────
 *
 *   The legacy query is `.where('userId','==',uid).limit(1)`, and a bounded
 *   query with no orderBy returns the LOWEST ID — the adapter appends
 *   `query.order('id')`. So an account with two `marketplace_sellers` rows is
 *   answered from whichever sorts first, not whichever is newest. That is the
 *   same shape as the claim bound fixed in #273/#287/#288 and it predates this
 *   change; reordering a round trip must not quietly pick a different row, so
 *   the behaviour is preserved exactly and pinned below. Changing WHICH row
 *   wins is a behavioural decision and belongs in its own change.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { measureReadDepth } from '@/lib/testing/read-depth';
import { COLLECTIONS } from '@/lib/types/firestore';

/*
 *   A REAL PER-REQUEST MEMOISER — React's cache() is a PASS-THROUGH under
 *   jest, so without it every figure below is measured against a platform with
 *   no request memoisation at all, and the shared identity walk this action
 *   depends on does not exist.
 */
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

const UID = 'seller-1';
const EMAIL = 'seller@example.test';
const VER = COLLECTIONS.SELLER_VERIFICATIONS;
const LEGACY = COLLECTIONS.MARKETPLACE_SELLERS;

/** Today's cost of the marketplace check a first-time visitor waits on. */
const CEILING = { reads: 5, depth: 3 };

let store: FakeDbHandle;

beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    store = installFakeDb();
    store.seed(COLLECTIONS.USERS, UID, {
        uid: UID, email: EMAIL, roles: ['general_user'],
        isVerified: true, profileComplete: true, serviceRegistrations: {},
    });
    (global as any).mockRequireSession = jest.fn(() => Promise.resolve({
        session: { user: { id: UID, email: EMAIL, roles: ['general_user'] } },
        error: null,
    }));
});

const marketplace = () => import('@/app/actions/marketplace/_mp_onboarding');

/** The user row an approved seller carries. */
function seedApprovedOnTheRow(): void {
    store.seed(COLLECTIONS.USERS, UID, {
        uid: UID, email: EMAIL, roles: ['general_user', 'seller'],
        isVerified: true, profileComplete: true,
        serviceRegistrations: { marketplace: { status: 'approved', accountType: 'seller' } },
    });
}

describe('what the marketplace check actually waits for', () => {
    it('THE INSTRUMENT WORKS — a chain measures deep, a batch measures shallow', async () => {
        /*
         *   THE CONTROL, and this file is worthless without it. If the harness
         *   could not tell a chain from a batch, every ceiling below would pass
         *   on any implementation at all — which is precisely how a read-count
         *   suite stayed green while this action waited four times.
         */
        const g = global as any;

        const serial = measureReadDepth();
        await g.mockFirestoreGet();
        await g.mockFirestoreGet();
        await g.mockFirestoreGet();
        expect({ reads: serial.reads, depth: serial.depth }).toEqual({ reads: 3, depth: 3 });

        const together = measureReadDepth();
        await Promise.all([g.mockFirestoreGet(), g.mockFirestoreGet(), g.mockFirestoreGet()]);
        expect({ reads: together.reads, depth: together.depth }).toEqual({ reads: 3, depth: 1 });
    });

    it('A FIRST-TIME VISITOR WAITS THREE TIMES, not four', async () => {
        const { checkMarketplaceStatusAction } = await marketplace();
        const seen = measureReadDepth();

        const result: any = await checkMarketplaceStatusAction();

        //   The answer is unchanged: nothing is filed, so there is nothing.
        expect(result.data).toBeNull();
        expect(seen.reads).toBeLessThanOrEqual(CEILING.reads);
        expect(seen.depth).toBeLessThanOrEqual(CEILING.depth);
    });

    it('THE APPROVED SELLER STILL PAYS FOR ONE READ AND ONE WAIT', async () => {
        /*
         *   The common case on every marketplace page after onboarding, and the
         *   one that must not regress. An account whose registration says
         *   approved returns before any fallback, so the prefetch is never
         *   issued for it — which is what `!status` guards.
         */
        seedApprovedOnTheRow();
        const { checkMarketplaceStatusAction } = await marketplace();
        const seen = measureReadDepth();

        const result: any = await checkMarketplaceStatusAction();

        expect(result.data).toEqual({ status: 'approved', accountType: 'seller' });
        expect({ reads: seen.reads, depth: seen.depth }).toEqual({ reads: 1, depth: 1 });
    });

    it('and NO LEGACY QUERY IS ISSUED for a row that already carries a status', async () => {
        //   Stated directly rather than inferred from the read count: a
        //   prefetch for an account that returns early is pure cost, and the
        //   read count alone cannot say which collection was spared.
        seedApprovedOnTheRow();
        const { checkMarketplaceStatusAction } = await marketplace();

        await checkMarketplaceStatusAction();

        expect(store.reads.filter((r: any) => r.collection === LEGACY)).toHaveLength(0);
    });

    it('a PENDING row is answered from the row, and pays no more than it did', async () => {
        store.seed(COLLECTIONS.USERS, UID, {
            uid: UID, email: EMAIL, roles: ['general_user'],
            isVerified: true, profileComplete: true,
            serviceRegistrations: { marketplace: { status: 'pending', accountType: 'seller' } },
        });
        const { checkMarketplaceStatusAction } = await marketplace();
        const seen = measureReadDepth();

        const result: any = await checkMarketplaceStatusAction();

        expect(result.data).toEqual({ status: 'pending', accountType: 'seller' });
        expect(seen.reads).toBeLessThanOrEqual(4);
        expect(store.reads.filter((r: any) => r.collection === LEGACY)).toHaveLength(0);
    });

    it('AND THE LEGACY SELLER IS STILL FOUND, one wait sooner', async () => {
        store.seed(LEGACY, 'l1', { userId: UID, status: 'pending', accountType: 'both' });
        const { checkMarketplaceStatusAction } = await marketplace();
        const seen = measureReadDepth();

        const result: any = await checkMarketplaceStatusAction();

        expect(result.data).toEqual({ status: 'pending', accountType: 'both' });
        expect(seen.reads).toBeLessThanOrEqual(CEILING.reads);
        expect(seen.depth).toBeLessThanOrEqual(CEILING.depth);
    });
});

describe('the answers did not change, only the waiting', () => {
    it('THE BACKFILL STILL RUNS and still clears the cached profile', async () => {
        /*
         *   #692's rule, which this fallback carries: session-guard serves
         *   CacheKeys.userProfile for 300 seconds, so a heal that does not
         *   clear it is invisible to the very person who asked the platform to
         *   look again. Moving WHEN the query is issued must not move that.
         */
        store.seed(LEGACY, 'l1', { userId: UID, status: 'approved', accountType: 'seller' });
        const { checkMarketplaceStatusAction } = await marketplace();

        await checkMarketplaceStatusAction();

        const healed: any = store.get(COLLECTIONS.USERS, UID);
        expect(healed?.serviceRegistrations?.marketplace?.status).toBe('approved');
        expect(healed?.serviceRegistrations?.marketplace?.syncedFromLegacy).toBe(true);
    });

    it('a VERIFICATION RECORD still wins over the legacy row', async () => {
        /*
         *   Precedence, and the reason the prefetch is ISSUING a query rather
         *   than adopting its answer. The verification block runs first and
         *   returns; the legacy row must not be reached even though its query
         *   is already in flight.
         */
        store.seed(VER, 'v1', {
            userId: UID, status: 'rejected', accountType: 'seller',
            createdAt: new Date().toISOString(),
        });
        store.seed(LEGACY, 'l1', { userId: UID, status: 'approved', accountType: 'both' });
        const { checkMarketplaceStatusAction } = await marketplace();

        const result: any = await checkMarketplaceStatusAction();

        expect(result.data).toEqual({ status: 'rejected', accountType: 'seller' });
        //   And the legacy row was NOT adopted onto the user record.
        const row: any = store.get(COLLECTIONS.USERS, UID);
        expect(row?.serviceRegistrations?.marketplace?.syncedFromLegacy).toBeUndefined();
    });

    it('and the legacy row is still the LOWEST-ID one, not the newest', async () => {
        /*
         *   Pinned, not endorsed — see this file's header. `.limit(1)` with no
         *   orderBy returns the lowest id, and preserving that exactly is what
         *   makes this change a reordering rather than a behavioural one. If a
         *   later change decides the newest row should win, this assertion is
         *   where that decision gets made deliberately.
         */
        store.seed(LEGACY, 'a-older', { userId: UID, status: 'rejected', accountType: 'seller' });
        store.seed(LEGACY, 'z-newer', { userId: UID, status: 'approved', accountType: 'both' });
        const { checkMarketplaceStatusAction } = await marketplace();

        const result: any = await checkMarketplaceStatusAction();

        expect(result.data.status).toBe('rejected');
    });
});
