/**
 * @jest-environment node
 */

/**
 * A member's cooperative savings could be overwritten by their own next payment.
 *
 * TWO DEFECTS, ONE FUNCTION
 * -------------------------
 * 1. The double-payment guard was a check-then-write. A read of
 *    processedPayments near the top of the function:
 *
 *        const existingPayment = await getDoc(processedRef);
 *        if (existingPayment.exists) return success;
 *
 *    and, much later, a blind `transaction.set(processedRef, ...)` inside
 *    runTransaction. That adapter's runTransaction takes no lock and cannot roll
 *    back, so both halves are ordinary statements with a gap between them. A
 *    webhook and a client verification arriving on one reference together both
 *    saw an absent row and both credited the contribution.
 *
 * 2. The savings balance was a read-adjust-write:
 *
 *        const currentTotal = membershipData.totalContributions || 0;
 *        const newTotal = currentTotal + amountInNaira;
 *        transaction.update(membershipRef, { totalContributions: newTotal, ... })
 *
 *    Two contributions from the same member processed at once — a webhook and a
 *    client verification for two DIFFERENT references, which is the normal shape
 *    of this system — both read the same starting figure and both wrote their
 *    own total. One contribution vanished from the member's savings.
 *
 *    The claim fixes references. It does nothing about this, and the two are
 *    genuinely separate: fixing only the first would leave the second.
 *
 * The tier was computed from the same stale arithmetic, so a member whose
 * contributions raced was also placed on the tier for only one of them. It is
 * now derived from the total the increment actually produced.
 *
 * WHY THIS FILE AND NOT ANOTHER
 * -----------------------------
 * export.ts, export-payment.ts and farm-nation-payment.ts all verify Paystack
 * payments and all moved to claimPaymentOnce, with comments saying so —
 * "claimPaymentOnce below is the whole gate now". This file kept a hand-rolled
 * version of the same idea and was missed.
 *
 * A NOTE ON REPORTED REVENUE
 * --------------------------
 * The old code wrote its own processedPayments row with no status field, so
 * `platform_revenue_totals()` — which sums rows whose raw_data->>'status' is
 * 'completed' — never counted a cooperative contribution. claimPaymentOnce
 * records status "completed" like every sibling module, so contributions now
 * appear in that figure. That is a visible change to a reported number, and it
 * is called out rather than slipped in.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const MEMBER = 'member-1';
const OTHER = 'other-1';
const REF = 'PSK-REF-1';
const AMOUNT = 50_000;
const EXISTING_TOTAL = 120_000;

const mockVerifyPaystack = jest.fn() as jest.Mock<any>;
const mockClaimPayment = jest.fn() as jest.Mock<any>;

jest.mock('@/lib/paystack-server', () => ({
    verifyPaystackPayment: (...a: any[]) => mockVerifyPaystack(...a),
    initializePaystackPayment: jest.fn(),
    verifyPaystackWebhook: jest.fn(),
}));
jest.mock('@/lib/wallet-ledger', () => ({
    claimPaymentOnce: (...a: any[]) => mockClaimPayment(...a),
    creditWalletOnce: jest.fn(), debitWalletOnce: jest.fn(), debitWalletLocked: jest.fn(),
    debitJsonbBalance: jest.fn(), debitJsonbBalanceWithFloor: jest.fn(),
    claimVersionedUpdate: jest.fn(), claimIdempotencyKey: jest.fn(),
    incrementWithinCeiling: jest.fn(), decrementManyOrFail: jest.fn(),
    claimSingleOpenLoanApplication: jest.fn(),
}));
jest.mock('@/lib/audit-log', () => ({
    createAdminAuditLog: jest.fn(async () => ({})),
    logAdminFinancialAction: jest.fn(async () => ({})),
}));
jest.mock('@/lib/rate-limiter', () => ({
    rateLimit: () => ({ check: jest.fn(async () => ({ success: true, limit: 100, remaining: 99, reset: 0 })) }),
    getClientIp: jest.fn(() => '127.0.0.1'),
    createRateLimitResponse: jest.fn(),
}));

function setSession(id: string) {
    (global as any).mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id, email: `${id}@e.com`, name: id, roles: [] } },
        error: null,
    }));
}

/** The membership row. `exists: false` covers the not-a-member case. */
function setMembership(data: Record<string, any> | null) {
    const snap = data === null
        ? { exists: false, empty: true, docs: [], data: () => undefined }
        : {
            exists: true, empty: false,
            docs: [{ id: MEMBER, ref: { id: MEMBER }, data: () => data }],
            ref: { id: MEMBER },
            data: () => data,
        };
    (global as any).mockFirestoreGet.mockImplementation(() => Promise.resolve(snap));
    (global as any).mockFirestoreTxGet.mockImplementation(() => Promise.resolve(snap));
}

function allWrites(): Record<string, any>[] {
    const g = global as any;
    return [
        ...g.mockFirestoreUpdate.mock.calls,
        ...g.mockFirestoreSet.mock.calls,
        ...g.mockFirestoreTxUpdate.mock.calls,
        ...g.mockFirestoreTxSet.mock.calls,
    ].map((c: any[]) => c[c.length - 1]).filter(Boolean);
}

/** The patch that touches the savings balance. */
function savingsPatch(): Record<string, any> | undefined {
    return allWrites().find((p) => p && 'totalContributions' in p);
}

