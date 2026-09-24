/**
 * @jest-environment node
 */

/**
 *   THE OWNER: "fix the academy payment one next."
 *
 *       [slow-action] checkAcademyPaymentStatusAction took 1879ms — 0 reads
 *
 *   THE LAST HOT ACTION NOTHING HAD MEASURED, and the deepest on the platform
 *   once it was. Every other action in the owner's log got a depth pass —
 *   cooperative, Academy status, Export, wallet, WAVE, Farm Nation,
 *   Marketplace. This one has behavioural suites and appeared in none of them,
 *   which is how the deepest chain on the platform stayed the last one looked
 *   at.
 *
 *   (The "0 reads" was the OLD meter: cache() has no store in a POST-invoked
 *   server action, which #281 fixed with AsyncLocalStorage. The reads were
 *   always there.)
 *
 * ── SIX READS IN FIVE GENERATIONS ───────────────────────────────────────────
 *
 *   Measured with lib/testing/read-depth, for a learner who has not paid and
 *   has not applied:
 *
 *       1. the user row              needs the caller's id
 *       2. the identity walk         needs the caller's id
 *       3. the payment record        needs the OWNED IDS from 2
 *       4. the owned applications    needs the OWNED IDS from 2
 *       5. the by-address sweep      needs an address, and nothing else
 *
 *   Three of those were a chain only in the source. They are three questions
 *   about one person — did they pay, did they apply, is there an application
 *   at their address — and each waited a round trip to learn whether the next
 *   was needed.
 *
 *       unpaid, nothing filed      6 reads, depth 5  ->  6 reads, depth 3
 *       entitled on the row        1 read,  depth 1  ->  unchanged
 *       own paid application       5 reads, depth 4  ->  5 reads, depth 3
 *       a payment record only      4 reads, depth 3  ->  6 reads, depth 3
 *
 *   THE LAST ROW IS THE COST, STATED RATHER THAN BURIED. A learner whose
 *   entitlement is proved by the payment record alone reads six where they
 *   read four: the two later questions are asked and their answers thrown
 *   away. They wait for neither — the depth is unchanged — and on
 *   /academy/application checkAcademyStatusAction was asking for all three
 *   beside this action anyway (#272, #284). lib/application-request-reads
 *   memoises the PROMISE, so those are the same round trips joined rather than
 *   repeated.
 *
 *   The guards spare everybody else: an entitled row returns before any of it
 *   is issued, and a row that names an application skips the sweep — the same
 *   guard #284 uses on the same collection one file over.
 *
 * ── AND THE GATE DID NOT MOVE ───────────────────────────────────────────────
 *
 *   #888 DEFECT 2 LIVED ON THIS DOOR. It read `emailQuery.docs[0]` whatever
 *   its userId, so somebody else's paid application answered "paid" for this
 *   learner — and academy/(learner)/layout.tsx uses this answer to decide
 *   whether to force the payment flow. claimableByEmail still rules, in the
 *   same place, on the same rows. Issuing a query early is not reading its
 *   rows into an answer, which is why both halves are asserted below.
 *
 * ── OBSERVED WHILE MEASURING, DELIBERATELY NOT CHANGED ──────────────────────
 *
 *   THIS ACTION NEVER HEALS THE ROW. It answers "paid" from the payment record
 *   without writing `serviceRegistrations.academy.paymentStatus`, so a learner
 *   whose entitlement lives only in processed_payments pays those reads on
 *   every page view, for ever. Every sibling action backfills what it learns
 *   (and #692 says such a heal must also clear the cached profile). Adding a
 *   write to a read path is a behavioural change, not a reordering, and it
 *   belongs in its own change — but it is the thing that would take this
 *   learner from six reads to one.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { measureReadDepth } from '@/lib/testing/read-depth';
import { COLLECTIONS } from '@/lib/types/firestore';

/*
 *   A REAL PER-REQUEST MEMOISER — React's cache() is a PASS-THROUGH under
 *   jest, and this action's three fallbacks all read through it. Without this
 *   the sharing under test does not exist and every figure below is measured
 *   against a platform that has none.
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
const PAY = COLLECTIONS.PROCESSED_PAYMENTS;

/** Today's cost of the payment check a learner actually waits on. */
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

const academy = () => import('@/app/actions/academy/_payment');

