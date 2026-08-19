/**
 * @jest-environment node
 */

/**
 * The Academy registration payment, EXECUTED — initiate, verify, and the status
 * check the whole onboarding flow branches on.
 *
 * At 23.9%. This is money: a verified payment grants `academy_participant`,
 * sets `isVerified`, auto-approves the application and writes a ledger row. Two
 * findings live here and both are about the amount:
 *
 *   #53  This path had NO amount validation at all. It read the Paystack
 *        amount, wrote it as paymentAmount, marked the registration completed
 *        and granted the role — without ever comparing what was paid against
 *        what the plan costs. The WEBHOOK has always derived the fee from the
 *        plan and thrown on underpayment, and the two race by design (the
 *        webhook usually finishes before the user is redirected back). So which
 *        one reached a payment first decided whether an underpaid registration
 *        was accepted.
 *
 *        The initiate side had the mirror problem: an unrecognised plan fell
 *        through to the Foundation FEE while storing the unrecognised STRING in
 *        the Paystack metadata, so a registration could be charged ₦45,000 and
 *        carry a plan no fee lookup answers. `plan` is a "use server" parameter,
 *        so its declared type constrains nothing.
 *
 * Both are asserted here plan by plan, against real fees.
 *
 * WHAT IS MOCKED
 * --------------
 * Paystack (a network call) and claimPaymentOnce (a Postgres CAS the fake
 * deliberately does not implement — see KNOWN_DIVERGENCES; whether it actually
 * serialises is proven in src/__tests__/pg/). Everything the ACTION decides
 * runs for real, including the fee table and the plan normalisation.
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';
import { resetFallbackLimit, peekFallbackCount } from '@/lib/rate-limiter-fallback';

jest.mock('@/lib/redis', () => ({
    getCached: async () => null,
    setCache: async () => undefined,
    deleteCache: async () => undefined,
    redis: null,
}));

jest.mock('@/lib/auth', () => ({
    auth: async () => null,
    signIn: async () => undefined,
    signOut: async () => undefined,
    handlers: {},
}));

const initializePaystackPayment = jest.fn(
    async (_email: string, _amount: number, _meta: Record<string, unknown>, _cb: string) =>
        ({ authorizationUrl: 'https://paystack.test/pay/abc', reference: 'PSK-REF-1' }));
const verifyPaystackPayment = jest.fn(async (_ref: string) => ({
    status: true,
    data: {
        status: 'success',
        amount: 4_500_000,
        metadata: { type: 'academy_registration', plan: 'foundation' } as Record<string, unknown>,
    },
}));
jest.mock('@/lib/paystack-server', () => ({
    initializePaystackPayment: (e: string, a: number, m: Record<string, unknown>, c: string) =>
        initializePaystackPayment(e, a, m, c),
    verifyPaystackPayment: (r: string) => verifyPaystackPayment(r),
}));

const claimPaymentOnce = jest.fn(async (_p: unknown) => ({ claimed: true } as { claimed: boolean }));
jest.mock('@/lib/wallet-ledger', () => ({
    claimPaymentOnce: (p: unknown) => claimPaymentOnce(p),
    creditWalletOnce: jest.fn(async () => ({ claimed: true })),
    debitWalletLocked: jest.fn(async () => ({ ok: true })),
}));

jest.mock('@/lib/server-utils', () => ({
    getBaseUrl: async () => 'https://easysalesexport.test',
}));

let store: FakeDbHandle;

const LEARNER = 'learner-1';
const APPS = COLLECTIONS.ACADEMY_APPLICATIONS;
const PAYMENTS = COLLECTIONS.PROCESSED_PAYMENTS;

const FEES = { foundation: 45_000, standard: 90_000, elite: 270_000 } as const;

function actAs(id: string | null, email = 'ada@example.com'): void {
    (globalThis as {
        mockRequireSession: { mockImplementation: (f: () => unknown) => void };
    }).mockRequireSession.mockImplementation(() => Promise.resolve(
        id === null
            ? { session: null, error: { error: 'Unauthorized' } }
            : { session: { user: { id, roles: ['user'], email, name: 'Ada Obi' } }, error: null },
    ));
}

/** What Paystack says came back for a reference. */
function paystackSays(amountNaira: number, metadata: Record<string, unknown>, ok = true): void {
    verifyPaystackPayment.mockImplementation(async () => ({
        status: true,
        data: {
            status: ok ? 'success' : 'abandoned',
            amount: Math.round(amountNaira * 100),
            metadata,
        },
    }));
}

