/**
 *   THE OWNER: "fix the academy one next."
 *
 *   It was a slowness request, and measuring it found a door standing open.
 *
 * ── WHAT THE MEASUREMENT FOUND ──────────────────────────────────────────────
 *
 *   #261's read meter with a real per-request memoiser. One draw of
 *   /academy/application cost TEN reads, and FOUR were a question already
 *   asked in the same request — the page runs checkAcademyStatusAction and
 *   checkAcademyPaymentStatusAction in one Promise.all, so neither could see
 *   the other's answer:
 *
 *       users:doc  ×2 · academy_applications(owned)  ×2
 *       academy_applications(typed email)  ×2 · processedPayments  ×2
 *
 *       /academy/application    10 reads → 6
 *       academy learner layout   8 reads → 7
 *
 * ── AND WHAT IT FOUND ON THE WAY ────────────────────────────────────────────
 *
 *   #888 DEFECT 2, ON TWO MORE DOORS. lib/claimable-application's header lists
 *   the four that ask this correctly — WAVE, Export, Farm Nation, and the gate
 *   — and states the defect the other doors carried: "The `!appData.userId`
 *   test guarded only the backfill WRITE. The document became the answer
 *   either way, so an application belonging to a DIFFERENT user id was still
 *   read and its `approved` status still granted to the caller."
 *
 *   Both Academy actions still read `emailQuery.docs[0]` whatever its owner,
 *   matched on `personalInfo.email` — the address TYPED ON THE FORM, which
 *   nobody authenticated as. Reproduced against the fake db before the fix:
 *
 *       checkAcademyStatusAction         → "approved"
 *       checkAcademyPaymentStatusAction  → "paid"
 *       and serviceRegistrations.academy.status: "approved" WRITTEN onto the
 *       caller's own user row — which Layers 2 and 2.5 of checkModuleAccess
 *       then grant on, in that header's words, "for ever without ever reaching
 *       this code again".
 *
 *   The payment answer is the one academy/(learner)/layout.tsx uses to decide
 *   whether to force the payment flow, so the pair is a free place AND a
 *   skipped fee.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

//   A real per-request memoiser — React's cache() is a PASS-THROUGH under
//   jest, and every claim in this file is about what one request costs.
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

/** Today's cost of the two screens an Academy learner actually waits on. */
const CEILING = {
    applicationPage: 6,   // was 10
    learnerLayout: 7,     // was 8
};

let store: FakeDbHandle;

const academyActions = async () => ({
    ...(await import('@/app/actions/academy/_ac_enrollment')),
    ...(await import('@/app/actions/academy/_payment')),
});

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

/** Somebody else's approved, paid application, carrying this learner's address. */
const seedSomebodyElsesApplication = () => {
    store.seed(COLLECTIONS.ACADEMY_APPLICATIONS, 'app-other', {
        userId: 'a-different-person',
        status: 'approved',
        paymentStatus: 'completed',
        personalInfo: { email: EMAIL },
        submittedAt: '2026-01-01T00:00:00.000Z',
    });
};