async function verify(reference = REF) {
    const { verifyContributionPaymentAction } = await import('@/app/actions/cooperative/_payment');
    return verifyContributionPaymentAction(reference);
}

describe('verifyContributionPaymentAction — savings are added to, never replaced', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSession(MEMBER);
        setMembership({ totalContributions: EXISTING_TOTAL, tier: 'bronze', cooperativeId: 'coop-1' });
        mockVerifyPaystack.mockResolvedValue({
            data: { status: 'success', amount: AMOUNT * 100, metadata: { userId: MEMBER, amount: AMOUNT } },
        });
        mockClaimPayment.mockResolvedValue({ claimed: true, status: 'completed' });
    });

    it('increments the balance rather than writing a computed total', async () => {
        // THE test. A computed total is only correct if nothing else is writing
        // the same field, and a webhook is.
        await verify();

        const patch = savingsPatch();
        expect(patch).toBeDefined();
        // FieldValue.increment(n) is a sentinel — { _methodName, _operand } —
        // which the adapter turns into a SQL increment. A plain number here
        // would mean the balance was computed in JavaScript.
        expect(patch!.totalContributions).toMatchObject({
            _methodName: 'FieldValue.increment', _operand: AMOUNT,
        });
        expect(typeof patch!.totalContributions).not.toBe('number');
    });

    it('claims the reference through claim_payment_once', async () => {
        // The hand-rolled read-then-set is gone; this is the gate every sibling
        // module already uses.
        await verify();

        expect(mockClaimPayment).toHaveBeenCalledWith(
            expect.objectContaining({ reference: REF, userId: MEMBER, amount: AMOUNT })
        );
    });

    it('claims before touching the balance', async () => {
        await verify();

        const claimOrder = mockClaimPayment.mock.invocationCallOrder[0];
        const writeOrder = (global as any).mockFirestoreTxUpdate.mock.invocationCallOrder[0];
        if (writeOrder !== undefined) expect(claimOrder).toBeLessThan(writeOrder);
    });

    it('treats a lost claim as success and credits nothing', async () => {
        // Rule 3, and the webhook-got-there-first case. Reporting an error here
        // would tell a member their payment failed after it had been recorded.
        mockClaimPayment.mockResolvedValue({ claimed: false, status: 'completed' });

        const r: any = await verify();

        expect(r.success).toBe(true);
        expect(savingsPatch()).toBeUndefined();
    });

    it('sets the tier from the stored total, not from stale arithmetic', async () => {
        // The re-read returns a total higher than this call alone would produce
        // — the shape of a concurrent contribution having landed. The tier must
        // follow the row, not this caller's guess.
        setMembership({ totalContributions: 1_000_000, tier: 'bronze', cooperativeId: 'coop-1' });

        await verify();

        const tierPatch = allWrites().find((p) => p && 'tier' in p && !('totalContributions' in p));
        expect(tierPatch).toBeDefined();
        expect(tierPatch!.tier).not.toBe('bronze');
    });
});

describe('verifyContributionPaymentAction — the checks that were already right', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSession(MEMBER);
        setMembership({ totalContributions: EXISTING_TOTAL, tier: 'bronze', cooperativeId: 'coop-1' });
        mockClaimPayment.mockResolvedValue({ claimed: true, status: 'completed' });
        mockVerifyPaystack.mockResolvedValue({
            data: { status: 'success', amount: AMOUNT * 100, metadata: { userId: MEMBER, amount: AMOUNT } },
        });
    });

    it('refuses a reference belonging to somebody else', async () => {
        // Without this, anyone could quote another member's reference and have
        // it credited to themselves.
        mockVerifyPaystack.mockResolvedValue({
            data: { status: 'success', amount: AMOUNT * 100, metadata: { userId: OTHER, amount: AMOUNT } },
        });

        const r: any = await verify();

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/user mismatch/i);
        expect(mockClaimPayment).not.toHaveBeenCalled();
    });

    it('refuses a payment Paystack did not report as successful', async () => {
        mockVerifyPaystack.mockResolvedValue({
            data: { status: 'abandoned', amount: AMOUNT * 100, metadata: { userId: MEMBER } },
        });

        const r: any = await verify();

        expect(r.success).toBe(false);
        expect(mockClaimPayment).not.toHaveBeenCalled();
    });

    it('refuses when the amount paid does not match what was requested', async () => {
        mockVerifyPaystack.mockResolvedValue({
            data: { status: 'success', amount: 1_000 * 100, metadata: { userId: MEMBER, amount: AMOUNT } },
        });

        const r: any = await verify();

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/mismatch/i);
        expect(mockClaimPayment).not.toHaveBeenCalled();
    });

    it('refuses a non-member before claiming the reference', async () => {
        // Claiming first is right for money, but it means a later failure marks
        // the payment processed while crediting nobody, and the retry then
        // reports "already recorded". A missing membership is knowable in
        // advance, so it is ruled out while backing out is still free.
        setMembership(null);

        const r: any = await verify();

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/membership not found/i);
        expect(mockClaimPayment).not.toHaveBeenCalled();
    });

    it('records a legitimate contribution', async () => {
        // Vacuity guard. Every refusal above is satisfied by an action that
        // credits nobody, which would break cooperative savings entirely.
        const r: any = await verify();

        expect(r.success).toBe(true);
        expect(mockClaimPayment).toHaveBeenCalledTimes(1);
        expect(savingsPatch()).toBeDefined();
    });
});