describe('what the academy payment check actually waits for', () => {
    it('THE INSTRUMENT WORKS — a chain measures deep, a batch measures shallow', async () => {
        //   THE CONTROL. Without it every ceiling below passes on anything.
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

    it('AN UNPAID LEARNER WAITS THREE TIMES, not five', async () => {
        const { checkAcademyPaymentStatusAction } = await academy();
        const seen = measureReadDepth();

        const result: any = await checkAcademyPaymentStatusAction();

        expect(result.data).toBe('unpaid');
        expect(seen.reads).toBeLessThanOrEqual(CEILING.reads);
        expect(seen.depth).toBeLessThanOrEqual(CEILING.depth);
    });

    it('AN ENTITLED ROW STILL PAYS FOR ONE READ AND ONE WAIT', async () => {
        /*
         *   The common case on every academy page, and the one that must not
         *   regress. The entitlement check returns above the prefetch, so none
         *   of the three queries is issued for this learner at all.
         */
        store.seed(COLLECTIONS.USERS, UID, {
            uid: UID, email: EMAIL, roles: ['general_user'],
            isVerified: true, profileComplete: true,
            serviceRegistrations: { academy: { paymentStatus: 'completed' } },
        });
        const { checkAcademyPaymentStatusAction } = await academy();
        const seen = measureReadDepth();

        const result: any = await checkAcademyPaymentStatusAction();

        expect(result.data).toBe('paid');
        expect({ reads: seen.reads, depth: seen.depth }).toEqual({ reads: 1, depth: 1 });
    });

    it('and NO FALLBACK QUERY IS ISSUED for an entitled row', async () => {
        //   Stated by collection rather than inferred from a count: a prefetch
        //   for a learner who returns above it is pure cost.
        store.seed(COLLECTIONS.USERS, UID, {
            uid: UID, email: EMAIL, roles: ['general_user'],
            isVerified: true, profileComplete: true,
            serviceRegistrations: { academy: { paymentStatus: 'completed' } },
        });
        const { checkAcademyPaymentStatusAction } = await academy();

        await checkAcademyPaymentStatusAction();

        expect(store.reads.filter((r: any) => r.collection === PAY)).toHaveLength(0);
        expect(store.reads.filter((r: any) => r.collection === APPS)).toHaveLength(0);
    });

    it('A LEARNER WHOSE ROW NAMES AN APPLICATION SKIPS THE SWEEP', async () => {
        /*
         *   The sweep is reached only when the owner-scoped query comes back
         *   empty, and a row naming an application is the cheap sign that it
         *   will not. Same guard #284 uses on the same collection.
         */
        store.seed(COLLECTIONS.USERS, UID, {
            uid: UID, email: EMAIL, roles: ['general_user'],
            isVerified: true, profileComplete: true,
            serviceRegistrations: { academy: { applicationId: 'a1' } },
        });
        store.seed(APPS, 'a1', {
            userId: UID, paymentStatus: 'completed', createdAt: new Date().toISOString(),
        });
        const { checkAcademyPaymentStatusAction } = await academy();
        const seen = measureReadDepth();

        const result: any = await checkAcademyPaymentStatusAction();

        expect(result.data).toBe('paid');
        //   One query against the applications collection — the owner-scoped
        //   one. A prefetched sweep would make it two.
        const appQueries = store.reads.filter((r: any) => r.collection === APPS && !r.id);
        expect(appQueries).toHaveLength(1);
        expect(seen.depth).toBeLessThanOrEqual(CEILING.depth);
    });
});

describe('the answers did not change, only the waiting', () => {
    it('a COMPLETED PAYMENT RECORD still answers paid', async () => {
        store.seed(PAY, 'p1', { userId: UID, type: 'academy_registration', status: 'completed' });
        const { checkAcademyPaymentStatusAction } = await academy();
        const seen = measureReadDepth();

        const result: any = await checkAcademyPaymentStatusAction();

        expect(result.data).toBe('paid');
        //   The stated cost: two questions asked and thrown away, waited for
        //   by nobody.
        expect(seen.depth).toBeLessThanOrEqual(CEILING.depth);
    });

    it('#888 DEFECT 2 — a stranger\'s paid application at this address is REFUSED', async () => {
        /*
         *   The security half, and the reason the prefetch issues a query
         *   rather than adopting its answer. academy/(learner)/layout.tsx
         *   decides whether to force the payment flow on this answer, so
         *   reading somebody else's paid row would hand over their enrolment.
         */
        store.seed(APPS, 'theirs', {
            userId: 'somebody-else',
            personalInfo: { email: EMAIL },
            paymentStatus: 'completed',
            createdAt: new Date().toISOString(),
        });
        const { checkAcademyPaymentStatusAction } = await academy();

        const result: any = await checkAcademyPaymentStatusAction();

        expect(result.data).toBe('unpaid');
    });

    it('but an UNCLAIMED paid application at their address is still honoured', async () => {
        //   The legitimate half of the same rule, kept so the assertion above
        //   is shown to be about ownership rather than about refusing everyone.
        store.seed(APPS, 'unclaimed', {
            personalInfo: { email: EMAIL },
            paymentStatus: 'completed',
            createdAt: new Date().toISOString(),
        });
        const { checkAcademyPaymentStatusAction } = await academy();

        const result: any = await checkAcademyPaymentStatusAction();

        expect(result.data).toBe('paid');
    });

    it('and a read failure is still WE COULD NOT TELL, never a definitive unpaid', async () => {
        /*
         *   #316. A database failure used to assert "this learner has not
         *   paid", and the layout's guard — `success && data === "unpaid"` —
         *   was made meaningless by success:true, throwing a paid learner into
         *   a flow that offers to charge them again.
         *
         *   A PREFETCHED PROMISE THAT REJECTS MUST STILL REACH THAT CATCH.
         *   started-early captures the outcome and re-raises it on read, so the
         *   rejection surfaces where it always did rather than becoming an
         *   unhandled rejection at the process level.
         */
        const g = global as any;
        const inner = g.mockFirestoreGet.getMockImplementation();
        let calls = 0;
        g.mockFirestoreGet.mockImplementation((...args: any[]) => {
            calls += 1;
            //   The user row succeeds; the first fallback query does not.
            if (calls > 1) return Promise.reject(new Error('connection reset'));
            return inner(...args);
        });
        const { checkAcademyPaymentStatusAction } = await academy();

        const result: any = await checkAcademyPaymentStatusAction();

        expect(result.success).toBe(false);
        expect(result.data).toBeNull();
    });
});
