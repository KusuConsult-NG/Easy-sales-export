/**
 * @jest-environment node
 */

/**
 *   THE OWNER: "fix the cooperative status one next."
 *
 *       checkCooperativeStatusAction took 1496ms
 *       checkCooperativeStatusAction took 1691ms
 *       checkCooperativeStatusAction took 1848ms
 *       checkCooperativeStatusAction took 2596ms
 *
 *   #275 and #276 already took this action from fourteen reads to seven, and
 *   it was still taking seconds. This file is about why, and it is a different
 *   measurement from every other one in this audit:
 *
 *       READ COUNT IS NOT WHAT LATENCY IS MADE OF.
 *
 *   Seven reads issued one after another cost seven round trips. Seven reads
 *   issued together cost one. Every "reads" figure in this audit counts the
 *   first number and says nothing about the second, so an action could be
 *   optimised twice and still wait six times.
 *
 *   Measured by making every read in the fake database take a real tick and
 *   counting WAVES — a wave begins whenever a read starts with none already in
 *   flight:
 *
 *       nothing filed              7 reads,  6 waves  →  7 reads, 3 waves
 *       a member row, no status    5 reads,  4 waves  →  7 reads, 3 waves
 *       an active member           1 read,   1 wave   →  unchanged
 *
 *   The active member — the common case, and the only one on the fast path —
 *   is untouched at a single read.
 *
 * ── THE TRADE, STATED PLAINLY ───────────────────────────────────────────────
 *
 *   A member whose row is found now reads SEVEN where it read five: the
 *   by-address query and the Paystack check are issued before it is known
 *   whether they are needed. They are concurrent, so that member waits for
 *   none of them, and `document_collections` is 36 MB and executes in
 *   microseconds — a round trip against it is almost entirely waiting. Buying
 *   a wave with a read is the right way round here. It would be the wrong way
 *   round for an expensive query on a path that usually skips it.
 *
 * ── AND THE GATE DID NOT MOVE ───────────────────────────────────────────────
 *
 *   Issuing a query early is not reading its rows into an answer.
 *   `mayClaimMembershipByEmail` still stands between the by-address result and
 *   any use of it, with the same arguments, in the same place. The suite next
 *   door — the-slowest-check-on-the-platform — pins that, and it is unchanged.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

/*
 *   A REAL PER-REQUEST MEMOISER — React's cache() is a PASS-THROUGH under
 *   jest, so without this the request memoisation under test does not exist
 *   and every count below reads high for the wrong reason.
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

const UID = 'member-1';
const EMAIL = 'member@example.test';

/**
 * Today's depth for the cooperatives check a member actually waits on.
 *
 * READS is the ceiling this audit has always tracked. WAVES is the new one,
 * and it is the one the owner's log was measuring all along.
 */
const CEILING = { reads: 7, waves: 3 };

let store: FakeDbHandle;

/**
 * Make every read take a tick, and count the waves.
 *
 *   The fake database answers from memory, so nothing in it is concurrent by
 *   default and a serial chain is indistinguishable from a parallel one. A
 *   real delay makes the difference observable: a wave begins whenever a read
 *   starts with none already in flight, so N reads issued together are one
 *   wave and N issued in sequence are N.
 */
function measureWaves(): { waves: number; reads: number } {
    const g = global as any;
    const inner = g.mockFirestoreGet.getMockImplementation();
    let inFlight = 0;
    const state = { waves: 0, reads: 0 };

    g.mockFirestoreGet.mockImplementation((...args: any[]) => {
        if (inFlight === 0) state.waves += 1;
        inFlight += 1;
        state.reads += 1;
        const result = inner(...args);
        return new Promise((resolve) => setTimeout(() => {
            inFlight -= 1;
            resolve(result);
        }, 5));
    });

    return state;
}

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

const coop = () => import('@/app/actions/cooperative/_coop_membership');