describe('#888 — an Academy place is not granted on an address somebody typed', () => {
    it('THE STATUS CHECK DOES NOT ADOPT an application that already has an owner', async () => {
        seedSomebodyElsesApplication();
        const { checkAcademyStatusAction } = await academyActions();

        const result = await checkAcademyStatusAction();

        //   THE WHOLE SHAPE, not just `data`. A thrown error also answers
        //   `data: null`, so asserting the field alone cannot tell a clean
        //   refusal from a crash — and a mutant that reverted this branch and
        //   blew up on the way SURVIVED that weaker assertion.
        expect(result).toEqual({ error: null, success: true, data: null });
    });

    it('AND DOES NOT WRITE THE GRANT ONTO THE CALLER, which is the part that sticks', async () => {
        //   Layers 2 and 2.5 of checkModuleAccess read this field and never
        //   reach the claim rule again, so a write here is permanent.
        seedSomebodyElsesApplication();
        const { checkAcademyStatusAction } = await academyActions();

        await checkAcademyStatusAction();

        const me: any = store.get(COLLECTIONS.USERS, UID);
        expect(me?.serviceRegistrations?.academy?.status).toBeUndefined();
    });

    it('AND LEAVES THE OTHER ACCOUNT\'S APPLICATION ALONE', async () => {
        seedSomebodyElsesApplication();
        const { checkAcademyStatusAction } = await academyActions();

        await checkAcademyStatusAction();

        const app: any = store.get(COLLECTIONS.ACADEMY_APPLICATIONS, 'app-other');
        expect(app?.userId).toBe('a-different-person');
    });

    it('THE PAYMENT CHECK DOES NOT READ somebody else\'s paid application as this learner\'s fee', async () => {
        //   This answer is what academy/(learner)/layout.tsx uses to decide
        //   whether to force the payment flow.
        seedSomebodyElsesApplication();
        const { checkAcademyPaymentStatusAction } = await academyActions();

        const result = await checkAcademyPaymentStatusAction();

        expect(result.data).toBe('unpaid');
    });

    it('BUT AN UNCLAIMED APPLICATION IS STILL CLAIMED — nobody is locked out', async () => {
        //   The narrowing removes rows that belong to somebody else, and only
        //   those. A learner whose application predates their account still
        //   gets in, and the row is healed onto them.
        store.seed(COLLECTIONS.ACADEMY_APPLICATIONS, 'app-mine', {
            status: 'approved',
            personalInfo: { email: EMAIL },
            submittedAt: '2026-01-01T00:00:00.000Z',
        });
        const { checkAcademyStatusAction } = await academyActions();

        const result = await checkAcademyStatusAction();

        expect(result.data).toBe('approved');
        const app: any = store.get(COLLECTIONS.ACADEMY_APPLICATIONS, 'app-mine');
        expect(app?.userId).toBe(UID);
    });

    it('and an unclaimed PAID application still answers "paid"', async () => {
        store.seed(COLLECTIONS.ACADEMY_APPLICATIONS, 'app-mine', {
            paymentStatus: 'completed',
            personalInfo: { email: EMAIL },
            submittedAt: '2026-01-01T00:00:00.000Z',
        });
        const { checkAcademyPaymentStatusAction } = await academyActions();

        const result = await checkAcademyPaymentStatusAction();

        expect(result.data).toBe('paid');
    });
});

describe('what /academy/application costs a learner who has not applied', () => {
    it('DOES NOT GROW — six reads is the ceiling, down from ten', async () => {
        const { checkAcademyStatusAction, checkAcademyPaymentStatusAction } = await academyActions();
        store.reads.length = 0;

        //   Promise.all, exactly as the page runs them. The saving is only real
        //   if the SECOND caller can join a round trip already in flight.
        const [status, payment] = await Promise.all([
            checkAcademyStatusAction(),
            checkAcademyPaymentStatusAction(),
        ]);

        expect(store.reads.length).toBeLessThanOrEqual(CEILING.applicationPage);
        //   AND THE ANSWERS ARE UNCHANGED, which is what makes the saving free.
        expect(status.data).toBeNull();
        expect(payment.data).toBe('unpaid');
    });

    it('asks for the user row ONCE across both actions', async () => {
        const { checkAcademyStatusAction, checkAcademyPaymentStatusAction } = await academyActions();
        store.reads.length = 0;

        await Promise.all([checkAcademyStatusAction(), checkAcademyPaymentStatusAction()]);

        const ownRow = store.reads.filter((r: any) => r.collection === COLLECTIONS.USERS && r.id === UID);
        expect(ownRow.length).toBe(1);
    });

    it('asks processed_payments ONCE, not once per action', async () => {
        const { checkAcademyStatusAction, checkAcademyPaymentStatusAction } = await academyActions();
        store.reads.length = 0;

        await Promise.all([checkAcademyStatusAction(), checkAcademyPaymentStatusAction()]);

        const payments = store.reads.filter((r: any) => r.collection === COLLECTIONS.PROCESSED_PAYMENTS);
        expect(payments.length).toBe(1);
    });
});