beforeEach(() => {
    jest.clearAllMocks();
    process.env.PAYSTACK_SECRET_KEY = 'sk_test_key';
    initializePaystackPayment.mockImplementation(async () =>
        ({ authorizationUrl: 'https://paystack.test/pay/abc', reference: 'PSK-REF-1' }));
    claimPaymentOnce.mockImplementation(async () => ({ claimed: true }));
    paystackSays(FEES.foundation, { type: 'academy_registration', plan: 'foundation' });
    store = installFakeDb();
    actAs(LEARNER);
});

async function actions() {
    return import('@/app/actions/academy/_payment');
}

function seedUser(extra: Record<string, unknown> = {}): void {
    store.seed(COLLECTIONS.USERS, LEARNER, {
        email: 'ada@example.com',
        fullName: 'Ada Obi',
        roles: ['general_user'],
        ...extra,
    });
}

const readUser = () => store.get(COLLECTIONS.USERS, LEARNER) as Record<string, any>;
const reg = () => readUser().serviceRegistrations?.academy ?? {};

const initiate = async (plan: any) =>
    (await (await actions()).initiateAcademyPaymentAction(plan)) as any;
const verify = async (ref = 'PSK-REF-1') =>
    (await (await actions()).verifyAcademyPaymentAction(ref)) as any;
const paymentStatus = async () =>
    (await (await actions()).checkAcademyPaymentStatusAction()) as any;

/** The amount and metadata handed to Paystack on the last initiate. */
const lastCharge = () => {
    const [, amountKobo, metadata] = initializePaystackPayment.mock.calls[0] as
        [string, number, Record<string, unknown>, string];
    return { naira: amountKobo / 100, metadata };
};