describe('what the cooperatives check actually waits for', () => {
    it('THE MEASUREMENT ITSELF WORKS — serial reads count as separate waves', async () => {
        /*
         *   THE CONTROL, and this file is worthless without it. If the harness
         *   could not tell a chain from a batch, every ceiling below would
         *   pass on any implementation at all — which is precisely how a
         *   read-count suite can be green while an action waits six times.
         */
        const { checkCooperativeStatusAction } = await coop();
        void checkCooperativeStatusAction;
        const seen = measureWaves();
        const g = global as any;

        //   Three reads in a chain.
        await g.mockFirestoreGet();
        await g.mockFirestoreGet();
        await g.mockFirestoreGet();
        expect({ reads: seen.reads, waves: seen.waves }).toEqual({ reads: 3, waves: 3 });

        //   Three more together.
        await Promise.all([g.mockFirestoreGet(), g.mockFirestoreGet(), g.mockFirestoreGet()]);
        expect({ reads: seen.reads, waves: seen.waves }).toEqual({ reads: 6, waves: 4 });
    });

    it('A MEMBER WITH NOTHING FILED WAITS THREE TIMES, not six', async () => {
        const { checkCooperativeStatusAction } = await coop();
        const seen = measureWaves();

        const result = await checkCooperativeStatusAction();

        //   The answer is unchanged: nothing is filed, so there is nothing.
        //   (withFlexibleSafeAction hands this action's value straight back.)
        expect(result).toBeNull();
        expect(seen.reads).toBeLessThanOrEqual(CEILING.reads);
        expect(seen.waves).toBeLessThanOrEqual(CEILING.waves);
    });

    it('AND SO DOES A MEMBER WHOSE ROW IS FOUND — seven reads, three waits', async () => {
        //   This is the case that pays two extra reads for the saved waves.
        //   It waits for neither of them, which is the whole trade.
        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, UID, {
            userId: UID, userEmail: EMAIL, membershipStatus: 'pending', onboardingCompleted: false,
        });
        const { checkCooperativeStatusAction } = await coop();
        const seen = measureWaves();

        const result = await checkCooperativeStatusAction();

        expect(result).toBe('pending');
        expect(seen.reads).toBeLessThanOrEqual(CEILING.reads);
        expect(seen.waves).toBeLessThanOrEqual(CEILING.waves);
    });

    it('THE ACTIVE MEMBER STILL PAYS FOR ONE READ AND ONE WAIT', async () => {
        /*
         *   The common case, and the one that must not regress. An account
         *   whose registration says active never reaches any of the fallbacks,
         *   so none of the work above is issued for it at all — the early
         *   return happens before the wave is opened.
         */
        store.seed(COLLECTIONS.USERS, UID, {
            uid: UID, email: EMAIL, roles: ['general_user', 'cooperative_member'],
            isVerified: true, profileComplete: true,
            serviceRegistrations: { cooperatives: { status: 'active' } },
        });
        const { checkCooperativeStatusAction } = await coop();
        const seen = measureWaves();

        const result = await checkCooperativeStatusAction();

        expect(result).toBe('approved');
        expect({ reads: seen.reads, waves: seen.waves }).toEqual({ reads: 1, waves: 1 });
    });

    it('and a SUPERSEDED PROFILE costs one more wait, which is the identity walk and not the lookup', async () => {
        /*
         *   FOUR, not three, and the extra one is honest rather than a miss.
         *   The backward identity search is a WALK: it finds `old-profile`,
         *   then has to ask whether anything was superseded by THAT in turn.
         *   Its depth is not something this change can collapse, and pretending
         *   otherwise would be a ceiling that quietly stopped describing the
         *   code.
         *
         *   What this change does fix here is the per-profile loop: it used to
         *   await a keyed read for EACH owned id, so a duplicate group cost a
         *   round trip per profile on top of the walk. They are issued together
         *   now and the precedence runs over values already in hand, so the row
         *   chosen is the row that was always chosen.
         */
        store.seed(COLLECTIONS.USERS, 'old-profile', {
            uid: 'old-profile', email: EMAIL, _migratedTo: UID,
        });
        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, 'old-profile', {
            userId: 'old-profile', userEmail: EMAIL, membershipStatus: 'pending',
        });
        const { checkCooperativeStatusAction } = await coop();
        const seen = measureWaves();

        await checkCooperativeStatusAction();

        //   One more wave than the single-profile case, and only one: the
        //   extra hop of the walk. Not one per profile.
        expect(seen.waves).toBeLessThanOrEqual(CEILING.waves + 1);
    });
});