describe('the academy learner layout', () => {
    it('DOES NOT GROW — seven reads is the ceiling, down from eight', async () => {
        const { checkModuleAccess } = await import('@/lib/module-access-check');
        const { checkAcademyPaymentStatusAction } = await academyActions();
        store.reads.length = 0;

        await checkModuleAccess(UID, ['general_user'] as never, 'academy');
        await checkAcademyPaymentStatusAction();

        expect(store.reads.length).toBeLessThanOrEqual(CEILING.learnerLayout);
    });

    it('SEVEN AND NOT SIX, on purpose', async () => {
        /*
         *   The one duplicate left is the owner-scoped applications query: the
         *   gate bounds it at APPLICATION_SCAN_LIMIT and the actions do not, so
         *   they are different queries and cannot share a memo.
         *
         *   UNIFYING THEM WOULD BE A NARROWING, NOT A SAVING. Neither query
         *   orders its rows, so capping the actions at 25 would hand them an
         *   ARBITRARY 25 — and for the payment check that means a learner with
         *   more applications than the cap could have their paid one dropped
         *   and be asked to pay again. That is #316's harm direction exactly,
         *   and one round trip is not worth buying it.
         */
        const { checkModuleAccess } = await import('@/lib/module-access-check');
        const { checkAcademyPaymentStatusAction } = await academyActions();
        store.reads.length = 0;

        await checkModuleAccess(UID, ['general_user'] as never, 'academy');
        await checkAcademyPaymentStatusAction();

        const apps = store.reads.filter((r: any) => r.collection === COLLECTIONS.ACADEMY_APPLICATIONS);
        expect(apps.length).toBe(3);
    });
});

describe('the memo is dropped by the claim that changes its answer', () => {
    it('A CLAIMED APPLICATION IS VISIBLE to the owner-scoped query that follows', async () => {
        /*
         *   The status check claims by email and writes `userId`. Everything
         *   after it in the same request must see a set that includes the row
         *   it just adopted — otherwise the payment check, running on the same
         *   page, reads the learner as having no application at all.
         */
        store.seed(COLLECTIONS.ACADEMY_APPLICATIONS, 'app-mine', {
            paymentStatus: 'completed',
            personalInfo: { email: EMAIL },
            submittedAt: '2026-01-01T00:00:00.000Z',
        });
        const { applicationsOwnedBy } = await import('@/lib/application-request-reads');
        const { checkAcademyStatusAction } = await academyActions();

        const before = await applicationsOwnedBy(COLLECTIONS.ACADEMY_APPLICATIONS, UID);
        expect(before.empty).toBe(true);

        await checkAcademyStatusAction();

        const after = await applicationsOwnedBy(COLLECTIONS.ACADEMY_APPLICATIONS, UID);
        expect(after.empty).toBe(false);
    });

    it('DOES NOT REMEMBER A FAILURE — one bad read is not the rest of the request', async () => {
        //   These feed a payment wall and a module gate. A remembered rejection
        //   turns one transient error into "has not paid" for every later
        //   caller instead of just the unlucky one.
        const { completedPaymentFor } = await import('@/lib/application-request-reads');
        const { supabaseDb } = await import('@/lib/supabase-db');

        const real = supabaseDb.collection;
        (supabaseDb as any).collection = () => { throw new Error('PostgREST said no'); };
        await expect(completedPaymentFor(UID, 'academy_registration')).rejects.toThrow('PostgREST said no');
        (supabaseDb as any).collection = real;

        await expect(completedPaymentFor(UID, 'academy_registration')).resolves.toMatchObject({ empty: true });
    });
});
