/**
 * @jest-environment node
 */

/**
 *   THE OWNER: "fix the academy status one next."
 *
 *       checkAcademyStatusAction took 1433ms  1439ms  1467ms  1666ms
 *                                    1725ms  1854ms  2009ms  2482ms
 *                                    2479ms  3235ms
 *
 *   Ten lines in one session, and the read counts beside them in that log are
 *   not to be trusted: the meter was request-scoped and concurrent actions
 *   took each other's numbers, which #281 fixed. Measured properly, against
 *   the fake database, with every read made to take a tick:
 *
 *       nothing filed        6 reads, depth 5   ->  6 reads, depth 3
 *       an approved learner  1 read,  depth 1   ->  unchanged
 *       a learner who has applied
 *                            4 reads, depth 3   ->  unchanged
 *
 *   SIX READS WAS ALREADY TIGHT. #272 and #273 shared three of them with the
 *   payment check that runs beside this on /academy/application. What was left
 *   was not a read problem, it was a CHAIN: the owner-scoped query, then the
 *   by-address sweep if that came back empty, then the payment record if that
 *   came back empty too. Each link waits a full round trip to learn whether
 *   the next is needed, and five links at a few hundred milliseconds is the
 *   figure in the log.
 *
 * ── PREFETCHED ONLY WHERE IT COULD RUN ──────────────────────────────────────
 *
 *   The user row is already in hand when the decision is made, and it answers
 *   both questions:
 *
 *     - the by-address sweep is reachable only with NO applicationId on the
 *       row (the branch above it wins otherwise) and an address to sweep by;
 *     - the payment record is reachable only with NO academy status on the
 *       row, because any status returns before it.
 *
 *   Submitting an application writes BOTH — `serviceRegistrations.academy
 *   .status: "pending"` and `.applicationId` — so a learner who has applied
 *   trips neither guard and pays nothing extra. The only record that does is
 *   one with an application but nothing on the user row, which is the
 *   inconsistent state the healing branches exist for rather than the normal
 *   one.
 *
 * ── AND #888'S DEFECT 2 IS UNTOUCHED ────────────────────────────────────────
 *
 *   Issuing the by-address query is not claiming what it returns.
 *   `claimableByEmail` still rules on its rows, in the same place, with the
 *   same argument — which matters here more than anywhere, because this branch
 *   writes `approved` onto the caller's own row and checkModuleAccess then
 *   grants on that for ever without reading this code again.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { measureReadDepth } from '@/lib/testing/read-depth';
import { COLLECTIONS } from '@/lib/types/firestore';

/*
 *   A REAL PER-REQUEST MEMOISER — React's cache() is a PASS-THROUGH under
 *   jest, so without this the request memoisation under test does not exist
 *   and every figure below is measured against a platform that has none.
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

const UID = 'learner-1';
const EMAIL = 'learner@example.test';
const APPS = COLLECTIONS.ACADEMY_APPLICATIONS;

/** Today's cost of the Academy check a learner actually waits on. */
const CEILING = { reads: 6, depth: 3 };

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

const academy = () => import('@/app/actions/academy/_ac_enrollment');

