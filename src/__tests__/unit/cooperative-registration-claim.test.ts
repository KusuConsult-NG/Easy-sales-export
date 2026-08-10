/**
 * @jest-environment node
 */

/**
 * Cooperative registration verification — the last unclaimed fulfilment path.
 *
 * WHAT WAS WRONG
 * --------------
 * The client-side half of a payment whose webhook half DOES claim
 * (processCooperativeRegistration -> claimPaymentOnce). This route instead read
 * processed_payments, re-read it inside runTransaction, and wrote the marker
 * afterwards:
 *
 *     const tProcessedDoc = await transaction.get(processedRef);
 *     if (tProcessedDoc.exists) return;          // takes no lock
 *     ...
 *     transaction.set(processedRef, { status: "completed", ... });   // blind set
 *
 * The same client/webhook double-fulfilment already fixed in export, academy and
 * farm-nation, left in place on the cooperative registration path.
 *
 * BE PRECISE ABOUT THE DAMAGE. Nearly every write here is keyed on the reference
 * or the user id, so a concurrent double-run duplicated little and moved no
 * money twice. What it did do is blind-set the processed_payments row that the
 * webhook's claim had written, overwriting claimedAt — the only evidence the
 * webhook ran, and the signal currently being used to investigate whether it
 * fires at all. PR #58 stopped the webhook overwriting rows its handlers claim;
 * this is the same mistake from the other side.
 *
 * See docs/audit/integrity-sweep-2026-08-10.md (F3).
 */

import { describe, it, expect, beforeEach, afterAll, jest } from '@jest/globals';

const mockClaim = jest.fn() as jest.Mock<any>;

jest.mock('@/lib/wallet-ledger', () => ({
    claimPaymentOnce: (...args: any[]) => mockClaim(...args),
    creditWalletOnce: jest.fn(),
    debitWalletOnce: jest.fn(),
    debitWalletLocked: jest.fn(),
    debitJsonbBalance: jest.fn(),
    incrementWithinCeiling: jest.fn(),
    decrementManyOrFail: jest.fn(),
}));

jest.mock('@/lib/rate-limiter', () => ({
    rateLimit: () => ({ check: () => Promise.resolve({ success: true }) }),
    getClientIp: () => '127.0.0.1',
    createRateLimitResponse: () => ({ status: 429 }),
}));

jest.mock('@/lib/schema-normalizer', () => ({
    normalizeUserDoc: (d: any) => d,
}));

const REFERENCE = 'COOP-REF-1';
const originalFetch = global.fetch;
const originalKey = process.env.PAYSTACK_SECRET_KEY;

/** Paystack says the payment succeeded, for the full ₦10,000 registration fee. */
function paystackSaysPaid(amountNaira = 10_000) {
    (global as any).fetch = jest.fn(() => Promise.resolve({
        ok: true,
        json: async () => ({ status: true, data: { status: 'success', amount: amountNaira * 100 } }),
    })) as any;
}

function setSession(id: string) {
    (global as any).mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id, name: id, email: `${id}@example.com`, roles: ['user'] } },
        error: null,
    }));
}

/** A membership that has NOT yet been paid, so the fast path does not fire. */
function setMembership(data: Record<string, any> = {}) {
    const snap = {
        exists: true,
        docs: [],
        empty: true,
        data: () => ({ userId: 'member-1', onboardingCompleted: false, ...data }),
    };
    (global as any).mockFirestoreGet.mockImplementation(() => Promise.resolve(snap));
    (global as any).mockFirestoreTxGet.mockImplementation(() => Promise.resolve(snap));
}

function touched(name: string) {
    return ((global as any).mockFirestoreCollection.mock.calls as any[])
        .some(([n]) => n === name);
}

async function post(body: Record<string, any> = { reference: REFERENCE }) {
    const { POST } = await import('@/app/api/cooperative/verify-payment/route');
    return POST({ json: async () => body } as any);
}

describe('api/cooperative/verify-payment', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        process.env.PAYSTACK_SECRET_KEY = 'sk_test_x';
        setSession('member-1');
        setMembership();
        paystackSaysPaid();
        mockClaim.mockResolvedValue({ claimed: true, status: 'completed' });
    });

    afterAll(() => {
        global.fetch = originalFetch;
        process.env.PAYSTACK_SECRET_KEY = originalKey;
    });

    it('claims the reference before fulfilling', async () => {
        await post();

        expect(mockClaim).toHaveBeenCalledTimes(1);
        expect(mockClaim).toHaveBeenCalledWith(expect.objectContaining({
            reference: REFERENCE,
            userId: 'member-1',
            amount: 10_000,
            type: 'cooperative_membership_registration',
            source: 'client_verify',
        }));
    });

    it('never touches processed_payments itself', async () => {
        // THE test. The blind set() here overwrote the webhook's claimedAt.
        // claimPaymentOnce owns that row; the route must not write it.
        await post();

        expect(touched('processedPayments')).toBe(false);
    });

    it('claims as revenue — registration is money in', async () => {
        // Rule 4 runs both ways. Four paths in the migration doc must NOT record
        // "completed"; this is not one of them, so the default must be left
        // alone or the fee stops being counted.
        await post();

        const [args] = mockClaim.mock.calls[0] as [any];
        expect(args.status).toBeUndefined();
    });

    it('writes no ledger rows when the claim is lost', async () => {
        // The webhook, or an earlier delivery, already fulfilled. Both ledgers
        // are keyed on the reference so a duplicate would overwrite rather than
        // double — but it must not run at all.
        mockClaim.mockResolvedValue({ claimed: false, status: 'completed' });

        await post();

        expect(touched('transactions')).toBe(false);
        expect(touched('cooperative_transactions')).toBe(false);
    });

    it('reports success when the claim is lost, not failure', async () => {
        // Rule 3: "already processed" is a success. A caller that treats it as
        // failure tells a user who has paid that verification failed.
        mockClaim.mockResolvedValue({ claimed: false, status: 'completed' });

        const res: any = await post();
        const body = await res.json();

        expect(body.success).toBe(true);
        expect(body.alreadyVerified).toBe(true);
    });

    it('still syncs the membership when the claim is lost', async () => {
        // The old pre-check block did two jobs, and this is the second one: a
        // user whose webhook landed first must not be told verification failed.
        // Deleting the block wholesale would have reintroduced that bug while
        // fixing the concurrency one.
        mockClaim.mockResolvedValue({ claimed: false, status: 'completed' });

        await post();

        expect(touched('cooperative_members')).toBe(true);
        expect(touched('users')).toBe(true);
    });

    it('does not claim a payment Paystack has not confirmed', async () => {
        (global as any).fetch = jest.fn(() => Promise.resolve({
            ok: true,
            json: async () => ({ status: true, data: { status: 'abandoned' } }),
        })) as any;

        const res: any = await post();

        expect(res.status).toBe(400);
        expect(mockClaim).not.toHaveBeenCalled();
    });

    it('does not claim an underpayment', async () => {
        paystackSaysPaid(2_000); // fee is 10,000

        const res: any = await post();

        expect(res.status).toBe(400);
        expect(mockClaim).not.toHaveBeenCalled();
    });
});
