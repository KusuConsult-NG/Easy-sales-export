/**
 * @jest-environment node
 */

/**
 * A cooperative contribution must credit the SPENDABLE balance, not only the
 * lifetime total — whichever of the two confirmation paths handles it.
 *
 * THE TWO FIELDS ARE NOT INTERCHANGEABLE
 * --------------------------------------
 *   totalContributions — cumulative lifetime paid in. Incremented on every
 *     contribution and decremented NOWHERE in src/. Drives the tier and the
 *     admin contribution reports.
 *   savingsBalance     — the spendable figure. Withdrawals debit it
 *     (cooperative/_withdrawal.ts), loan-repayment-from-savings debits it
 *     (_loans_repayments.ts), the member dashboard displays it, and the loan
 *     limit is a multiple of it.
 *
 * The withdraw route already carries a comment about confusing the two in the
 * other direction. This is the same confusion on the way in.
 *
 * WHAT WAS WRONG
 * --------------
 * One payment has two confirmation paths, and they disagreed:
 *
 *   processCooperativeContribution (infrastructure/payments/service.ts) — the
 *     Paystack webhook — incremented BOTH fields.
 *   verifyContributionPaymentAction (cooperative/_payment.ts) — the browser
 *     redirect after checkout — incremented ONLY totalContributions.
 *
 * They are mutually exclusive. claim_payment_once is keyed on the reference
 * alone, so whichever arrives first claims it and the other returns early
 * without crediting anything. Whether a member's spendable savings went up was
 * therefore decided by a race between their browser and Paystack's webhook.
 *
 * A member who lost that race had their contribution counted in their lifetime
 * total, in the unified ledger, in the cooperative ledger and in every admin
 * report — but could not withdraw it, and it did not raise their borrowing
 * limit. From their side that is "my money vanished", which is what was
 * reported.
 *
 * WHY IT ASSERTS ON THE WRITE
 * ---------------------------
 * The action returned success either way, so no assertion on its return value
 * could see this. The defect is in WHICH FIELDS WERE WRITTEN, so that is what
 * is checked — and the last case checks the two paths against each other, so
 * they cannot drift apart again without a failure.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

declare const global: any;

const USER_ID = 'admin-id'; // matches jest.setup.js's default session
const REFERENCE = 'ref_contribution_1';
const AMOUNT_NAIRA = 25_000;

const mockClaimPaymentOnce = jest.fn() as jest.Mock<any>;
const mockVerifyPaystack = jest.fn() as jest.Mock<any>;

jest.mock('@/lib/wallet-ledger', () => ({
    claimPaymentOnce: (...a: any[]) => mockClaimPaymentOnce(...a),
    claimSingleOpenLoanApplication: jest.fn(),
    debitJsonbBalance: jest.fn(),
    creditWalletOnce: jest.fn(),
    debitWalletOnce: jest.fn(),
}));

jest.mock('@/lib/paystack-server', () => ({
    verifyPaystackPayment: (...a: any[]) => mockVerifyPaystack(...a),
    initializePaystackPayment: jest.fn(),
    nairaToKobo: (n: number) => Math.round(n * 100),
}));

// The rate limiter is module-scoped state; let every call through.
jest.mock('@/lib/rate-limiter', () => ({
    rateLimit: () => ({ check: async () => ({ success: true }) }),
}));

jest.mock('@/lib/audit-log', () => ({
    createAdminAuditLog: jest.fn(),
}));

jest.mock('@/lib/logger', () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

/**
 * The increment sentinel, in either of the two spellings this codebase
 * produces: FieldValue.increment (firestore-compat) tags itself
 * "FieldValue.increment", the modular increment() export tags itself
 * "increment". Both carry the delta on `_operand`. Accepting only one of them
 * would make this whole file read as "no increments written" and every
 * assertion below vacuous.
 */
function incrementOf(value: any): number | undefined {
    if (!value || typeof value !== 'object') return undefined;
    if (value._methodName === 'increment' || value._methodName === 'FieldValue.increment') {
        return value._operand;
    }
    return undefined;
}

/** Every field name the run wrote a numeric increment for. */
function incrementedFields(calls: any[][]): Record<string, number> {
    const out: Record<string, number> = {};
    for (const call of calls) {
        const fields = call[call.length - 1];
        if (!fields || typeof fields !== 'object') continue;
        for (const [k, v] of Object.entries(fields)) {
            const delta = incrementOf(v);
            if (delta !== undefined) out[k] = delta;
        }
    }
    return out;
}