describe('what the Academy check actually waits for', () => {
    it('THE INSTRUMENT WORKS — a chain measures deep, a batch measures shallow', async () => {
        /*
         *   THE CONTROL, and this file is worthless without it: a harness that
         *   could not tell the two apart would report every implementation as
         *   fast. It is also the reason this measures GENERATIONS rather than
         *   idle gaps — the first version counted a new wave whenever nothing
         *   was in flight, and two overlapping chains hid three of the five
         *   round trips below.
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

        //   And overlapping chains do not flatter it: the second read here
        //   waits on the first, so the depth is two however long the long one
        //   stays in flight.
        const overlapping = measureReadDepth();
        await Promise.all([
            (async () => { await g.mockFirestoreGet(); await g.mockFirestoreGet(); })(),
            g.mockFirestoreGet(),
        ]);
        expect(overlapping.depth).toBe(2);
    });

    it('A LEARNER WITH NOTHING FILED WAITS THREE TIMES, not five', async () => {
        const { checkAcademyStatusAction } = await academy();
        const seen = measureReadDepth();

        const result: any = await checkAcademyStatusAction();

        //   The answer is unchanged: nothing filed, so nothing to report.
        expect(result).toMatchObject({ success: true, data: null });
        expect(seen.reads).toBeLessThanOrEqual(CEILING.reads);
        expect(seen.depth).toBeLessThanOrEqual(CEILING.depth);
    });

    it('THE APPROVED LEARNER STILL PAYS FOR ONE READ AND ONE WAIT', async () => {
        //   The common case, and the one that must not regress. It returns
        //   before any fallback is reached, so nothing is prefetched for it.
        store.seed(COLLECTIONS.USERS, UID, {
            uid: UID, email: EMAIL, roles: ['general_user'],
            isVerified: true, profileComplete: true,
            serviceRegistrations: { academy: { status: 'approved' } },
        });
        const { checkAcademyStatusAction } = await academy();
        const seen = measureReadDepth();

        const result: any = await checkAcademyStatusAction();

        expect(result).toMatchObject({ success: true, data: 'approved' });
        expect({ reads: seen.reads, depth: seen.depth }).toEqual({ reads: 1, depth: 1 });
    });

    it('AND A LEARNER WHO HAS APPLIED PAYS NOTHING EXTRA', async () => {
        /*
         *   THE TRADE, AND WHY IT IS A GOOD ONE HERE. Submitting an
         *   application writes both the status and the applicationId onto the
         *   user row, so this learner trips neither prefetch guard: no
         *   by-address sweep, no payment record, exactly the four reads and
         *   three waits it cost before.
         */
        store.seed(COLLECTIONS.USERS, UID, {
            uid: UID, email: EMAIL, roles: ['general_user'],
            isVerified: true, profileComplete: true,
            serviceRegistrations: { academy: { status: 'pending', applicationId: 'app-1' } },
        });
        store.seed(APPS, 'app-1', {
            userId: UID, status: 'pending', createdAt: new Date().toISOString(),
        });
        const { checkAcademyStatusAction } = await academy();
        const seen = measureReadDepth();

        const result: any = await checkAcademyStatusAction();

        expect(result).toMatchObject({ success: true, data: 'pending' });
        expect(seen.reads).toBeLessThanOrEqual(4);
        expect(seen.depth).toBeLessThanOrEqual(CEILING.depth);
    });

    it('a status on the row alone issues no payment lookup at all', async () => {
        //   The guard stated directly: any status returns before the final
        //   fallback, so the read for it is never issued.
        store.seed(COLLECTIONS.USERS, UID, {
            uid: UID, email: EMAIL, roles: ['general_user'],
            isVerified: true, profileComplete: true,
            serviceRegistrations: { academy: { status: 'rejected', applicationId: 'app-1' } },
        });
        store.seed(APPS, 'app-1', {
            userId: UID, status: 'rejected', createdAt: new Date().toISOString(),
        });
        const { checkAcademyStatusAction } = await academy();
        const seen = measureReadDepth();

        await checkAcademyStatusAction();

        const paymentReads = store.reads.filter((r: any) => r.collection === COLLECTIONS.PROCESSED_PAYMENTS);
        expect(paymentReads).toEqual([]);
        expect(seen.depth).toBeLessThanOrEqual(CEILING.depth);
    });
});

describe('the answer did not change, only the waiting', () => {
    it('still finds an application owned by the learner', async () => {
        store.seed(APPS, 'app-1', {
            userId: UID, status: 'under_review', createdAt: new Date().toISOString(),
        });
        const { checkAcademyStatusAction } = await academy();

        expect(await checkAcademyStatusAction()).toMatchObject({ data: 'under_review' });
    });

    it('still reports a completed payment when nothing else exists', async () => {
        store.seed(COLLECTIONS.PROCESSED_PAYMENTS, 'pay-1', {
            userId: UID, type: 'academy_registration', status: 'completed',
        });
        const { checkAcademyStatusAction } = await academy();

        expect(await checkAcademyStatusAction()).toMatchObject({ data: 'payment_completed' });
    });

    it('STILL REFUSES an application that belongs to another account', async () => {
        /*
         *   #888 DEFECT 2. This branch writes `approved` onto the caller's own
         *   row, and checkModuleAccess grants on that for ever without reading
         *   this code again — so a learner whose address somebody else typed
         *   into a form was admitted permanently on a field nobody
         *   authenticated as.
         *
         *   Issuing the query earlier must not move that rule one line.
         */
        store.seed(APPS, 'theirs', {
            userId: 'somebody-else',
            status: 'approved',
            personalInfo: { email: EMAIL },
            createdAt: new Date().toISOString(),
        });
        const { checkAcademyStatusAction } = await academy();

        const result: any = await checkAcademyStatusAction();

        expect(result.data).not.toBe('approved');
        //   And the row still belongs to whoever it belonged to.
        expect((store.get(APPS, 'theirs') as any)?.userId).toBe('somebody-else');
    });

    it('and still CLAIMS an unclaimed one at the learner\'s own address', async () => {
        store.seed(APPS, 'unclaimed', {
            status: 'under_review',
            personalInfo: { email: EMAIL },
            createdAt: new Date().toISOString(),
        });
        const { checkAcademyStatusAction } = await academy();

        const result: any = await checkAcademyStatusAction();

        expect(result.data).toBe('under_review');
        expect((store.get(APPS, 'unclaimed') as any)?.userId).toBe(UID);
    });
});
