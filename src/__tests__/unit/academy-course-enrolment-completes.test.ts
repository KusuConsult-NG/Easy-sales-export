/**
 * @jest-environment node
 */

/**
 * _ac_course_payment.ts was at 17.7%, and the existing suite for it reads its
 * SOURCE. This one runs it.
 *
 *   #258 A CLAIMED PAYMENT WITH A FAILED ENROLMENT WAS PERMANENT.
 *
 * Everything about the action except Paystack and claimPaymentOnce runs for
 * real — the price re-validation, the buyer check, the enrolment write. Those
 * two are mocked for the reasons the academy payment suite already records:
 * Paystack is a network call, and claimPaymentOnce is a Postgres CAS the fake
 * deliberately does not implement (whether it really serialises is proven in
 * src/__tests__/pg/).
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

jest.mock('@/lib/redis', () => ({
    getCached: async () => null, setCache: async () => undefined,
    deleteCache: async () => undefined, deleteCachePattern: async () => undefined, redis: null,
}));

jest.mock('next/cache', () => ({
    unstable_cache: (fn: unknown) => fn,
    revalidateTag: jest.fn(), updateTag: jest.fn(), revalidatePath: jest.fn(),
}));

jest.mock('@/lib/audit-log', () => ({
    recordAdminAction: (p: any) => (global as any).mockRecordAdminAction(p),
    createAdminAuditLog: jest.fn(async () => ({})),
    logAdminAction: jest.fn(async () => ({})),
}));

jest.mock('@/lib/server-utils', () => ({ getBaseUrl: async () => 'https://easysalesexport.test' }));

const verifyPaystackPayment = jest.fn() as jest.Mock<any>;
const initializePaystackPayment = jest.fn(async () => ({ authorization_url: 'https://pay.test/x' }));
jest.mock('@/lib/paystack-server', () => ({
    verifyPaystackPayment: (r: string) => verifyPaystackPayment(r),
    initializePaystackPayment: (...a: any[]) => initializePaystackPayment(...a as []),
}));

const claimPaymentOnce = jest.fn(async (_p: unknown) => ({ claimed: true } as { claimed: boolean }));
jest.mock('@/lib/wallet-ledger', () => ({
    claimPaymentOnce: (p: unknown) => claimPaymentOnce(p),
    creditWalletOnce: jest.fn(async () => ({ claimed: true })),
    debitWalletLocked: jest.fn(async () => ({ ok: true })),
}));

const mockRequireSession = jest.fn() as jest.Mock<any>;
jest.mock('@/lib/session-guard', () => ({
    requireSession: (...a: any[]) => mockRequireSession(...a),
}));

const LEARNER = 'learner-1';
const COURSE = 'course-1';
const PRICE = 25_000;
const REF = 'PSK_REF_1';

let store: FakeDbHandle;

const actions = async () => await import('@/app/actions/academy/_ac_course_payment');

/** What Paystack says about the reference. */
function paystackSays(amountNaira: number, metadata: Record<string, unknown>) {
    verifyPaystackPayment.mockResolvedValue({
        status: true,
        data: { status: 'success', amount: amountNaira * 100, metadata },
    });
}

/** Where the learner's progress lives — the document the enrolment writes. */
const progress = () => store.get(`user_progress/${LEARNER}/courses`, COURSE);

beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    store = installFakeDb();

    store.seed(COLLECTIONS.ACADEMY_COURSES, COURSE, {
        id: COURSE, title: 'Export Fundamentals', price: PRICE,
    });

    mockRequireSession.mockResolvedValue({
        session: { user: { id: LEARNER, email: 'l@e.test', roles: ['general_user'] } },
        error: null,
    });

    claimPaymentOnce.mockImplementation(async () => ({ claimed: true }));
    paystackSays(PRICE, { type: 'academy_enrollment', courseId: COURSE, userId: LEARNER });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the ordinary purchase', () => {
    it('enrols the learner', async () => {
        const res = await (await actions()).verifyCoursePaymentAction(REF) as any;

        expect(res.success).toBe(true);
        expect(progress()).toBeTruthy();
        expect(progress()!.courseId).toBe(COURSE);
        expect(progress()!.overallProgress).toBe(0);
    });

    it('claims the payment before enrolling, with the course on the claim', async () => {
        await (await actions()).verifyCoursePaymentAction(REF);

        expect(claimPaymentOnce).toHaveBeenCalledWith(expect.objectContaining({
            reference: REF, userId: LEARNER, amount: PRICE,
            metadata: expect.objectContaining({ courseId: COURSE }),
        }));
    });

    it('refuses a reference belonging to someone else', async () => {
        paystackSays(PRICE, { type: 'academy_enrollment', courseId: COURSE, userId: 'somebody-else' });

        const res = await (await actions()).verifyCoursePaymentAction(REF) as any;

        expect(res.success).toBe(false);
        expect(res.error).toMatch(/user mismatch/i);
        expect(claimPaymentOnce).not.toHaveBeenCalled();
        expect(progress()).toBeUndefined();
    });

    it('refuses a payment for a different product', async () => {
        paystackSays(PRICE, { type: 'academy_registration', courseId: COURSE, userId: LEARNER });

        expect(await (await actions()).verifyCoursePaymentAction(REF)).toMatchObject({ success: false });
        expect(claimPaymentOnce).not.toHaveBeenCalled();
    });

    it('refuses a shortfall against the current course price', async () => {
        paystackSays(PRICE - 5_000, { type: 'academy_enrollment', courseId: COURSE, userId: LEARNER });

        const res = await (await actions()).verifyCoursePaymentAction(REF) as any;
        expect(res.success).toBe(false);
        expect(claimPaymentOnce).not.toHaveBeenCalled();
        expect(progress()).toBeUndefined();
    });

    it('accepts a naira of rounding slack, and an overpayment', async () => {
        paystackSays(PRICE - 0.5, { type: 'academy_enrollment', courseId: COURSE, userId: LEARNER });
        expect(await (await actions()).verifyCoursePaymentAction(REF)).toMatchObject({ success: true });

        jest.clearAllMocks();
        store = installFakeDb();
        store.seed(COLLECTIONS.ACADEMY_COURSES, COURSE, { id: COURSE, price: PRICE });
        claimPaymentOnce.mockImplementation(async () => ({ claimed: true }));
        paystackSays(PRICE + 1_000, { type: 'academy_enrollment', courseId: COURSE, userId: LEARNER });
        expect(await (await actions()).verifyCoursePaymentAction(REF)).toMatchObject({ success: true });
    });

    it('refuses an unauthenticated caller before asking Paystack anything', async () => {
        mockRequireSession.mockResolvedValue({ session: null, error: { error: 'expired' } });

        expect(await (await actions()).verifyCoursePaymentAction(REF)).toMatchObject({ success: false });
        expect(verifyPaystackPayment).not.toHaveBeenCalled();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#258 — a claimed payment whose enrolment did not happen', () => {
    /**
     *   #258 A CLAIMED PAYMENT WITH A FAILED ENROLMENT WAS PERMANENT.
     *
     *        The order here is deliberate and right: claimPaymentOnce runs
     *        BEFORE the enrolment, because writing the marker afterwards let a
     *        duplicate webhook delivery enrol twice. The file carries a comment
     *        saying exactly that.
     *
     *        But it left the opposite hole. If the enrolment write fails — a
     *        transient database error, and Paystack retries webhooks by design
     *        — the payment is already claimed. The catch returns "Failed to
     *        verify payment", the learner or the webhook retries, and on the
     *        retry `claim.claimed` is FALSE, so the action returns:
     *
     *            // A duplicate is a SUCCESS. The learner paid and is enrolled
     *            return { success: true, error: null, data: null };
     *
     *        The learner paid, is told it worked, and is enrolled in nothing.
     *        Permanently: no later call will ever claim that reference again.
     *
     *        The comment's premise — "the learner paid AND IS ENROLLED" — is an
     *        assumption, and it is the assumption that fails. So the duplicate
     *        branch now VERIFIES it rather than asserting it: the enrolment
     *        write is already idempotent (`if (!tProgressDoc.exists)`), so
     *        running it on a duplicate costs nothing when the learner really is
     *        enrolled and repairs them when they are not.
     */
    it('THE RETRY ENROLS THE LEARNER RATHER THAN ASSUMING IT ALREADY HAPPENED', async () => {
        // The reference is claimed — by the earlier attempt whose enrolment died.
        claimPaymentOnce.mockImplementation(async () => ({ claimed: false }));

        const res = await (await actions()).verifyCoursePaymentAction(REF) as any;

        expect(res.success).toBe(true);
        // Was: undefined. Told "success", enrolled in nothing, forever.
        expect(progress()).toBeTruthy();
        expect(progress()!.courseId).toBe(COURSE);
    });

    it('and audits the repair, but not a genuine duplicate', async () => {
        // A webhook retry for a learner already enrolled must not add a second
        // "course_enrolled" row — an audit trail reporting work it did not do
        // is the shape #129 fixed for disputes.
        const { createAdminAuditLog } = await import('@/lib/audit-log');
        claimPaymentOnce.mockImplementation(async () => ({ claimed: false }));

        await (await actions()).verifyCoursePaymentAction(REF);          // repairs
        expect(createAdminAuditLog).toHaveBeenCalledTimes(1);

        jest.clearAllMocks();
        claimPaymentOnce.mockImplementation(async () => ({ claimed: false }));
        await (await actions()).verifyCoursePaymentAction(REF);          // already enrolled
        expect(createAdminAuditLog).not.toHaveBeenCalled();
    });

    it('and does not disturb a learner who IS already enrolled', async () => {
        // The ordinary duplicate — a second webhook delivery. Their existing
        // progress must survive: re-enrolling would reset it to zero.
        store.seed(`user_progress/${LEARNER}/courses`, COURSE, {
            userId: LEARNER, courseId: COURSE, overallProgress: 60,
            completedLessons: ['l1', 'l2'], completedModules: ['m1'], quizScores: { q1: 90 },
        });
        claimPaymentOnce.mockImplementation(async () => ({ claimed: false }));

        const res = await (await actions()).verifyCoursePaymentAction(REF) as any;

        expect(res.success).toBe(true);
        expect(progress()!.overallProgress).toBe(60);
        expect(progress()!.completedLessons).toEqual(['l1', 'l2']);
    });

    it('a duplicate still refuses when the payment was never for this caller', async () => {
        // The repair must not become a way to enrol on somebody else's
        // reference: the buyer check runs before the claim, so it still bites.
        paystackSays(PRICE, { type: 'academy_enrollment', courseId: COURSE, userId: 'somebody-else' });
        claimPaymentOnce.mockImplementation(async () => ({ claimed: false }));

        const res = await (await actions()).verifyCoursePaymentAction(REF) as any;

        expect(res.success).toBe(false);
        expect(progress()).toBeUndefined();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('initializing a course payment', () => {
    it('refuses a free course rather than charging zero', async () => {
        store.seed(COLLECTIONS.ACADEMY_COURSES, 'free-1', { id: 'free-1', price: 0 });

        const res = await (await actions()).initializeCoursePaymentAction('free-1') as any;
        expect(res.success).toBe(false);
        expect(res.error).toMatch(/free/i);
        expect(initializePaystackPayment).not.toHaveBeenCalled();
    });

    it('refuses a course that does not exist', async () => {
        expect(await (await actions()).initializeCoursePaymentAction('nope'))
            .toMatchObject({ success: false });
        expect(initializePaystackPayment).not.toHaveBeenCalled();
    });

    it('charges the course price in kobo and carries the buyer in the metadata', async () => {
        await (await actions()).initializeCoursePaymentAction(COURSE);

        const [email, kobo, metadata] = initializePaystackPayment.mock.calls[0] as unknown as
            [string, number, Record<string, unknown>];
        expect(email).toBe('l@e.test');
        expect(kobo).toBe(PRICE * 100);
        expect(metadata).toMatchObject({ type: 'academy_enrollment', courseId: COURSE, userId: LEARNER });
    });

    it('sends the learner to a callback that exists, with the flow named', async () => {
        // /academy/verify is not a page, and a callback built from an unset
        // NEXT_PUBLIC_APP_URL becomes "undefined/...". Both are why this goes
        // through getBaseUrl and names the flow.
        await (await actions()).initializeCoursePaymentAction(COURSE);

        const [, , , callbackUrl] = initializePaystackPayment.mock.calls[0] as unknown as
            [string, number, unknown, string];
        expect(callbackUrl).toBe('https://easysalesexport.test/academy/payment/callback?flow=course');
    });

    it('refuses an unauthenticated caller', async () => {
        mockRequireSession.mockResolvedValue({ session: null, error: { error: 'expired' } });
        expect(await (await actions()).initializeCoursePaymentAction(COURSE))
            .toMatchObject({ success: false });
        expect(initializePaystackPayment).not.toHaveBeenCalled();
    });
});