// ─────────────────────────────────────────────────────────────────────────────
describe('initiateAcademyPaymentAction', () => {
    it('refuses a caller with no session', async () => {
        actAs(null);
        expect(await initiate('foundation')).toMatchObject({ success: false });
        expect(initializePaystackPayment).not.toHaveBeenCalled();
    });

    it('refuses when Paystack is not configured', async () => {
        delete process.env.PAYSTACK_SECRET_KEY;
        seedUser();

        expect(await initiate('foundation')).toMatchObject({
            success: false, error: 'Payment system not configured',
        });
    });

    it.each(['foundation', 'standard', 'elite'] as const)(
        'charges the %s fee and records the SAME plan', async (plan) => {
            seedUser();
            expect(await initiate(plan)).toMatchObject({ success: true });

            const { naira, metadata } = lastCharge();
            expect(naira).toBe(FEES[plan]);
            expect(metadata.plan).toBe(plan);
            expect(metadata.type).toBe('academy_registration');
            expect(metadata.userId).toBe(LEARNER);
        });

    it('NORMALISES an unrecognised plan rather than charging one and storing another', async () => {
        // `plan` is a "use server" parameter, so its declared type constrains
        // nothing. The if/else chain fell through to the Foundation FEE while
        // storing the unrecognised STRING in the metadata — so the registration
        // was charged ₦45,000 and carried a plan no fee lookup answers, which is
        // exactly what the verify side later compares against.
        seedUser();
        await initiate('premium-gold' as any);

        const { naira, metadata } = lastCharge();
        expect(naira).toBe(FEES.foundation);
        expect(metadata.plan).toBe('foundation');
    });

    it('and the amount charged always matches the plan stored, for any input', async () => {
        seedUser();
        for (const input of ['ELITE', ' standard ', null, undefined, 42, '']) {
            initializePaystackPayment.mockClear();
            await initiate(input as any);

            const { naira, metadata } = lastCharge();
            expect(naira).toBe(FEES[metadata.plan as keyof typeof FEES]);
        }
    });

    it('sends the learner straight on when they have already paid', async () => {
        seedUser({ serviceRegistrations: { academy: { paymentStatus: 'completed' } } });

        expect(await initiate('elite')).toMatchObject({
            success: true, data: { paymentUrl: '/academy/application' },
        });
        expect(initializePaystackPayment).not.toHaveBeenCalled();
    });

    it('returns the Paystack authorization URL', async () => {
        seedUser();
        expect(((await initiate('foundation')) as any).data.paymentUrl)
            .toBe('https://paystack.test/pay/abc');
    });

    it('reports a failure rather than throwing when Paystack does', async () => {
        seedUser();
        initializePaystackPayment.mockImplementation(async () => { throw new Error('gateway down'); });

        expect(await initiate('foundation')).toMatchObject({ success: false, error: 'gateway down' });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('verifyAcademyPaymentAction — the amount', () => {
    beforeEach(() => { seedUser(); });

    it('refuses a caller with no session', async () => {
        actAs(null);
        expect(await verify()).toMatchObject({ success: false });
        expect(claimPaymentOnce).not.toHaveBeenCalled();
    });

    it('refuses a payment Paystack did not confirm', async () => {
        paystackSays(FEES.foundation, { type: 'academy_registration', plan: 'foundation' }, false);

        expect(await verify()).toMatchObject({
            success: false, error: 'Payment verification failed',
        });
        expect(claimPaymentOnce).not.toHaveBeenCalled();
    });

    it('refuses a payment for something other than an academy registration', async () => {
        paystackSays(FEES.foundation, { type: 'cooperative_membership_registration' });

        expect(await verify()).toMatchObject({ success: false, error: 'Invalid payment type' });
        expect(claimPaymentOnce).not.toHaveBeenCalled();
    });

    it('accepts a purpose where the type is absent', async () => {
        paystackSays(FEES.foundation, { purpose: 'academy_registration', plan: 'foundation' });
        expect(await verify()).toMatchObject({ success: true });
    });

    it.each(['foundation', 'standard', 'elite'] as const)(
        'REFUSES an underpaid %s registration', async (plan) => {
            // The webhook has always thrown on underpayment; this path had no
            // amount check at all, and the two race by design. Which one reached
            // the payment first decided whether it was accepted.
            paystackSays(FEES[plan] - 1_000, { type: 'academy_registration', plan });

            const res = await verify();
            expect(res.success).toBe(false);
            expect(res.error).toContain('less than');
            expect(claimPaymentOnce).not.toHaveBeenCalled();
            expect(reg().paymentStatus).toBeUndefined();
            expect(readUser().roles).not.toContain('academy_participant');
        });

    it('tolerates exactly one naira of rounding slack, and not two', async () => {
        // ACADEMY_AMOUNT_TOLERANCE is a naira, matching what the webhook already
        // allowed. Pinned in both directions so the slack cannot be widened into
        // a discount by accident.
        paystackSays(FEES.elite - 1, { type: 'academy_registration', plan: 'elite' });
        expect(await verify()).toMatchObject({ success: true });

        store = installFakeDb();
        seedUser();
        claimPaymentOnce.mockClear();
        paystackSays(FEES.elite - 2, { type: 'academy_registration', plan: 'elite' });
        expect(((await verify()) as any).success).toBe(false);
    });

    it('refuses the FOUNDATION fee paid for an ELITE plan', async () => {
        // The shape that matters commercially: the cheap plan's price, the
        // expensive plan's access.
        paystackSays(FEES.foundation, { type: 'academy_registration', plan: 'elite' });

        expect(((await verify()) as any).success).toBe(false);
        expect(claimPaymentOnce).not.toHaveBeenCalled();
    });

    it('refuses an unreadable amount', async () => {
        paystackSays(0, { type: 'academy_registration', plan: 'foundation' });
        expect(((await verify()) as any).success).toBe(false);
    });

    it.each(['foundation', 'standard', 'elite'] as const)(
        'ACCEPTS the exact %s fee — the refusals are not vacuous', async (plan) => {
            paystackSays(FEES[plan], { type: 'academy_registration', plan });
            expect(await verify()).toMatchObject({ success: true });
        });

    it('accepts an overpayment', async () => {
        paystackSays(FEES.foundation + 5_000, { type: 'academy_registration', plan: 'foundation' });
        expect(await verify()).toMatchObject({ success: true });
    });

    it('treats an unrecognised plan in the metadata as the default, and prices it so', async () => {
        // A record carrying "registration" matches no plan lookup, so the fee it
        // was meant to cover cannot be determined afterwards.
        paystackSays(FEES.foundation, { type: 'academy_registration', plan: 'registration' });

        expect(await verify()).toMatchObject({ success: true });
        expect(reg().plan).toBe('foundation');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('verifyAcademyPaymentAction — what a confirmed payment does', () => {
    beforeEach(() => { seedUser(); });

    it('records the payment on the registration without approving anyone who has not applied', async () => {
        paystackSays(FEES.standard, { type: 'academy_registration', plan: 'standard' });

        expect(await verify()).toMatchObject({ success: true });

        expect(reg()).toMatchObject({
            paymentStatus: 'completed',
            paymentReference: 'PSK-REF-1',
            paymentAmount: FEES.standard,
            plan: 'standard',
            status: 'pending',
        });
        expect(readUser().roles).not.toContain('academy_participant');
    });

    it('AUTO-APPROVES a learner who already applied, granting the role', async () => {
        store.seed(APPS, 'app-1', {
            userId: LEARNER, status: 'pending', submittedAt: '2026-01-01T00:00:00.000Z',
        });
        paystackSays(FEES.elite, { type: 'academy_registration', plan: 'elite' });

        expect(await verify()).toMatchObject({ success: true });

        expect(reg()).toMatchObject({ status: 'approved', applicationId: 'app-1', plan: 'elite' });
        expect(readUser().roles).toContain('academy_participant');
        expect(readUser().isVerified).toBe(true);

        expect(store.get(APPS, 'app-1')).toMatchObject({
            status: 'approved', paymentStatus: 'completed',
            paymentAmount: FEES.elite, plan: 'elite',
            reviewedBy: 'paystack_auto_approval',
        });
    });

    it('approves the MOST RECENT application when there are several', async () => {
        store.seedAll(APPS, {
            old: { userId: LEARNER, status: 'rejected', submittedAt: '2025-01-01T00:00:00.000Z' },
            recent: { userId: LEARNER, status: 'pending', submittedAt: '2026-06-01T00:00:00.000Z' },
        });

        await verify();

        expect(store.get(APPS, 'recent')!.status).toBe('approved');
        expect(store.get(APPS, 'old')!.status).toBe('rejected');
    });

    it('never touches another learner\'s application', async () => {
        store.seed(APPS, 'theirs', {
            userId: 'someone-else', status: 'pending', submittedAt: '2026-01-01T00:00:00.000Z',
        });

        await verify();

        expect(store.get(APPS, 'theirs')!.status).toBe('pending');
        expect(reg().status).toBe('pending');
    });

    it('writes ONE ledger row, keyed by the reference', async () => {
        await verify();

        const tx = store.get(COLLECTIONS.TRANSACTIONS, 'PSK-REF-1')!;
        expect(tx).toMatchObject({
            userId: LEARNER, type: 'academy_registration', module: 'academy',
            amount: FEES.foundation, currency: 'NGN', status: 'completed',
            reference: 'PSK-REF-1',
        });
    });

    it('CLAIMS the payment once, and does nothing when the claim is refused', async () => {
        // The re-read this replaced was labelled "Another concurrent call
        // processed it" and addressed no concurrency at all: it took no lock and
        // the marker was written after the work, so two concurrent calls both
        // saw an absent row, both fulfilled, and the user was granted the role
        // twice under one reference.
        claimPaymentOnce.mockImplementation(async () => ({ claimed: false }));

        expect(await verify()).toMatchObject({ success: true });

        expect(reg().paymentStatus).toBeUndefined();
        expect(store.size(COLLECTIONS.TRANSACTIONS)).toBe(0);
    });

    it('passes the resolved plan and the real amount to the claim', async () => {
        paystackSays(FEES.elite, { type: 'academy_registration', plan: 'ELITE' });
        await verify();

        expect((claimPaymentOnce.mock.calls[0] as any[])[0]).toMatchObject({
            reference: 'PSK-REF-1', userId: LEARNER, amount: FEES.elite,
            type: 'academy_registration', source: 'client_verify',
            metadata: { plan: 'elite' },
        });
    });

    it('SYNCS the user record when the webhook got there first, without re-claiming', async () => {
        // The webhook fires before the user is redirected back on a fast
        // connection. The early return used to skip the user write, so every
        // future login fell through to the slow processed_payments query.
        store.seed(PAYMENTS, 'PSK-REF-1', {
            userId: LEARNER, type: 'academy_registration', status: 'completed',
        });
        paystackSays(FEES.elite, { type: 'academy_registration', plan: 'elite' });

        expect(await verify()).toMatchObject({ success: true });

        expect(reg()).toMatchObject({
            paymentStatus: 'completed', paymentReference: 'PSK-REF-1',
            paymentAmount: FEES.elite, plan: 'elite',
        });
        expect(claimPaymentOnce).not.toHaveBeenCalled();
    });

    it('and writes the plan from the PAYSTACK response, not from the processed row', async () => {
        // processed_payments is a DEDICATED table and the plan was passed as
        // `metadata: { plan }`, so it lives in raw_data rather than a column —
        // `processedData?.plan` was undefined and this wrote `plan: null` over a
        // registration that had one.
        store.seed(PAYMENTS, 'PSK-REF-1', {
            userId: LEARNER, type: 'academy_registration', status: 'completed',
        });
        paystackSays(FEES.standard, { type: 'academy_registration', plan: 'standard' });

        await verify();

        expect(reg().plan).toBe('standard');
        expect(reg().plan).not.toBeNull();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('checkAcademyPaymentStatusAction', () => {
    it('is "unpaid" for a caller with no session', async () => {
        actAs(null);
        expect(await paymentStatus()).toMatchObject({ success: false });
    });

    it('is "unpaid" for somebody who has done nothing', async () => {
        seedUser();
        expect(((await paymentStatus()) as any).data).toBe('unpaid');
    });

    it('reads the registration first', async () => {
        seedUser({ serviceRegistrations: { academy: { paymentStatus: 'completed' } } });
        expect(((await paymentStatus()) as any).data).toBe('paid');
    });

    it('treats a legacy-onboarded member as paid', async () => {
        seedUser({ legacyOnboardedBy: 'admin-1' });
        expect(((await paymentStatus()) as any).data).toBe('paid');
    });

    it('FALLBACK 1: a completed processed payment', async () => {
        seedUser();
        store.seed(PAYMENTS, 'p1', {
            userId: LEARNER, type: 'academy_registration', status: 'completed',
        });

        expect(((await paymentStatus()) as any).data).toBe('paid');
    });

    it('and ignores one of the wrong type or an incomplete one', async () => {
        seedUser();
        store.seedAll(PAYMENTS, {
            wrongType: { userId: LEARNER, type: 'cooperative_membership_registration', status: 'completed' },
            incomplete: { userId: LEARNER, type: 'academy_registration', status: 'pending' },
        });

        expect(((await paymentStatus()) as any).data).toBe('unpaid');
    });

    it('FALLBACK 2: an application of their own that is marked paid', async () => {
        seedUser();
        store.seed(APPS, 'app-1', { userId: LEARNER, paymentStatus: 'completed' });

        expect(((await paymentStatus()) as any).data).toBe('paid');
    });

    it('and stays unpaid when their own application is not', async () => {
        seedUser();
        store.seed(APPS, 'app-1', { userId: LEARNER, paymentStatus: 'pending' });

        expect(((await paymentStatus()) as any).data).toBe('unpaid');
    });

    it('FALLBACK 3: an application matched on the LOWERCASED email, when they have none by id', async () => {
        // This is one of the three lookups that made the application email
        // lowercasing load-bearing: an applicant who typed a capital was
        // invisible to it.
        seedUser({ email: 'Ada@Example.com' });
        store.seed(APPS, 'app-1', {
            userId: 'a-different-record', paymentStatus: 'completed',
            personalInfo: { email: 'ada@example.com' },
        });

        expect(((await paymentStatus()) as any).data).toBe('paid');
    });

    it('does NOT reach the email fallback when they already have an application of their own', async () => {
        seedUser({ email: 'ada@example.com' });
        store.seed(APPS, 'mine', { userId: LEARNER, paymentStatus: 'pending' });
        store.seed(APPS, 'other', {
            userId: 'somebody', paymentStatus: 'completed',
            personalInfo: { email: 'ada@example.com' },
        });

        expect(((await paymentStatus()) as any).data).toBe('unpaid');
    });

    it('never reports "paid" from another learner\'s completed payment', async () => {
        // Every fallback here is a lookup by identity, and this is the shape
        // that turns one into an entitlement leak.
        seedUser();
        store.seedAll(PAYMENTS, {
            theirs: { userId: 'somebody-else', type: 'academy_registration', status: 'completed' },
        });
        store.seed(APPS, 'theirs', { userId: 'somebody-else', paymentStatus: 'completed' });

        expect(((await paymentStatus()) as any).data).toBe('unpaid');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the payment bypass account', () => {
    // The literal address is never written outside src/lib/payment-bypass.ts —
    // payment-bypass.test.ts enforces that — so the env override stands in for
    // it. What is under test is the bypass MECHANISM, not who is on the list.
    const BYPASS = 'owner-bypass@example.test';

    beforeEach(() => { process.env.PAYMENT_BYPASS_EMAILS = BYPASS; });
    afterEach(() => { delete process.env.PAYMENT_BYPASS_EMAILS; });

    it('is granted the elite plan without a Paystack call', async () => {
        actAs(LEARNER, BYPASS);
        seedUser({ email: BYPASS });

        expect(await initiate('foundation')).toMatchObject({
            success: true, data: { paymentUrl: '/academy/dashboard' },
        });
        expect(initializePaystackPayment).not.toHaveBeenCalled();

        expect(reg()).toMatchObject({ status: 'approved', paymentStatus: 'completed', plan: 'elite' });
        expect(readUser().roles).toContain('academy_participant');
    });

    it('and reports paid on the status check, provisioning on the way', async () => {
        actAs(LEARNER, BYPASS);
        seedUser({ email: BYPASS });

        expect(((await paymentStatus()) as any).data).toBe('paid');
        expect(reg().plan).toBe('elite');
    });

    it('does NOT apply to an address that merely resembles one on the list', async () => {
        actAs(LEARNER, 'owner-bypass@example.test.evil.example');
        seedUser({ email: 'owner-bypass@example.test.evil.example' });

        await initiate('foundation');
        expect(initializePaystackPayment).toHaveBeenCalled();
        expect(readUser().roles).not.toContain('academy_participant');
    });

    it('is switched off entirely by an empty PAYMENT_BYPASS_EMAILS', async () => {
        // The documented kill switch. If it does not work there is no way to
        // remove the bypass without a deploy.
        process.env.PAYMENT_BYPASS_EMAILS = '';
        actAs(LEARNER, BYPASS);
        seedUser({ email: BYPASS });

        await initiate('foundation');
        expect(initializePaystackPayment).toHaveBeenCalled();
        expect(readUser().roles).not.toContain('academy_participant');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// COURSE ENROLMENT — the second money path in this file, and the one that
// carried the unreachable underpayment reject.
// ─────────────────────────────────────────────────────────────────────────────
describe('initializeEnrollmentPaymentAction', () => {
    const COURSE = 'course-1';
    const ENROLMENT_ID = `${LEARNER}_${COURSE}`;

    const initEnrol = async (amount = 20_000) =>
        (await (await actions()).initializeEnrollmentPaymentAction(
            COURSE, 'Export Basics', amount, 'Ada Obi', '08030000000')) as any;

    beforeEach(() => { seedUser(); });

    it('refuses a caller with no session', async () => {
        actAs(null);
        expect(await initEnrol()).toMatchObject({ success: false });
        expect(initializePaystackPayment).not.toHaveBeenCalled();
    });

    it('refuses an enrolment fee under ₦1,000', async () => {
        expect(await initEnrol(999)).toMatchObject({ success: false });
        expect(initializePaystackPayment).not.toHaveBeenCalled();
    });

    it('refuses a second enrolment in a course already held', async () => {
        store.seed(COLLECTIONS.ENROLLMENTS, ENROLMENT_ID, { userId: LEARNER, courseId: COURSE, status: 'active' });

        expect(await initEnrol()).toMatchObject({
            success: false, error: 'You are already enrolled in this course',
        });
        expect(initializePaystackPayment).not.toHaveBeenCalled();
    });

    it('sends the learner to the callback with flow=enrollment', async () => {
        // /academy/verify-payment is not a page: paying for a course used to
        // charge the learner and drop them on a 404, and the webhook has no
        // academy_enrollment case, so nothing else could enrol them. The
        // callback page defaults to the REGISTRATION verifier, which would
        // refuse this payment as the wrong type — hence the query parameter.
        expect(await initEnrol()).toMatchObject({ success: true });

        const [, , metadata, callback] = initializePaystackPayment.mock.calls[0] as
            [string, number, Record<string, unknown>, string];
        expect(callback).toBe('https://easysalesexport.test/academy/payment/callback?flow=enrollment');
        expect(metadata.callback_url).toBe(callback);
        expect(metadata.type).toBe('academy_enrollment');
        expect(metadata.courseId).toBe(COURSE);
        expect(metadata.userId).toBe(LEARNER);
    });

    it('records a pending enrolment carrying the reference', async () => {
        await initEnrol(20_000);

        expect(store.get(COLLECTIONS.ENROLLMENTS, ENROLMENT_ID)).toMatchObject({
            userId: LEARNER, courseId: COURSE, amount: 20_000,
            paymentReference: 'PSK-REF-1', status: 'pending_payment', progress: 0,
        });
    });
});

describe('verifyEnrollmentPaymentAction', () => {
    const COURSE = 'course-1';
    const ENROLMENT_ID = `${LEARNER}_${COURSE}`;
    const PRICE = 20_000;

    const verifyEnrol = async (ref = 'PSK-REF-1') =>
        (await (await actions()).verifyEnrollmentPaymentAction(ref)) as any;

    const paidForCourse = (naira: number, over: Record<string, unknown> = {}) =>
        paystackSays(naira, {
            type: 'academy_enrollment', userId: LEARNER, courseId: COURSE,
            courseTitle: 'Export Basics', ...over,
        });

    const enrolment = () => store.get(COLLECTIONS.ENROLLMENTS, ENROLMENT_ID) as Record<string, any>;
    const mirror = () => store.get(COLLECTIONS.ACADEMY_ENROLLMENTS, ENROLMENT_ID) as Record<string, any>;

    beforeEach(() => {
        // The payment limiter is 10 per minute per user and its in-memory
        // fallback is module state, so without this the tail of this block
        // would be measuring the rate limit instead of the action. It is
        // asserted on purpose in the test below.
        resetFallbackLimit(`payment:${LEARNER}`);
        seedUser();
        store.seed(COLLECTIONS.ACADEMY_COURSES, COURSE, {
            title: 'Export Basics', price: PRICE, students: 7,
        });
        store.seed(COLLECTIONS.ENROLLMENTS, ENROLMENT_ID, {
            userId: LEARNER, courseId: COURSE, status: 'pending_payment',
            paymentReference: 'PSK-REF-1', amount: PRICE,
        });
        paidForCourse(PRICE);
    });

    it('refuses a caller with no session', async () => {
        actAs(null);
        expect(await verifyEnrol()).toMatchObject({ success: false });
        expect(claimPaymentOnce).not.toHaveBeenCalled();
    });

    it('refuses a Paystack transaction that did not succeed', async () => {
        paystackSays(PRICE, { type: 'academy_enrollment', userId: LEARNER, courseId: COURSE }, false);

        expect(await verifyEnrol()).toMatchObject({ success: false });
        expect(claimPaymentOnce).not.toHaveBeenCalled();
        expect(enrolment().status).toBe('pending_payment');
    });

    it('refuses a payment whose metadata names a DIFFERENT user', async () => {
        // Otherwise the reference is the only credential: anybody holding one
        // could enrol themselves on somebody else's payment.
        paidForCourse(PRICE, { userId: 'somebody-else' });

        expect(await verifyEnrol()).toMatchObject({
            success: false, error: 'Payment verification failed: User mismatch',
        });
        expect(claimPaymentOnce).not.toHaveBeenCalled();
    });

    it('refuses when the course no longer exists', async () => {
        paidForCourse(PRICE, { courseId: 'deleted-course' });

        expect(await verifyEnrol()).toMatchObject({ success: false });
        expect(claimPaymentOnce).not.toHaveBeenCalled();
    });

    it('REFUSES a ₦50 shortfall — the reject that used to be unreachable', async () => {
        // The check was nested:
        //     if (Math.abs(paid - expected) > 50) { if (paid < expected) reject }
        // so no shortfall of ₦50 or less could ever reach the reject. Paying
        // ₦50 under the price was accepted silently, on every course.
        paidForCourse(PRICE - 50);

        const res = await verifyEnrol();
        expect(res.success).toBe(false);
        expect(res.error).toContain('does not match current course price');
        expect(claimPaymentOnce).not.toHaveBeenCalled();
        expect(enrolment().status).toBe('pending_payment');
    });

    it('and refuses a ₦2 shortfall, and a large one', async () => {
        for (const paid of [PRICE - 2, PRICE - 5_000]) {
            store.seed(COLLECTIONS.ENROLLMENTS, ENROLMENT_ID, {
                userId: LEARNER, courseId: COURSE, status: 'pending_payment',
            });
            paidForCourse(paid);
            expect(((await verifyEnrol()) as any).success).toBe(false);
            expect(enrolment().status).toBe('pending_payment');
        }
    });

    it('ACCEPTS overpayment rather than stranding a learner who has been charged', async () => {
        paidForCourse(PRICE + 5_000);

        expect(await verifyEnrol()).toMatchObject({ success: true });
        expect(enrolment().status).toBe('active');
    });

    it('enrols on the exact price — the refusals are not vacuous', async () => {
        expect(await verifyEnrol()).toMatchObject({ success: true });

        expect(enrolment()).toMatchObject({ status: 'active', paymentStatus: 'completed' });
        expect(claimPaymentOnce).toHaveBeenCalledWith(expect.objectContaining({
            reference: 'PSK-REF-1', userId: LEARNER, amount: PRICE, type: 'academy_enrollment',
        }));
    });

    it('writes the ADMIN mirror as well as the learner-facing enrolment', async () => {
        // The duplicate branch wrote ACADEMY_ENROLLMENTS while the primary
        // branch updated ENROLLMENTS — different tables. The admin enrolments
        // report and the platform metrics read the mirror, so the only
        // enrolments they could see were the ones produced by a DUPLICATE
        // delivery: the recovery branch was healing the table the admin reads,
        // and the path that actually enrols somebody wrote elsewhere.
        await verifyEnrol();

        expect(mirror()).toMatchObject({
            userId: LEARNER, courseId: COURSE, courseTitle: 'Export Basics',
            status: 'active', paymentStatus: 'completed', amount: PRICE,
        });
    });

    it('counts the new student with an increment, not a read-modify-write', async () => {
        // Two enrolments landing together both read the same count and the
        // second overwrote the first, so a course silently lost a student.
        await verifyEnrol();
        expect(store.get(COLLECTIONS.ACADEMY_COURSES, COURSE)?.students).toBe(8);
    });

    it('a duplicate delivery reports success and syncs BOTH tables', async () => {
        claimPaymentOnce.mockImplementation(async () => ({ claimed: false }));

        expect(await verifyEnrol()).toMatchObject({ success: true });

        expect(enrolment()).toMatchObject({ status: 'active', paymentStatus: 'completed' });
        expect(mirror()).toMatchObject({ status: 'active', paymentStatus: 'completed' });
    });

    it('and a duplicate does not count the student twice', async () => {
        claimPaymentOnce.mockImplementation(async () => ({ claimed: false }));
        await verifyEnrol();

        expect(store.get(COLLECTIONS.ACADEMY_COURSES, COURSE)?.students).toBe(7);
    });

    it('is rate limited to ten verifications a minute, in its OWN key space', async () => {
        // Eight rate-limit configs used to share one Redis key namespace, so a
        // payment burst consumed the withdrawal budget and vice versa. The name
        // is now part of the key; this pins both halves — the limit bites, and
        // it bites only its own bucket.
        for (let i = 0; i < 10; i++) expect((await verifyEnrol()).success).toBe(true);

        const refused = await verifyEnrol();
        expect(refused.success).toBe(false);
        expect(refused.error).toContain('Too many payment verification attempts');

        // And the withdrawal bucket for the same member never moved: eleven
        // payment verifications did not spend any of their access to their own
        // money, which is exactly what the shared namespace used to do.
        expect(peekFallbackCount(`withdrawal:${LEARNER}`)).toBe(0);
    });

    it('claims the payment BEFORE fulfilling, not after', async () => {
        // The original marker was the write half of a check-then-write whose
        // read ran ~60 lines earlier, so the webhook and this callback could
        // both pass the read and both fulfil.
        let studentsWhenClaimed: number | undefined;
        claimPaymentOnce.mockImplementation(async () => {
            studentsWhenClaimed = store.get(COLLECTIONS.ACADEMY_COURSES, COURSE)?.students as number;
            return { claimed: true };
        });

        await verifyEnrol();
        expect(studentsWhenClaimed).toBe(7);
    });
});