beforeEach(() => {
    jest.clearAllMocks();
    mockClaimPaymentOnce.mockResolvedValue({ claimed: true, status: 'completed' });
    mockVerifyPaystack.mockResolvedValue({
        data: {
            status: 'success',
            amount: AMOUNT_NAIRA * 100,
            metadata: { userId: USER_ID, amount: AMOUNT_NAIRA },
        },
    });
    // The membership record, for both the pre-claim existence check and the
    // read inside the transaction.
    const member = { exists: true, data: () => ({ userId: USER_ID, totalContributions: 0, savingsBalance: 0, tier: 'Member', cooperativeId: 'default' }) };
    global.mockFirestoreGet.mockResolvedValue(member);
    global.mockFirestoreTxGet.mockResolvedValue(member);
});

describe('verifyContributionPaymentAction — the browser-redirect confirmation', () => {
    it('credits savingsBalance, not only totalContributions', async () => {
        const { verifyContributionPaymentAction } = await import('@/app/actions/cooperative/_payment');
        const res = await verifyContributionPaymentAction(REFERENCE);

        expect(res.success).toBe(true);

        const written = incrementedFields(global.mockFirestoreTxUpdate.mock.calls);
        // The assertion the defect fails. Before the fix savingsBalance was
        // absent from every write this action made.
        expect(written.savingsBalance).toBe(AMOUNT_NAIRA);
        expect(written.totalContributions).toBe(AMOUNT_NAIRA);
    });

    it('credits the two fields by the same amount', async () => {
        // A partial fix that credited savingsBalance with the wrong figure —
        // kobo instead of naira, say — would satisfy the test above only by
        // accident of the fixture. This pins them together.
        const { verifyContributionPaymentAction } = await import('@/app/actions/cooperative/_payment');
        await verifyContributionPaymentAction(REFERENCE);

        const written = incrementedFields(global.mockFirestoreTxUpdate.mock.calls);
        // Both being undefined satisfies an equality check, which is exactly
        // how this assertion passed while the defect was live. Pin the value
        // first, then the agreement.
        expect(written.totalContributions).toBe(AMOUNT_NAIRA);
        expect(written.savingsBalance).toBe(written.totalContributions);
    });

    it('credits nothing when the reference was already claimed', async () => {
        // The other half of the same guard: a duplicate confirmation must not
        // add the contribution twice now that it adds it to two fields.
        mockClaimPaymentOnce.mockResolvedValue({ claimed: false, status: 'completed' });
        const { verifyContributionPaymentAction } = await import('@/app/actions/cooperative/_payment');
        const res = await verifyContributionPaymentAction(REFERENCE);

        expect(res.success).toBe(true); // already recorded is success
        expect(incrementedFields(global.mockFirestoreTxUpdate.mock.calls)).toEqual({});
    });
});

describe('the two confirmation paths for one payment', () => {
    it('credit the same set of member fields', async () => {
        // claim_payment_once is keyed on the reference alone, so exactly one of
        // these runs for any given payment. If they credit different fields,
        // the member's balance depends on which one won — which is what this
        // asserts can no longer happen.
        //
        // Compared as a SET of field names rather than by reading either
        // implementation, so the check survives either one being rewritten.
        const { verifyContributionPaymentAction } = await import('@/app/actions/cooperative/_payment');
        await verifyContributionPaymentAction(REFERENCE);
        const viaBrowser = Object.keys(incrementedFields(global.mockFirestoreTxUpdate.mock.calls)).sort();

        jest.clearAllMocks();
        mockClaimPaymentOnce.mockResolvedValue({ claimed: true, status: 'completed' });
        const member = { exists: true, data: () => ({ userId: USER_ID, totalContributions: 0, savingsBalance: 0, tier: 'Member', cooperativeId: 'default' }) };
        global.mockFirestoreGet.mockResolvedValue(member);

        const { processCooperativeContribution } = await import('@/infrastructure/payments/service');
        await processCooperativeContribution(REFERENCE, AMOUNT_NAIRA, USER_ID);
        const viaWebhook = Object.keys(incrementedFields(global.mockFirestoreUpdate.mock.calls)).sort();

        expect(viaWebhook).toEqual(['savingsBalance', 'totalContributions']);
        expect(viaBrowser).toEqual(viaWebhook);
    });
});
